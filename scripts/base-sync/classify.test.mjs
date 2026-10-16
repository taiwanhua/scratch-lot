/**
 * `classifyPath` 對 admin 各層 `base/` / `project/` 的判定(STRUCT-12):
 * 專案來源一律 `project`,底座共用一律 `common`,固定組裝入口是 `mixed`。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyPath } from "./classify.mjs";

const LAYERS = ["components", "hooks", "stores", "lib"];

test("admin 各層的 project/ 判為 project", () => {
  assert.equal(
    classifyPath("apps/admin/src/components/project/x.tsx", "A"),
    "project",
  );
  for (const layer of LAYERS) {
    assert.equal(
      classifyPath(`apps/admin/src/${layer}/project/nested/x.ts`, "M"),
      "project",
      layer,
    );
  }
});

test("admin 各層的 base/ 判為 common", () => {
  assert.equal(
    classifyPath("apps/admin/src/components/base/x.tsx", "A"),
    "common",
  );
  for (const layer of LAYERS) {
    assert.equal(
      classifyPath(`apps/admin/src/${layer}/base/nested/x.ts`, "M"),
      "common",
      layer,
    );
  }
});

test("admin 的固定組裝入口判為 mixed", () => {
  assert.equal(
    classifyPath("apps/admin/src/app/module-pages.tsx", "M"),
    "mixed",
  );
  assert.equal(
    classifyPath("apps/admin/src/lib/base/help-registry.ts", "M"),
    "mixed",
  );
  // 搬進 lib/base/ 之前的舊位置(比對分層前的底座版本時會出現)
  assert.equal(
    classifyPath("apps/admin/src/lib/help-registry.ts", "M"),
    "mixed",
  );
});

test("realtime / print-agent 判為 common", () => {
  assert.equal(classifyPath("apps/realtime/src/index.ts", "A"), "common");
  assert.equal(classifyPath("apps/print-agent/src/main.ts", "M"), "common");
});

test("專案的名詞表與討論紀錄判為 project,底座的仍是 mixed", () => {
  assert.equal(classifyPath("CONTEXT-PROJECT.md", "M"), "project");
  assert.equal(classifyPath("docs/tmp/project-dis.md", "M"), "project");
  assert.equal(classifyPath("CONTEXT.md", "M"), "mixed");
  assert.equal(classifyPath("docs/tmp/dis.md", "M"), "mixed");
});

test(".claude/skills 底下的 skill 判為 common", () => {
  assert.equal(
    classifyPath(".claude/skills/module-scaffold/SKILL.md", "M"),
    "common",
  );
  assert.equal(
    classifyPath(".claude/skills/module-scaffold/references/pointers.md", "A"),
    "common",
  );
  // skills 以外的 .claude/ 設定仍不自動歸類
  assert.equal(classifyPath(".claude/settings.json", "M"), "unknown");
});
