#!/usr/bin/env python3
"""
Regression: the bmux ZDOTDIR wrapper must source the bundled bmux zsh
integration in interactive shells when shell integration is enabled.

This exercises the real wrapper startup path instead of grepping filenames, so
renames like `cmux-zsh-integration.zsh` -> `bmux-zsh-integration.zsh` cannot
silently break managed task reporting.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    wrapper_dir = root / "Resources" / "shell-integration"
    if not (wrapper_dir / ".zshenv").exists():
        print(f"SKIP: missing wrapper .zshenv at {wrapper_dir}")
        return 0

    base = Path("/tmp") / f"bmux_zsh_wrapper_integration_{os.getpid()}"
    try:
        shutil.rmtree(base, ignore_errors=True)
        base.mkdir(parents=True, exist_ok=True)

        home = base / "home"
        orig = base / "orig-zdotdir"
        home.mkdir(parents=True, exist_ok=True)
        orig.mkdir(parents=True, exist_ok=True)

        for filename in (".zshenv", ".zprofile", ".zshrc", ".zlogin"):
            (orig / filename).write_text("", encoding="utf-8")

        env = dict(os.environ)
        env["HOME"] = str(home)
        env["ZDOTDIR"] = str(wrapper_dir)
        env["CMUX_ZSH_ZDOTDIR"] = str(orig)
        env["CMUX_SHELL_INTEGRATION"] = "1"
        env["CMUX_SHELL_INTEGRATION_DIR"] = str(wrapper_dir)

        result = subprocess.run(
            [
                "zsh",
                "-d",
                "-i",
                "-c",
                "whence _bmux_preexec _bmux_precmd _bmux_send_bg _bmux_prompt_command",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=8,
        )
        if result.returncode != 0:
            print(f"FAIL: zsh exited non-zero rc={result.returncode}")
            combined = (result.stdout or "") + (result.stderr or "")
            if combined.strip():
                print(combined.strip())
            return 1

        stdout = result.stdout or ""
        missing = [
            name
            for name in (
                "_bmux_preexec",
                "_bmux_precmd",
                "_bmux_send_bg",
                "_bmux_prompt_command",
            )
            if name not in stdout
        ]
        if missing:
            print("FAIL: wrapper did not source bmux zsh integration functions")
            print("missing:", ", ".join(missing))
            if stdout.strip():
                print(stdout.strip())
            if (result.stderr or "").strip():
                print(result.stderr.strip())
            return 1

        print("PASS: wrapper sources bmux zsh integration in interactive shells")
        return 0
    finally:
        shutil.rmtree(base, ignore_errors=True)
