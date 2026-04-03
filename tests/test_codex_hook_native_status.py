#!/usr/bin/env python3
"""
E2E regression test for native Codex hook status and notifications.

Validates:
1) session-start records session_id -> workspace/surface mapping on disk
2) prompt-submit updates bmux status with project + request context
3) stop emits a richer completion notification and returns status to idle
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

    candidates = [p for p in candidates if os.path.exists(p) and os.access(p, os.X_OK)]
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


def main() -> int:
    try:
        cli_path = resolve_bmux_cli()
    except Exception as exc:
        return fail(str(exc))

    state_path = Path(tempfile.gettempdir()) / f"bmux_codex_hook_state_{os.getpid()}.json"
    lock_path = Path(str(state_path) + ".lock")
    project_dir = Path(tempfile.gettempdir()) / f"bmux_codex_project_{os.getpid()}"
    project_dir.mkdir(parents=True, exist_ok=True)
    session_id = f"codex-{uuid.uuid4().hex}"
    prompt_message = "Polish native hook status"
    assistant_message = "Updated the native Codex hook status and completion summary."

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

            focused = next((s for s in surfaces if s[2]), surfaces[0])
            surface_id = focused[1]

            hook_env = os.environ.copy()
            hook_env["CMUX_SOCKET_PATH"] = client.socket_path
            hook_env["CMUX_WORKSPACE_ID"] = workspace_id
            hook_env["CMUX_SURFACE_ID"] = surface_id
            hook_env["CMUX_CLAUDE_HOOK_STATE_PATH"] = str(state_path)

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
            if session_start_output.get("summary") != "Registered Codex session":
                return fail(f"Expected session-start summary, got {session_start_output!r}")
            ready_status = f"Ready in {project_dir.name}"
            if session_start_output.get("status") != ready_status:
                return fail(f"Expected ready status in session-start output, got {session_start_output!r}")

            if not state_path.exists():
                return fail(f"Expected state file at {state_path}")

            with state_path.open("r", encoding="utf-8") as f:
                state_data = json.load(f)
            session_row = (state_data.get("sessions") or {}).get(session_id)
            if not session_row:
                return fail("Expected mapped session row after session-start")
            if session_row.get("workspaceId") != workspace_id:
                return fail("Mapped workspaceId did not match active workspace")
            if session_row.get("surfaceId") != surface_id:
                return fail("Mapped surfaceId did not match active surface")
            expected_ready = f"codex={ready_status}"
            sidebar_state = wait_for_sidebar_fragment(client, workspace_id, expected_ready)
            if expected_ready not in sidebar_state:
                return fail(f"Expected ready status fragment. sidebar_state={sidebar_state!r}")

            prompt_submit_output = run_codex_hook(
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

            expected_running = f"codex=Running in {project_dir.name}: {prompt_message}"
            if prompt_submit_output.get("summary") != expected_running.replace("codex=", "", 1):
                return fail(f"Expected prompt-submit summary to match running status, got {prompt_submit_output!r}")
            if prompt_submit_output.get("requestSummary") != prompt_message:
                return fail(f"Expected prompt-submit request summary in output, got {prompt_submit_output!r}")
            sidebar_state = wait_for_sidebar_fragment(client, workspace_id, expected_running)
            if expected_running not in sidebar_state:
                return fail(f"Expected running status fragment. sidebar_state={sidebar_state!r}")

            with state_path.open("r", encoding="utf-8") as f:
                prompt_state = json.load(f)
            prompt_row = (prompt_state.get("sessions") or {}).get(session_id) or {}
            if prompt_row.get("lastRequest") != prompt_message:
                return fail("Expected prompt-submit to persist lastRequest summary")

            stop_output = run_codex_hook(
                cli_path,
                client.socket_path,
                "stop",
                {
                    "session_id": session_id,
                    "cwd": str(project_dir),
                    "last_assistant_message": assistant_message,
                },
                hook_env,
            )

            subtitle = f"Completed in {project_dir.name}"
            if stop_output.get("summary") != subtitle:
                return fail(f"Expected stop summary to match notification subtitle, got {stop_output!r}")
            if assistant_message not in str(stop_output.get("detail", "")):
                return fail(f"Expected stop detail to include assistant message, got {stop_output!r}")
            expected_completed = f"codex={subtitle}"
            sidebar_state = wait_for_sidebar_fragment(client, workspace_id, expected_completed)
            if expected_completed not in sidebar_state:
                return fail(f"Expected completed status fragment. sidebar_state={sidebar_state!r}")

            with state_path.open("r", encoding="utf-8") as f:
                stop_state = json.load(f)
            stop_row = (stop_state.get("sessions") or {}).get(session_id) or {}
            if stop_row.get("lastBody") != assistant_message:
                return fail("Expected stop to persist the last assistant summary")

            print("PASS: Codex native hook status + completion notification")
            return 0

    except (bmuxError, RuntimeError) as exc:
        return fail(str(exc))
    finally:
        try:
            if state_path.exists():
                state_path.unlink()
            if lock_path.exists():
                lock_path.unlink()
            if project_dir.exists():
                shutil.rmtree(project_dir, ignore_errors=True)
        except OSError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
