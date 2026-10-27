/**
 * `classifyPath` 對 admin 各層 `base/` / `project/` 的判定(STRUCT-12):
 * 專案來源一律 `project`,底座共用與固定組裝入口一律 `common`;另含文件、文案、skill、根目錄設定的規則,
 * 以及「全 repo 沒有 unknown」的守門。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASE_SKILLS, classifyPath, skillOf } from "./classify.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

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

test("五支固定組裝入口判為 common:專案不改入口,與底座不同就是漂移", () => {
  for (const file of [
    "apps/admin/src/app/module-pages.tsx",
    "apps/admin/src/lib/base/help-registry.ts",
    // 搬進 lib/base/ 之前的舊位置(比對分層前的底座版本時會出現)
    "apps/admin/src/lib/help-registry.ts",
    "apps/api/src/app.module.ts",
    "apps/api/src/database/database.module.ts",
    "apps/db-migrator/seeds/registry.ts",
  ]) {
    assert.equal(classifyPath(file, "M"), "common", file);
  }
});

test("realtime / print-agent 判為 common", () => {
  assert.equal(classifyPath("apps/realtime/src/index.ts", "A"), "common");
  assert.equal(classifyPath("apps/print-agent/src/main.ts", "M"), "common");
});

test("專案的名詞表與 docs/tmp 判為 project,底座的 CONTEXT.md 與 dis.md 是 common", () => {
  assert.equal(classifyPath("CONTEXT-PROJECT.md", "M"), "project");
  for (const file of [
    "docs/tmp/project-dis.md",
    "docs/tmp/spec-project-x.md",
    "docs/tmp/handoff-round.md",
    "docs/tmp/figma-base-round/_kit.js",
    "docs/tmp/figma-base-round/project/r4-store.js",
  ]) {
    assert.equal(classifyPath(file, "A"), "project", file);
  }
  assert.equal(classifyPath("CONTEXT.md", "M"), "common");
  assert.equal(classifyPath("docs/tmp/dis.md", "M"), "common");
  // 只有 docs/tmp 根層的 dis.md 是底座的
  assert.equal(classifyPath("docs/tmp/x/dis.md", "A"), "project");
  assert.equal(classifyPath("docs/tmp/dis.md.bak", "A"), "project");
});

test("專案文件放各目錄的 project/ 與 docs/project/,其餘 docs 是底座文件(common)", () => {
  for (const file of [
    "docs/project/README.md",
    "docs/project/branding.md",
    "docs/modules/project/store.md",
    "docs/adr/project/0001-x.md",
    "docs/testing/project/scenarios.md",
  ]) {
    assert.equal(classifyPath(file, "A"), "project", file);
  }
  for (const file of [
    "docs/README.md",
    "docs/branding.md",
    "docs/project-initialization.md",
    "docs/modules/forms.md",
    "docs/adr/0002-seed.md",
    "docs/standards/general/structure.md",
  ]) {
    assert.equal(classifyPath(file, "M"), "common", file);
  }
});

test("根目錄的值行檔是 mixed,其他根層 md 不自動歸類", () => {
  for (const file of ["CLAUDE.md", "AGENTS.md", "README.md"]) {
    assert.equal(classifyPath(file, "M"), "mixed", file);
  }
  assert.equal(classifyPath("NOTES.md", "A"), "unknown");
});

test("app 的 favicon 與 public/project/ 判為 project,public 其餘是 common", () => {
  for (const file of [
    "apps/admin/public/favicon.ico",
    "apps/admin/public/project/icon.svg",
    "apps/admin/public/project/icon-192.png",
  ]) {
    assert.equal(classifyPath(file, "M"), "project", file);
  }
  assert.equal(classifyPath("apps/admin/public/robots.txt", "A"), "common");
});

test("根目錄的 .nvmrc 判為 common,其他位置的不因此改變", () => {
  assert.equal(classifyPath(".nvmrc", "A"), "common");
  assert.equal(classifyPath(".nvmrc", "M"), "common");
  assert.equal(classifyPath("apps/front/.nvmrc", "A"), "project");
  assert.equal(classifyPath("tools/.nvmrc", "A"), "unknown");
});

test("底座名單裡的 skill 判為 common,其餘 skill 目錄判為 project", () => {
  for (const root of [".claude", ".agents"]) {
    for (const name of BASE_SKILLS) {
      assert.equal(
        classifyPath(`${root}/skills/${name}/SKILL.md`, "M"),
        "common",
        `${root} ${name}`,
      );
    }
    assert.equal(
      classifyPath(`${root}/skills/acme-onboarding/SKILL.md`, "A"),
      "project",
    );
    // 名稱只是以底座 skill 開頭的不算底座 skill
    assert.equal(
      classifyPath(`${root}/skills/module-scaffold-extra/SKILL.md`, "A"),
      "project",
    );
  }
  assert.equal(
    classifyPath(".claude/skills/module-scaffold/references/pointers.md", "A"),
    "common",
  );
  assert.deepEqual(skillOf(".agents/skills/x-y/SKILL.md"), {
    root: "agents",
    name: "x-y",
  });
  assert.equal(skillOf(".claude/settings.json"), null);
});

test("底座名單的外部 skill 都登記在 skills-lock.json", () => {
  const lock = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "skills-lock.json"), "utf8"),
  );
  const external = BASE_SKILLS.filter(
    (name) => !["module-scaffold", "project-bootstrap"].includes(name),
  );
  for (const name of external) {
    assert.ok(Object.hasOwn(lock.skills, name), name);
  }
});

test("根目錄設定:可被專案擴充的判 mixed,底座固定的判 common", () => {
  for (const file of [
    "turbo.json",
    ".gitignore",
    ".prettierignore",
    ".dockerignore",
    "skills-lock.json",
    ".claude/settings.json",
  ]) {
    assert.equal(classifyPath(file, "M"), "mixed", file);
  }
  for (const file of [".npmrc", ".gitattributes", ".nvmrc"]) {
    assert.equal(classifyPath(file, "M"), "common", file);
  }
  // 子目錄的同名檔不因此改變
  assert.equal(classifyPath("apps/admin/turbo.json", "M"), "common");
  assert.equal(classifyPath("tools/.gitignore", "A"), "unknown");
});

test("專案的後台文案、domain 純邏輯、E2E 資產與 mock world 判為 project", () => {
  for (const file of [
    "packages/i18n/messages/zh-TW/project/admin.json",
    "packages/i18n/messages/en/project/admin.replacements.json",
    "packages/domain/src/project/report-period/index.ts",
    "apps/e2e/fixtures/project/receipt.png",
    "apps/e2e/src/specs/project/store.spec.ts",
    "apps/admin/src/mock/project/mock-world.ts",
  ]) {
    assert.equal(classifyPath(file, "A"), "project", file);
  }
  assert.equal(
    classifyPath("packages/i18n/messages/zh-TW/admin.json", "M"),
    "mixed",
  );
  assert.equal(
    classifyPath("packages/domain/src/permission/keys.ts", "M"),
    "common",
  );
  assert.equal(classifyPath("apps/e2e/fixtures/logo.png", "M"), "common");
  assert.equal(
    classifyPath("apps/admin/src/mock/mock-world.ts", "M"),
    "common",
  );
});

test("全 repo 的已追蹤檔都能歸類(unknown 為 0)", () => {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    maxBuffer: 1024 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter((file) => file !== "");
  assert.ok(files.length > 0);
  assert.deepEqual(
    files.filter((file) => classifyPath(file, "A") === "unknown"),
    [],
  );
});

test("Figma 稽核腳本判為 common,專案設定判為 project", () => {
  for (const file of [
    "audit.js",
    "audit-layout.js",
    "audit-sync.js",
    "audit-legend.js",
    "audit-crossview.js",
    "README.md",
    "figma-audit.test.mjs",
  ])
    assert.equal(
      classifyPath(`scripts/figma-audit/${file}`, "A"),
      "common",
      file,
    );
  assert.equal(
    classifyPath("scripts/figma-audit/project/config.js", "M"),
    "project",
  );
});
