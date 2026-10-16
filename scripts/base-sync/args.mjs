/** 命令列解析。錯誤訊息只用固定文字與白名單內的參數名,不回印 argv 原值。 */
import { fail } from "./errors.mjs";

const COMMANDS = {
  inspect: { "--project": "project", "--from": "from", "--to": "to" },
  upgrade: {
    "--project": "projects",
    "--tag": "tag",
    "--worktree-root": "worktreeRoot",
  },
  contribute: {
    "--project": "project",
    "--commit": "commit",
    "--base": "base",
    "--worktree-root": "worktreeRoot",
    "--accept-mixed": "acceptMixed",
  },
};

/** 可重複的參數(輸出成陣列)。 */
const REPEATABLE = new Set(["projects", "acceptMixed"]);

/** 可省略的參數;其餘都必填。 */
const OPTIONAL = new Set(["acceptMixed"]);

const HELP_FLAGS = new Set(["--help", "-h"]);

const PROGRAM = "node scripts/base-sync/run.mjs";

/** 各命令的說明;用法列由上方參數表產生。 */
const SUMMARIES = {
  inspect: [
    "唯讀:核對專案 repo 的身分與採用版本,逐檔列出兩個 commit 之間的完整差異與維護歸屬。",
    "--project 是專案 repo 根目錄;--from / --to 是完整 40 位 commit SHA。不 fetch、不寫任何 ref。",
  ],
  upgrade: [
    "逐案從 origin/main 建隔離工作樹與 feature 分支,以 --tag 版本做正常三方 merge 但不提交,留給人工整合。",
    "--project 是專案 repo 根目錄,可重複以批次升級同一底座的多個專案;工作樹建在已存在的 --worktree-root 目錄之下。",
  ],
  contribute: [
    "把專案一個 commit 相對其 parent 的精確差異,從底座最新 origin/main 準備成 contribution 分支(common 路徑與明列的混合檔),只 stage 不提交。",
    "--project 是來源專案根目錄、--commit 是完整 40 位 commit SHA、--base 是底座 repo 根目錄;工作樹建在已存在的 --worktree-root 目錄之下。",
    "--accept-mixed 可省略、可重複:明列只含底座段落的混合檔才接受,其差異列進報告供審查;未明列的混合檔、未知路徑、已發布資料、專案路徑與 merge commit 一律拒絕。",
  ],
};

const FOOTER = [
  "輸出:一般命令成功時 stdout 一個 JSON 物件、exit 0;失敗時 stdout 為空、stderr 一行摘要、exit 1。說明輸出純文字、exit 0。",
  "限制:upgrade / contribute 只準備隔離的 feature 工作樹;所有命令都不合併環境分支、不 push、不開 PR、不部署、不重置資料庫,也不 stash、reset 或清除既有工作樹。",
];

function synopsis(command) {
  const options = Object.entries(COMMANDS[command]).map(([name, key]) => {
    const option = `${name} <${name.slice(2)}>`;
    if (OPTIONAL.has(key)) return `[${option} ...]`;
    return REPEATABLE.has(key) ? `${option} [${option} ...]` : option;
  });
  return `${command} ${options.join(" ")}`;
}

/** 說明文字:不帶命令是總覽,帶命令只列該命令。 */
export function usage(command) {
  const lines =
    command === undefined
      ? [
          `用法:${PROGRAM} <命令> <參數…>`,
          `      ${PROGRAM} [命令] --help | -h`,
          "",
          "底座跨 repo 升級與回收的共用入口;每個命令列出的參數除方括號內的以外都必填。",
          "",
          ...Object.keys(COMMANDS).flatMap((name) => [
            `  ${synopsis(name)}`,
            ...SUMMARIES[name].map((line) => `    ${line}`),
            "",
          ]),
        ]
      : [`用法:${PROGRAM} ${synopsis(command)}`, "", ...SUMMARIES[command], ""];
  return `${[...lines, ...FOOTER].join("\n")}\n`;
}

/** 說明只認 `--help` / `-h` 與 `<命令> --help` / `<命令> -h`,回傳 `{ help: true, command? }`;其餘寫法照常解析。 */
export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (argv.length === 1 && HELP_FLAGS.has(command)) return { help: true };
  if (!Object.hasOwn(COMMANDS, command ?? "")) {
    fail(`命令必須是 ${Object.keys(COMMANDS).join(" / ")}`);
  }
  if (rest.length === 1 && HELP_FLAGS.has(rest[0])) {
    return { help: true, command };
  }
  const spec = COMMANDS[command];
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!Object.hasOwn(spec, name)) {
      fail(
        `${command} 不接受這個參數(只接受 ${Object.keys(spec).join(" / ")})`,
      );
    }
    if (value === undefined || value === "" || value.startsWith("-")) {
      fail(`參數 ${name} 缺少值`);
    }
    const key = spec[name];
    if (REPEATABLE.has(key)) {
      options[key] = [...(options[key] ?? []), value];
    } else if (Object.hasOwn(options, key)) {
      fail(`參數 ${name} 重複`);
    } else {
      options[key] = value;
    }
  }
  for (const [name, key] of Object.entries(spec)) {
    if (!Object.hasOwn(options, key) && !OPTIONAL.has(key)) {
      fail(`${command} 需要 ${name}`);
    }
  }
  return { command, options };
}
