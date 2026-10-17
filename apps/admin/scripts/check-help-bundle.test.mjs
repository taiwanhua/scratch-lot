import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "@jest/globals";

import {
  FORM_MODULE_HELP_KEY,
  composeHelpRegistry,
} from "../src/lib/base/module-help.ts";
import { HELP_SOURCES, readHelpSources } from "./help-sources.mjs";

/**
 * `check:help-bundle` 的負例與三來源:以暫存目錄擺出「說明來源 + 假的 dist/assets」,跑真的腳本看結束碼。
 * 最後一組直接讀正式的 `src/md/module-help/`:jest 裡的「?」用的是假 registry(`src/test/help-registry.ts`),
 * 正式的 md 檔有沒有碰撞要靠這裡在 CI 驗(build 後的檢查只在建 image 時跑)。
 */
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const script = join(scriptsDir, "check-help-bundle.mjs");
const realHelpDir = join(scriptsDir, "..", "src", "md", "module-help");

const segmentsOf = (id) =>
  HELP_SOURCES.find((source) => source.id === id).segments;

const help = (title, body) => `# ${title}\n\n## 這個模組做什麼\n\n${body}\n`;

const temporaryDirs = [];

/** 擺一份暫存的說明來源與 bundle;`files` 的 key 是相對於說明根目錄的路徑。 */
const workspace = ({ files, bundle }) => {
  const root = mkdtempSync(join(tmpdir(), "help-bundle-"));
  temporaryDirs.push(root);
  const helpDir = join(root, "module-help");
  const assetsDir = join(root, "assets");
  mkdirSync(helpDir, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(helpDir, ...relativePath.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  if (bundle !== undefined) {
    writeFileSync(join(assetsDir, "index-abc.js"), bundle);
  }
  return { helpDir, assetsDir };
};

const run = ({ helpDir, assetsDir }) => {
  const result = spawnSync(
    process.execPath,
    [script, `--help-dir=${helpDir}`, `--assets-dir=${assetsDir}`],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
};

const inSource = (id, name) => [...segmentsOf(id), name].join("/");

const baseFiles = () => ({
  [inSource("base", "form-module.help.md")]: help("表單模組", "表單通用說明。"),
  [inSource("base", "system.role-manager.help.md")]: help(
    "角色管理",
    "底座的角色說明。",
  ),
});

const BASE_BUNDLE = 'const a="表單通用說明。";const b="底座的角色說明。";';

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("check:help-bundle:三份來源都要在 bundle 裡", () => {
  it("底座 + 專案新增 + 專案替換都在 bundle:通過,並列出各來源份數", () => {
    const result = run(
      workspace({
        files: {
          ...baseFiles(),
          [inSource("additions", "project.report.help.md")]: help(
            "專案報表",
            "專案報表的說明。",
          ),
          [inSource("replacements", "system.role-manager.help.md")]: help(
            "角色管理",
            "專案客製的角色說明。",
          ),
        },
        // 壓縮後的 bundle 可能把非 ASCII 輸出成 \uXXXX:替換那一份用跳脫形式
        bundle: `${BASE_BUNDLE}const c="專案報表的說明。";const d="${[
          ..."專案客製的角色說明。",
        ]
          .map(
            (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
          )
          .join("")}";`,
      }),
    );

    expect(result.output).toContain("底座 2、專案新增 1、專案替換 1");
    expect(result.status).toBe(0);
  });

  it("專案的兩個目錄不存在(正式登記是空的):只驗底座,通過", () => {
    const result = run(workspace({ files: baseFiles(), bundle: BASE_BUNDLE }));

    expect(result.output).toContain("底座 2、專案新增 0、專案替換 0");
    expect(result.status).toBe(0);
  });

  it("替換的內容沒進 bundle(只有底座原文):失敗並指出那一份", () => {
    const result = run(
      workspace({
        files: {
          ...baseFiles(),
          [inSource("replacements", "system.role-manager.help.md")]: help(
            "角色管理",
            "專案客製的角色說明。",
          ),
        },
        bundle: BASE_BUNDLE,
      }),
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      inSource("replacements", "system.role-manager.help.md"),
    );
  });
});

describe("check:help-bundle:來源本身有問題就失敗", () => {
  it("底座一份都沒有(整個目錄被 .dockerignore 排掉)", () => {
    const result = run(workspace({ files: {}, bundle: "" }));

    expect(result.status).toBe(1);
    expect(result.output).toContain(".dockerignore");
  });

  it("缺必備的表單通用說明", () => {
    const files = baseFiles();
    delete files[inSource("base", "form-module.help.md")];

    const result = run(workspace({ files, bundle: BASE_BUNDLE }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("form-module.help.md");
  });

  it.each(["base", "additions", "replacements"])(
    "錯命名:%s 裡的 .md 不是 <moduleKey>.help.md",
    (source) => {
      const result = run(
        workspace({
          files: {
            ...baseFiles(),
            [inSource(source, "overview.md")]: help("總覽", "表單通用說明。"),
          },
          bundle: BASE_BUNDLE,
        }),
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain(inSource(source, "overview.md"));
    },
  );

  it("放在來源目錄以外的說明(glob 收不到)", () => {
    const result = run(
      workspace({
        files: {
          ...baseFiles(),
          "project/overview.help.md": help("總覽", "表單通用說明。"),
        },
        bundle: BASE_BUNDLE,
      }),
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain("project/overview.help.md");
  });

  it("專案新增撞到底座的 key", () => {
    const result = run(
      workspace({
        files: {
          ...baseFiles(),
          [inSource("additions", "system.role-manager.help.md")]: help(
            "角色管理",
            "底座的角色說明。",
          ),
        },
        bundle: BASE_BUNDLE,
      }),
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain("撞 key「system.role-manager」");
  });

  it("替換的對象不是底座的說明", () => {
    const result = run(
      workspace({
        files: {
          ...baseFiles(),
          [inSource("replacements", "system.nope.help.md")]: help(
            "不存在",
            "底座的角色說明。",
          ),
        },
        bundle: BASE_BUNDLE,
      }),
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain("「system.nope」不是底座的說明");
  });

  it("還沒 build(沒有 dist/assets/*.js)", () => {
    const result = run(workspace({ files: baseFiles() }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("找不到建置產物");
  });
});

describe("正式的說明來源(src/md/module-help/)", () => {
  const { files, problems } = readHelpSources(realHelpDir);
  const sourceOf = (id) =>
    Object.fromEntries(
      files
        .filter((file) => file.source === id)
        .map((file) => [
          `/src/md/module-help/${file.relativePath}`,
          file.content,
        ]),
    );

  it("檔案層沒有問題:命名、位置、必備檔、新增與替換的對象", () => {
    expect(problems).toEqual([]);
  });

  it("以正式的合成規則組得起來,而且有表單通用說明", () => {
    const registry = composeHelpRegistry({
      base: sourceOf("base"),
      additions: sourceOf("additions"),
      replacements: sourceOf("replacements"),
    });

    expect(registry.has(FORM_MODULE_HELP_KEY)).toBe(true);
    expect(registry.size).toBeGreaterThan(1);
  });
});
