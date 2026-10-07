#!/usr/bin/env node
/** Link the repository's locked external skills into Claude Code's skill directory. */
import { lstat, mkdir, readFile, realpath, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(currentFile), "../..");

async function existing(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function restoreClaudeSkills(root = defaultRoot) {
  const lock = JSON.parse(
    await readFile(join(root, "skills-lock.json"), "utf8"),
  );
  const names = Object.keys(lock.skills ?? {});
  if (!names.length) throw new Error("skills-lock.json contains no skills");
  const results = [];
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
      throw new Error(`Invalid locked skill name: ${name}`);
    const source = join(root, ".agents", "skills", name);
    if (!(await existing(join(source, "SKILL.md"))))
      throw new Error(`Locked skill source is missing: ${name}`);
    const target = join(root, ".claude", "skills", name);
    const current = await existing(target);
    if (current) {
      if (
        !current.isSymbolicLink() ||
        (await realpath(target)) !== (await realpath(source))
      )
        throw new Error(
          `Claude skill target already exists and differs: ${name}`,
        );
      results.push({ name, status: "already-linked" });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await symlink(
      source,
      target,
      process.platform === "win32" ? "junction" : "dir",
    );
    results.push({ name, status: "linked" });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  restoreClaudeSkills()
    .then((results) => process.stdout.write(`${JSON.stringify(results)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
