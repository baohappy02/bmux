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
    expect(content).toContain("verify.rust");
    expect(content).toContain("failure_markers");
    expect(content).toContain("failure_context");
    expect(content).toContain("task wait");
    expect(content).toContain("right split");
    expect(content).toContain("background exec");
  });

  test("managed terminal tasks prefer one-shot task runs and unattended failure context before logs", () => {
    const content = skillContent("bmux-managed-terminal-tasks");
    expect(content).toContain("single managed command");
    expect(content).toContain("without a separate attach or ensure step");
    expect(content).toContain("separate visible task terminal");
    expect(content).toContain("right split");
    expect(content).toContain("Only call `layout` after topology changes");
    expect(content).toContain("paused_for_user: true");
    expect(content).toContain("--pause-for-user false");
    expect(content).toContain("task wait");
    expect(content).toContain("failure_markers");
    expect(content).toContain("failure_context");
    expect(content).toContain("background exec");
  });
});
