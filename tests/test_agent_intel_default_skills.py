#!/usr/bin/env python3
"""
Regression test for bmux agent-intel default skill seeding and retrieval.

Validates:
1) `status` auto-seeds default skills on a blank database
2) `list-skills --repo-root ...` still includes global defaults
3) search retrieval surfaces key workflow cards at the top
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGENT_INTEL_CLI = ROOT / "tools" / "agent-intel" / "cli.ts"
REQUIRED_SLUGS = {"coding-principles", "bmux-managed-terminal-tasks"}


def resolve_bun() -> str:
    explicit = os.environ.get("BMUX_AGENT_INTEL_BUN")
    if explicit and os.path.exists(explicit) and os.access(explicit, os.X_OK):
        return explicit

    in_path = shutil.which("bun")
    if in_path:
        return in_path

    home_bun = Path.home() / ".bun" / "bin" / "bun"
    if home_bun.exists() and os.access(home_bun, os.X_OK):
        return str(home_bun)

    raise RuntimeError("Unable to find bun. Set BMUX_AGENT_INTEL_BUN.")


def run_agent_intel(bun_path: str, *args: str) -> dict:
    proc = subprocess.run(
        [bun_path, str(AGENT_INTEL_CLI), *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "agent-intel command failed:\n"
            f"exit={proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}"
        )

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"agent-intel returned non-JSON stdout: {proc.stdout!r}") from exc

    if payload.get("ok") is not True:
        raise RuntimeError(f"agent-intel returned error payload: {payload!r}")
    return payload


def fail(message: str) -> int:
    print(f"FAIL: {message}")
    return 1


def main() -> int:
    try:
        bun_path = resolve_bun()
    except Exception as exc:
        return fail(str(exc))

    with tempfile.TemporaryDirectory(prefix="bmux-agent-intel-default-skills-") as td:
        temp_root = Path(td)
        db_path = temp_root / "agent-intel.db"
        repo_root = temp_root / "fake-repo"
        repo_root.mkdir(parents=True, exist_ok=True)

        try:
            status_payload = run_agent_intel(bun_path, "status", "--db", str(db_path))
            defaults = status_payload.get("defaults") or {}
            seeded_ids = defaults.get("skillIds") or []
            seeded_count = len(seeded_ids)
            if seeded_count == 0:
                return fail("Expected status to auto-seed at least one default skill")

            total_skills = ((status_payload.get("status") or {}).get("skills")) or 0
            if total_skills != seeded_count:
                return fail(
                    "Expected blank-db status to report exactly the seeded default skills "
                    f"(status.skills={total_skills}, seeded_count={seeded_count})"
                )

            list_payload = run_agent_intel(
                bun_path,
                "list-skills",
                "--db",
                str(db_path),
                "--repo-root",
                str(repo_root),
                "--limit",
                "100",
            )
            listed_skills = list_payload.get("skills") or []
            listed_slugs = {skill.get("slug") for skill in listed_skills}
            if list_payload.get("count") != seeded_count:
                return fail(
                    "Expected repo-root skill listing to include all global defaults "
                    f"(count={list_payload.get('count')}, seeded_count={seeded_count})"
                )
            missing_required = sorted(slug for slug in REQUIRED_SLUGS if slug not in listed_slugs)
            if missing_required:
                return fail(f"Missing required default skills from repo-root listing: {missing_required}")

            coding_payload = run_agent_intel(
                bun_path,
                "search-skills",
                "--db",
                str(db_path),
                "--repo-root",
                str(repo_root),
                "--limit",
                "5",
                "--query",
                "coding principles shared code review",
            )
            coding_hits = coding_payload.get("hits") or []
            coding_slug = (coding_hits[0] if coding_hits else {}).get("slug")
            if coding_slug != "coding-principles":
                return fail(f"Expected coding-principles top hit, got {coding_slug!r}")

            terminal_payload = run_agent_intel(
                bun_path,
                "search-skills",
                "--db",
                str(db_path),
                "--repo-root",
                str(repo_root),
                "--limit",
                "5",
                "--query",
                "run tests in bmux terminal pause for user",
            )
            terminal_hits = terminal_payload.get("hits") or []
            terminal_slug = (terminal_hits[0] if terminal_hits else {}).get("slug")
            if terminal_slug != "bmux-managed-terminal-tasks":
                return fail(f"Expected bmux-managed-terminal-tasks top hit, got {terminal_slug!r}")

            print(
                "PASS: agent-intel auto-seeds defaults, preserves global skills under repo_root, "
                "and retrieves core workflow cards"
            )
            return 0
        except RuntimeError as exc:
            return fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
