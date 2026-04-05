#!/usr/bin/env python3
"""
Regression test for Codex hook refresh gating after context compaction.

Validates:
1) prompt-submit blocks on the first prompt after a transcript records context_compacted
2) the handled compaction count is persisted in hook session state
3) the next prompt proceeds normally until a new compaction event appears
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bmux import bmux, bmuxError


def resolve_bmux_cli() -> str:
    explicit = os.environ.get("CMUX_CLI_BIN") or os.environ.get("CMUX_CLI")
    if explicit and os.path.exists(explicit) and os.access(explicit, os.X_OK):
        return explicit

    candidates: list[str] = []
    candidates.extend(glob.glob(os.path.expanduser("~/Library/Developer/Xcode/DerivedData/*/Build/Products/Debug/bmux")))
    candidates.extend(glob.glob("/tmp/bmux-*/Build/Products/Debug/bmux"))
    candidates = [path for path in candidates if os.path.exists(path) and os.access(path, os.X_OK)]
    if candidates:
        candidates.sort(key=os.path.getmtime, reverse=True)
        return candidates[0]

    in_path = shutil.which("bmux")
    if in_path:
        return in_path

    raise RuntimeError("Unable to find bmux CLI binary. Set CMUX_CLI_BIN.")


def run_codex_hook(
    cli_path: str,
    socket_path: str,
    subcommand: str,
    payload: dict,
    env: dict[str, str],
) -> dict:
    proc = subprocess.run(
        [cli_path, "--socket", socket_path, "codex-hook", subcommand],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"bmux codex-hook {subcommand} failed:\n"
            f"exit={proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}"
        )
    try:
        return json.loads(proc.stdout.strip() or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"bmux codex-hook {subcommand} returned non-JSON stdout: {proc.stdout!r}") from exc


def wait_for_sidebar_fragment(client: bmux, workspace_id: str, fragment: str, timeout: float = 4.0) -> str:
    start = time.time()
    state = ""
    while time.time() - start < timeout:
        state = client.sidebar_state(tab=workspace_id)
        if fragment in state:
            return state
        time.sleep(0.05)
    return state


def fail(message: str) -> int:
    print(f"FAIL: {message}")
    return 1


def assert_quiet_hook_output(output: dict, subcommand: str) -> str | None:
    if output.get("continue") is not True:
        return f"Expected {subcommand} hook output to continue, got {output!r}"
    if output.get("suppressOutput") is not True:
        return f"Expected {subcommand} hook output to suppress Codex output, got {output!r}"
    if set(output.keys()) != {"continue", "suppressOutput"}:
        return f"Expected {subcommand} hook output to stay schema-minimal, got {output!r}"
    return None


def assert_block_hook_output(output: dict, subcommand: str) -> str | None:
    if output.get("decision") != "block":
        return f"Expected {subcommand} hook output to block, got {output!r}"
    reason = output.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        return f"Expected {subcommand} hook output to include a non-empty reason, got {output!r}"
    if set(output.keys()) != {"decision", "reason"}:
        return f"Expected {subcommand} hook output to stay schema-minimal for block, got {output!r}"
    return None


def append_context_compacted(transcript_path: Path) -> None:
    with transcript_path.open("a", encoding="utf-8") as handle:
        handle.write('{"type":"event_msg","payload":{"type":"context_compacted"}}\n')


def main() -> int:
    try:
        cli_path = resolve_bmux_cli()
    except Exception as exc:
        return fail(str(exc))

    state_path = Path(tempfile.gettempdir()) / f"bmux_codex_hook_compaction_state_{os.getpid()}.json"
    lock_path = Path(str(state_path) + ".lock")
    project_dir = Path(tempfile.gettempdir()) / f"bmux_codex_hook_compaction_project_{os.getpid()}"
    tracked_instruction = Path(tempfile.gettempdir()) / f"bmux_codex_hook_compaction_instruction_{os.getpid()}.md"
    codex_home = Path(tempfile.gettempdir()) / f"bmux_codex_hook_compaction_home_{os.getpid()}"
    transcript_dir = codex_home / "sessions" / "2026" / "04" / "05"
    project_dir.mkdir(parents=True, exist_ok=True)
    tracked_instruction.write_text("stable instruction\n", encoding="utf-8")
    transcript_dir.mkdir(parents=True, exist_ok=True)
    session_id = f"codex-{uuid.uuid4().hex}"
    prompt_message = "Continue after compaction"
    transcript_path = transcript_dir / f"rollout-2026-04-05T00-00-00-{session_id}.jsonl"

    try:
        if state_path.exists():
            state_path.unlink()
        if lock_path.exists():
            lock_path.unlink()
    except OSError:
        pass

    try:
        with bmux() as client:
            client.set_app_focus(False)
            client.clear_notifications()

            workspace_id = client.new_workspace()
            client.reset_sidebar(tab=workspace_id)
            surfaces = client.list_surfaces()
            if not surfaces:
                return fail("Expected at least one surface in new workspace")

            focused = next((surface for surface in surfaces if surface[2]), surfaces[0])
            surface_id = focused[1]

            hook_env = os.environ.copy()
            hook_env["CMUX_SOCKET_PATH"] = client.socket_path
            hook_env["CMUX_WORKSPACE_ID"] = workspace_id
            hook_env["CMUX_SURFACE_ID"] = surface_id
            hook_env["CMUX_CLAUDE_HOOK_STATE_PATH"] = str(state_path)
            hook_env["CMUX_CODEX_HOOK_TRACKED_PATHS"] = str(tracked_instruction)
            hook_env["CMUX_CODEX_HOOK_AUTO_REPLAY_DISABLED"] = "1"
            hook_env["CMUX_CODEX_HOOK_DISABLE_INTEL_REFRESH"] = "1"
            hook_env["CODEX_HOME"] = str(codex_home)

            session_start_output = run_codex_hook(
                cli_path,
                client.socket_path,
                "session-start",
                {
                    "session_id": session_id,
                    "cwd": str(project_dir),
                },
                hook_env,
            )
            if error := assert_quiet_hook_output(session_start_output, "session-start"):
                return fail(error)

            transcript_path.write_text(
                '{"type":"session_meta","payload":{"id":"%s"}}\n' % session_id,
                encoding="utf-8",
            )
            append_context_compacted(transcript_path)

            first_prompt_output = run_codex_hook(
                cli_path,
                client.socket_path,
                "prompt-submit",
                {
                    "session_id": session_id,
                    "cwd": str(project_dir),
                    "message": prompt_message,
                },
                hook_env,
            )
            if error := assert_block_hook_output(first_prompt_output, "prompt-submit"):
                return fail(error)

            expected_refresh = f"codex=Refresh needed in {project_dir.name}"
            sidebar_state = wait_for_sidebar_fragment(client, workspace_id, expected_refresh)
            if expected_refresh not in sidebar_state:
                return fail(f"Expected refresh-needed status fragment. sidebar_state={sidebar_state!r}")

            with state_path.open("r", encoding="utf-8") as handle:
                refresh_state = json.load(handle)
            refresh_row = (refresh_state.get("sessions") or {}).get(session_id) or {}
            if refresh_row.get("observedCompactionCount") != 1:
                return fail("Expected first blocked prompt to persist observedCompactionCount=1")
            if refresh_row.get("transcriptPath") != str(transcript_path):
                return fail("Expected blocked prompt to persist transcriptPath for the matched session log")

            second_prompt_output = run_codex_hook(
                cli_path,
                client.socket_path,
                "prompt-submit",
                {
                    "session_id": session_id,
                    "cwd": str(project_dir),
                    "message": prompt_message,
                },
                hook_env,
            )
            if error := assert_quiet_hook_output(second_prompt_output, "prompt-submit"):
                return fail(error)

            expected_running = f"codex=Running in {project_dir.name}: {prompt_message}"
            sidebar_state = wait_for_sidebar_fragment(client, workspace_id, expected_running)
            if expected_running not in sidebar_state:
                return fail(f"Expected running status fragment after handled compaction. sidebar_state={sidebar_state!r}")

            append_context_compacted(transcript_path)

            third_prompt_output = run_codex_hook(
                cli_path,
                client.socket_path,
                "prompt-submit",
                {
                    "session_id": session_id,
                    "cwd": str(project_dir),
                    "message": prompt_message,
                },
                hook_env,
            )
            if error := assert_block_hook_output(third_prompt_output, "prompt-submit"):
                return fail(error)

            with state_path.open("r", encoding="utf-8") as handle:
                second_refresh_state = json.load(handle)
            second_refresh_row = (second_refresh_state.get("sessions") or {}).get(session_id) or {}
            if second_refresh_row.get("observedCompactionCount") != 2:
                return fail("Expected second compaction to advance observedCompactionCount=2")

            print("PASS: Codex hook refreshes once per new context compaction")
            return 0

    except (bmuxError, RuntimeError) as exc:
        return fail(str(exc))
    finally:
        try:
            if state_path.exists():
                state_path.unlink()
            if lock_path.exists():
                lock_path.unlink()
            if tracked_instruction.exists():
                tracked_instruction.unlink()
            if project_dir.exists():
                shutil.rmtree(project_dir, ignore_errors=True)
            if codex_home.exists():
                shutil.rmtree(codex_home, ignore_errors=True)
        except OSError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
