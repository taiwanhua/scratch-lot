/**
 * base-sync 說明入口的行為測試:只接受文件化的說明寫法,不碰 repo、網路或 gh。
 * 原本的同步流程與錯誤協定由 base-sync.test.mjs 覆蓋,這裡不重測。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runBaseSync } from "./base-sync.mjs";

const CHINESE = /[一-鿿]/;

/** 每個命令說明必須列出的必要參數。 */
const REQUIRED = {
  inspect: ["--project", "--from", "--to"],
  upgrade: ["--project", "--tag", "--worktree-root"],
  contribute: ["--project", "--commit", "--base", "--worktree-root"],
  verify: ["--project", "--tag"],
};

function assertHelp(result, form) {
  assert.equal(result.exitCode ?? result.status, 0, form.join(" "));
  assert.equal(result.stderr, "", form.join(" "));
  assert.match(result.stdout, CHINESE, form.join(" "));
}

test("說明:十種文件化寫法都以繁中用法成功結束,且不呼叫 gh 或網路 fetch;其他寫法維持原本的錯誤", async () => {
  const calls = [];
  const boundaries = {
    runExternal: (...args) => {
      calls.push(["runExternal", ...args]);
      throw new Error("說明不該呼叫 gh");
    },
    fetchRemote: (...args) => {
      calls.push(["fetchRemote", ...args]);
      throw new Error("說明不該 fetch");
    },
  };

  for (const flag of ["--help", "-h"]) {
    const result = await runBaseSync([flag], boundaries);
    assertHelp(result, [flag]);
    for (const command of Object.keys(REQUIRED)) {
      assert.match(result.stdout, new RegExp(command));
    }
    // 批次升級:--project 可重複;作業邊界:不 push
    assert.match(result.stdout, /--project[^\n]*\.\.\./);
    assert.match(result.stdout, /不[^\n]*push/);
  }

  for (const [command, required] of Object.entries(REQUIRED)) {
    for (const flag of ["--help", "-h"]) {
      const result = await runBaseSync([command, flag], boundaries);
      assertHelp(result, [command, flag]);
      assert.match(result.stdout, new RegExp(command));
      for (const name of required) {
        assert.match(result.stdout, new RegExp(name));
      }
    }
  }
  // 可省略、可重複的參數以方括號標示
  const contributeHelp = await runBaseSync(
    ["contribute", "--help"],
    boundaries,
  );
  assert.match(contributeHelp.stdout, /\[--accept-mixed <[^>]+> \.\.\.\]/);
  // verify:--out 可省略、不可重複;說明退出碼的意義與不含 Figma / CI
  const verifyHelp = await runBaseSync(["verify", "--help"], boundaries);
  assert.match(verifyHelp.stdout, /\[--out <out>\](?! \.\.\.)/);
  assert.match(verifyHelp.stdout, /exit 0/);
  assert.match(verifyHelp.stdout, /Figma/);
  assert.deepEqual(calls, []);

  const rejected = [
    [["bogus", "--help"], "命令必須是 inspect / upgrade / contribute / verify"],
    [
      ["--help", "inspect"],
      "命令必須是 inspect / upgrade / contribute / verify",
    ],
    [
      ["inspect", "--unknown", "--help"],
      "inspect 不接受這個參數(只接受 --project / --from / --to)",
    ],
    [
      ["inspect", "--help", "extra"],
      "inspect 不接受這個參數(只接受 --project / --from / --to)",
    ],
    [
      ["upgrade", "--project", "repo", "-h"],
      "upgrade 不接受這個參數(只接受 --project / --tag / --worktree-root)",
    ],
  ];
  for (const [argv, message] of rejected) {
    assert.deepEqual(
      await runBaseSync(argv, boundaries),
      { exitCode: 1, stdout: "", stderr: `base-sync: ${message}\n` },
      argv.join(" "),
    );
  }
  assert.deepEqual(calls, []);
});

test("CLI 說明:在非 repo 的空目錄、PATH 上沒有 git / gh 時仍成功輸出", (t) => {
  const cli = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "run.mjs",
  );
  const cwd = mkdtempSync(path.join(tmpdir(), "base-sync-help-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key.toUpperCase() !== "PATH" && !key.startsWith("GIT_"),
    ),
  );
  env.PATH = cwd;

  for (const form of [["--help"], ["upgrade", "-h"]]) {
    const result = spawnSync(process.execPath, [cli, ...form], {
      cwd,
      env,
      encoding: "utf8",
    });
    assertHelp(result, form);
  }
});
