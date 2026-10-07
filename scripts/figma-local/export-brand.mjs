#!/usr/bin/env node
/** Generate the small, disposable input consumed by the local Figma plugin. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { projectPublic } from "@repo/project-config/public";

import { createFigmaBrandProjection } from "../figma-sync/brand.mjs";

export function createBrandPluginInput(config, targetFileKey) {
  if (!/^[A-Za-z0-9]+$/.test(targetFileKey)) {
    throw new Error("A valid Figma Brand Library file key is required");
  }
  return {
    schemaVersion: 1,
    targetFileKey,
    project: { slug: config.slug, primary: config.brand.primary },
    projection: createFigmaBrandProjection(config),
  };
}

async function main(args) {
  if (
    args.length !== 4 ||
    args[0] !== "--file-key" ||
    !args[1] ||
    args[2] !== "--out" ||
    !args[3]
  ) {
    throw new Error(
      "Usage: node scripts/figma-local/export-brand.mjs --file-key <Brand Library key> --out <path>",
    );
  }
  const output = resolve(args[3]);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(createBrandPluginInput(projectPublic, args[1]))}\n`,
    "utf8",
  );
  process.stdout.write(`${output}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
