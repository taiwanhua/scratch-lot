import assert from "node:assert/strict";
import test from "node:test";

import { projectPublic } from "@repo/project-config/public";

import { createFigmaBrandProjection } from "../figma-sync/brand.mjs";
import { createBrandPluginInput } from "./export-brand.mjs";

test("plugin input projects the existing config without a second palette source", () => {
  const input = createBrandPluginInput(projectPublic, "Zs4sd4ZzBtlnCKPhkp1sJc");
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.targetFileKey, "Zs4sd4ZzBtlnCKPhkp1sJc");
  assert.equal(input.project.slug, projectPublic.slug);
  assert.equal(input.project.primary, projectPublic.brand.primary);
  assert.deepEqual(input.projection, createFigmaBrandProjection(projectPublic));
  assert.ok(Buffer.byteLength(JSON.stringify(input), "utf8") < 4000);
});
