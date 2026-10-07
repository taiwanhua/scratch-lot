import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { CLOUD_OUTPUT_KEYS } from "./config.mjs";
import { disabledCloud, makeProjectRoot, runScript } from "./test-support.mjs";

const REPO = "acme/widgets";

function write(scope, input, { preset = "" } = {}) {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "github-output-")),
    "out.txt",
  );
  writeFileSync(file, preset);
  const result = runScript("write-github-output.mjs", ["--scope", scope], {
    input,
    env: { GITHUB_OUTPUT: file },
  });
  return { ...result, written: readFileSync(file, "utf8") };
}

const resolved = (args) =>
  runScript("read-config.mjs", args, { cwd: makeProjectRoot() }).stdout;

test("cloud:把讀取器的 JSON 映射成固定十六個 key=value,附加在既有輸出之後", () => {
  const input = resolved([
    "--scope",
    "cloud",
    "--environment",
    "staging",
    "--repository",
    REPO,
  ]);
  const result = write("cloud", input, { preset: "sha=abc1234\n" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const lines = result.written.trimEnd().split("\n");
  assert.equal(lines[0], "sha=abc1234");
  assert.deepEqual(
    lines.slice(1).map((line) => line.slice(0, line.indexOf("="))),
    CLOUD_OUTPUT_KEYS,
  );
  assert.ok(lines.includes("api_service=widgets-api-staging"));
  assert.ok(lines.includes("api_url=https://api-staging.widgets.example"));
});

test("cloud:Resend 停用時只允許 resend_secret 為空輸出", () => {
  const full = JSON.parse(
    resolved([
      "--scope",
      "cloud",
      "--environment",
      "dev",
      "--repository",
      REPO,
    ]),
  );
  full.resend_secret = "";
  const result = write("cloud", JSON.stringify(full));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.written.includes("resend_secret=\n"));
  full.jwt_secret = "";
  const invalid = write("cloud", JSON.stringify(full));
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.written, "");
});

test("github 啟用:enabled / project_id / status_field_id 與單行 JSON 的 options", () => {
  const result = write(
    "github",
    resolved(["--scope", "github", "--repository", REPO]),
  );
  assert.equal(result.status, 0, result.stderr);
  const lines = result.written.trimEnd().split("\n");
  assert.deepEqual(
    lines.map((line) => line.slice(0, line.indexOf("="))),
    ["enabled", "project_id", "status_field_id", "options"],
  );
  assert.equal(lines[0], "enabled=true");
  assert.equal(lines[1], "project_id=PVT_sampleProject");
  assert.equal(
    JSON.parse(lines[3].slice("options=".length)).review,
    "a0000004",
  );
});

test("github 停用:只寫 enabled=false", () => {
  const result = write("github", '{"enabled":false}\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.written, "enabled=false\n");
});

test("輸入是空的(讀取器失敗)、不是 JSON、鍵不符或多鍵:失敗且一個字都不寫", () => {
  const full = JSON.parse(
    resolved([
      "--scope",
      "cloud",
      "--environment",
      "dev",
      "--repository",
      REPO,
    ]),
  );
  const missing = { ...full };
  delete missing.jwt_secret;
  const cases = [
    ["cloud", ""],
    ["cloud", "not json"],
    ["cloud", JSON.stringify(missing)],
    ["cloud", JSON.stringify({ ...full, GITHUB_ENV: "x" })],
    ["cloud", JSON.stringify({ ...full, region: 5 })],
    ["cloud", JSON.stringify([full])],
    ["github", JSON.stringify({ enabled: "yes" })],
    ["github", JSON.stringify({ enabled: true })],
    ["github", JSON.stringify({ enabled: false, project_id: "x" })],
    ["github", JSON.stringify(full)],
  ];
  for (const [scope, input] of cases) {
    const result = write(scope, input, { preset: "sha=abc1234\n" });
    assert.notEqual(result.status, 0, input);
    assert.equal(result.written, "sha=abc1234\n", input);
    assert.notEqual(result.stderr, "");
  }
});

test("cloud 停用:明確錯誤、非零退出,既有 GITHUB_OUTPUT 不增加任何內容", () => {
  const input = runScript(
    "read-config.mjs",
    ["--scope", "cloud", "--environment", "dev", "--repository", REPO],
    { cwd: makeProjectRoot({ cloud: disabledCloud() }) },
  ).stdout;
  assert.equal(input, '{"enabled":false}\n');
  for (const preset of ["", "sha=abc1234\n"]) {
    const result = write("cloud", input, { preset });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.written, preset);
    assert.match(
      result.stderr,
      /^project-settings: [^\n]*雲端尚未啟用[^\n]*\n$/,
    );
  }
});

test("cloud 停用狀態夾帶其他鍵或 enabled 不是 false:拒絕、不寫,錯誤不回印輸入值", () => {
  const full = JSON.parse(
    resolved([
      "--scope",
      "cloud",
      "--environment",
      "dev",
      "--repository",
      REPO,
    ]),
  );
  const cases = [
    { enabled: false, gcp_project_id: "leaked-project-id" },
    { enabled: false, note: "leaked-secret-value" },
    { ...full, enabled: false },
    { ...full, enabled: true },
    { enabled: true },
    { enabled: null },
    { enabled: "false" },
    { enabled: 0 },
  ];
  for (const config of cases) {
    const input = JSON.stringify(config);
    const result = write("cloud", input, { preset: "sha=abc1234\n" });
    assert.notEqual(result.status, 0, input);
    assert.equal(result.written, "sha=abc1234\n", input);
    assert.match(result.stderr, /^project-settings: [^\n]+\n$/, input);
    assert.doesNotMatch(
      result.stderr,
      /leaked|acme-widgets|widgets-api|db-uri|owner@/,
      input,
    );
  }
});

test("值含換行或其他控制字元:拒絕,不能在輸出檔多寫一行(輸出鍵注入)", () => {
  const full = JSON.parse(
    resolved([
      "--scope",
      "cloud",
      "--environment",
      "dev",
      "--repository",
      REPO,
    ]),
  );
  for (const bad of ["x\ninjected=1", "x\rinjected=1", "x\u0000"]) {
    const result = write(
      "cloud",
      JSON.stringify({ ...full, root_account: bad }),
    );
    assert.notEqual(result.status, 0);
    assert.equal(result.written, "");
  }
});

test("shell 特殊字元原樣寫成值,不展開", () => {
  const full = JSON.parse(
    resolved([
      "--scope",
      "cloud",
      "--environment",
      "dev",
      "--repository",
      REPO,
    ]),
  );
  const result = write(
    "cloud",
    JSON.stringify({ ...full, root_account: "o'wner $(id) `id` ;x" }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.written.split("\n").includes("root_account=o'wner $(id) `id` ;x"),
  );
});

test("未知 scope、缺 GITHUB_OUTPUT:失敗", () => {
  assert.notEqual(write("all", "{}").status, 0);
  const result = runScript("write-github-output.mjs", ["--scope", "github"], {
    input: '{"enabled":false}',
    env: { GITHUB_OUTPUT: "" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GITHUB_OUTPUT/);
});
