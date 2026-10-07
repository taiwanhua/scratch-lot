import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { restoreClaudeSkills } from "./restore-claude-skills.mjs";

test("new clone links locked skills and rerun leaves them in place", async () => {
  const root = await mkdtemp(join(tmpdir(), "wowgo-skills-"));
  try {
    const source = join(root, ".agents", "skills", "sample-skill");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "# sample\n");
    await writeFile(
      join(root, "skills-lock.json"),
      JSON.stringify({ version: 1, skills: { "sample-skill": {} } }),
    );
    assert.deepEqual(await restoreClaudeSkills(root), [
      { name: "sample-skill", status: "linked" },
    ]);
    const target = join(root, ".claude", "skills", "sample-skill");
    assert.equal(await realpath(target), await realpath(source));
    assert.equal(
      await readFile(join(target, "SKILL.md"), "utf8"),
      "# sample\n",
    );
    assert.deepEqual(await restoreClaudeSkills(root), [
      { name: "sample-skill", status: "already-linked" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an existing real directory is never replaced", async () => {
  const root = await mkdtemp(join(tmpdir(), "wowgo-skills-"));
  try {
    await mkdir(join(root, ".agents", "skills", "sample-skill"), {
      recursive: true,
    });
    await writeFile(
      join(root, ".agents", "skills", "sample-skill", "SKILL.md"),
      "source",
    );
    await writeFile(
      join(root, "skills-lock.json"),
      JSON.stringify({ version: 1, skills: { "sample-skill": {} } }),
    );
    const target = join(root, ".claude", "skills", "sample-skill");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "owned");
    await assert.rejects(
      restoreClaudeSkills(root),
      /already exists and differs/,
    );
    assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "owned");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
