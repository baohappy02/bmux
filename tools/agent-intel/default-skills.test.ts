import { describe, expect, test } from "bun:test";

import { DEFAULT_SKILLS, validateDefaultSkills } from "./default-skills";

function skillContent(slug: string): string {
  const skill = DEFAULT_SKILLS.find((candidate) => candidate.slug === slug);
  expect(skill).toBeDefined();
  return skill?.contentMarkdown ?? "";
}

describe("default managed task skills", () => {
  test("catalog validates with pause-aware guidance", () => {
    expect(() => validateDefaultSkills(DEFAULT_SKILLS)).not.toThrow();
  });

  test("verify loop stops on paused jobs and documents unattended override", () => {
    const content = skillContent("verify-loop");
    expect(content).toContain("paused_for_user: true");
    expect(content).toContain("--pause-for-user false");
    expect(content).toContain("stop and wait for the user");
  });

  test("managed terminal tasks do not auto-wait after paused payloads", () => {
    const content = skillContent("bmux-managed-terminal-tasks");
    expect(content).toContain("paused_for_user: true");
    expect(content).toContain("--pause-for-user false");
    expect(content).toContain("do not auto-wait");
  });
});
