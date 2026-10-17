import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { PRINT_AGENT_PLATFORMS } from "@repo/domain/printing";

/**
 * `.github/workflows/print-agent-release.yml` 的離線檢查(不觸發 Actions、不碰雲端;
 * 只手動觸發的 workflow 在合進 main 前叫不動,先用這裡守住接線,見 docs/agents/issue-tracker.md)。
 */
const workflow = readFileSync(
  path.resolve(
    __dirname,
    "../../../../.github/workflows/print-agent-release.yml",
  ),
  "utf8",
).replaceAll("\r\n", "\n");

/** 取出每個 `run: |` 區塊的內容。 */
const NEWLINE = "\n";
const RUN_BLOCK = /^(\s*)(?:- )?run: \|$/;

function runBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: { indent: number; lines: string[] } | null = null;
  for (const line of text.split(NEWLINE)) {
    const inside =
      current !== null &&
      (line.trim() === "" ||
        line.length - line.trimStart().length > current.indent);
    if (current !== null && inside) {
      current.lines.push(line);
      continue;
    }
    if (current !== null) {
      blocks.push(current.lines.join(NEWLINE));
      current = null;
    }
    const match = RUN_BLOCK.exec(line);
    if (match !== null) {
      current = { indent: (match[1] ?? "").length, lines: [] };
    }
  }
  if (current !== null) {
    blocks.push(current.lines.join(NEWLINE));
  }
  return blocks;
}

function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("print-agent-release.yml", () => {
  it("只能手動觸發,輸入 version 與 environment(dev / staging / production)", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(workflow).not.toMatch(
      /^ {2}(push|pull_request|schedule|workflow_run):/m,
    );
    expect(workflow).toMatch(/\n {6}version:\n/);
    expect(workflow).toMatch(/options: \[dev, staging, production\]/);
  });

  it("四個平台各一個 runner,與 @repo/domain/printing 的平台清單一致", () => {
    const platforms = [...job("build").matchAll(/- platform: ([\w-]+)/g)].map(
      (match) => match[1],
    );
    expect(platforms).toEqual([...PRINT_AGENT_PLATFORMS]);
  });

  it("只有 publish job 拿 id-token(WIF);整體權限只讀", () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    expect(job("build")).not.toContain("id-token");
    expect(job("publish")).toContain("id-token: write");
    expect(job("publish")).toContain("google-github-actions/auth@v2");
  });

  it("run 腳本不內插 ${{ }}、不用 eval;設定值只經 env 傳入", () => {
    const blocks = runBlocks(workflow);
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    for (const block of blocks) {
      expect(block).not.toMatch(/\$\{\{/);
      expect(block).not.toMatch(/\beval\b/);
    }
  });

  it("不寫死專案識別:bucket 由 deploy/env 讀、WIF 與部署 SA 由專案設定讀", () => {
    expect(workflow).toContain("scripts/release-bucket.ts");
    expect(workflow).toContain(
      "scripts/project-settings/read-config.mjs --scope cloud",
    );
    expect(workflow).not.toMatch(
      /scratch-lot|cookhome|iam\.gserviceaccount\.com|projects\/\d+/,
    );
  });

  it("先上傳四個檔、再換 manifest、最後才刪舊版;WinSW 固定版本並核對 SHA-256", () => {
    const publish = job("publish");
    const upload = publish.indexOf('name="print-agent/$VERSION/');
    const manifest = publish.indexOf(
      'put "$work/manifest.json" print-agent/manifest.json',
    );
    const remove = publish.indexOf("-X DELETE");
    expect(upload).toBeGreaterThan(-1);
    expect(manifest).toBeGreaterThan(upload);
    expect(remove).toBeGreaterThan(manifest);
    expect(workflow).toContain(
      "print-agent/manifest.json application/json no-store",
    );
  });

  it("發布只打單一物件端點,不用會先列出 bucket 的 gcloud storage cp / rm(部署 SA 沒有 objects.list)", () => {
    const publish = job("publish");
    const storageCommands = publish
      .split(NEWLINE)
      .filter((line) => line.trimStart().startsWith("gcloud storage "));
    expect(storageCommands).toEqual([]);
    expect(publish).toContain(
      "https://storage.googleapis.com/storage/v1/b/$BUCKET/o",
    );
    expect(workflow).toMatch(/WINSW_SHA256: [\da-f]{64}\n/);
    expect(workflow).toContain('if [ "$actual" != "$WINSW_SHA256" ]');
  });

  it("checkout 不留 git 認證(persist-credentials: false)", () => {
    const checkouts = workflow.split("uses: actions/checkout@v4").length - 1;
    const safe =
      workflow.split(
        "uses: actions/checkout@v4\n        with:\n          persist-credentials: false",
      ).length - 1;
    expect(checkouts).toBe(2);
    expect(safe).toBe(2);
  });
});
