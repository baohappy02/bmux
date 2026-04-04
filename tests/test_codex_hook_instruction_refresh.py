#!/usr/bin/env python3
"""
Regression test for Codex hook instruction refresh gating.

Validates:
1) session-start persists an instruction fingerprint
2) prompt-submit continues normally when tracked instruction files are unchanged
3) prompt-submit blocks when tracked instruction files change mid-session
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


def main() -> int:
    try:
        cli_path = resolve_bmux_cli()
    except Exception as exc:
        return fail(str(exc))

    state_path = Path(tempfile.gettempdir()) / f"bmux_codex_hook_refresh_state_{os.getpid()}.json"
    lock_path = Path(str(state_path) + ".lock")
    project_dir = Path(tempfile.gettempdir()) / f"bmux_codex_hook_refresh_project_{os.getpid()}"
    tracked_instruction = Path(tempfile.gettempdir()) / f"bmux_codex_hook_refresh_instruction_{os.getpid()}.md"
    project_dir.mkdir(parents=True, exist_ok=True)
    tracked_instruction.write_text("version one\n", encoding="utf-8")
    session_id = f"codex-{uuid.uuid4().hex}"

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

            with state_path.open("r", encoding="utf-8") as handle:
                session_state = json.load(handle)
            session_row = (session_state.get("sessions") or {}).get(session_id) or {}
            initial_fingerprint = session_row.get("instructionFingerprint")
            if not initial_fingerprint:
                return fail("Expected session-start to persist an instruction fingerprint")

            first_prompt_output = run_codex_hook(
                cli_path,
                client.socket_path,
                "prompt-submit",
                {
                    "session_id": session_id,
                    "cwd": str(project_dir),
                    "message": "Keep the current context",
                },
                hook_env,
            )
            if error := assert_quiet_hook_output(first_prompt_output, "prompt-submit"):
                return fail(error)

            tracked_instruction.write_text("version two\n", encoding="utf-8")

            second_prompt_output = run_codex_hook(
                cli_path,
                client.socket_path,
                "prompt-submit",
                {
                    "session_id": session_id,
                    "cwd": str(project_dir),
                    "message": "Now the watched instruction changed",
                },
                hook_env,
            )
            if error := assert_block_hook_output(second_prompt_output, "prompt-submit"):
                return fail(error)

            expected_status = f"codex=Refresh needed in {project_dir.name}"
            sidebar_state = wait_for_sidebar_fragment(client, workspace_id, expected_status)
            if expected_status not in sidebar_state:
                return fail(f"Expected refresh-needed status fragment. sidebar_state={sidebar_state!r}")

            with state_path.open("r", encoding="utf-8") as handle:
                refreshed_state = json.load(handle)
            refreshed_row = (refreshed_state.get("sessions") or {}).get(session_id) or {}
            refreshed_fingerprint = refreshed_row.get("instructionFingerprint")
            if not refreshed_fingerprint or refreshed_fingerprint == initial_fingerprint:
                return fail("Expected prompt-submit refresh block to persist a new instruction fingerprint")

            print("PASS: Codex hook blocks and refreshes state when instructions change")
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
        except OSError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
