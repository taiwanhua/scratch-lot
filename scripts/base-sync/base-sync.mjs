/**
 * 底座跨 repo 升級與回收的共用入口(操作正本:docs/deployment.md「底座首次接軌與版本升級」「共用改良回收」)。
 *
 * 命令與參數見 `--help`(args.mjs 依參數表產生)。說明只輸出用法,不碰 repo、網路或 gh。
 *
 * 一般命令成功:stdout 一個 JSON 物件、exit 0。verify:stdout 是 Markdown 報告,四節皆為 0 才 exit 0,否則 exit 1(stderr 空)。
 * 失敗:stdout 空、stderr 一行安全摘要、exit 1。
 * 只準備隔離的 feature 工作樹;不 push、不開 PR、不 merge 到環境分支、不部署、不 stash 或清除工作樹。
 * 系統邊界:`runExternal(command, args)` 是 gh(可回傳 Promise);`fetchRemote({ root, remote, repository, refspec })`
 * 是網路 fetch(remote 的設定與實際 fetch 身分已先核對)。其餘 Git 操作一律直接執行。
 */
import { singleLine } from "../project-settings/single-line.mjs";
import { parseArguments, usage } from "./args.mjs";
import { contribute } from "./contribute.mjs";
import { BaseSyncError } from "./errors.mjs";
import { runExternalCommand } from "./external.mjs";
import { fetchFromRemote } from "./git.mjs";
import { inspect } from "./inspect.mjs";
import { upgrade } from "./upgrade.mjs";
import { verify } from "./verify.mjs";

const COMMANDS = { inspect, upgrade, contribute, verify };

export async function runBaseSync(
  argv,
  { runExternal = runExternalCommand, fetchRemote = fetchFromRemote } = {},
) {
  try {
    const { help, command, options } = parseArguments(argv);
    if (help) return { exitCode: 0, stdout: usage(command), stderr: "" };
    const report = await COMMANDS[command](options, {
      runExternal,
      fetchRemote,
    });
    if (command === "verify") {
      return {
        exitCode: report.isClean ? 0 : 1,
        stdout: report.markdown,
        stderr: "",
      };
    }
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(report, null, 2)}\n`,
      stderr: "",
    };
  } catch (error) {
    // 未預期的錯誤不印原訊息:可能帶路徑以外的子行程輸出
    const message =
      error instanceof BaseSyncError ? error.message : "未預期的錯誤";
    return {
      exitCode: 1,
      stdout: "",
      stderr: `base-sync: ${singleLine(message)}\n`,
    };
  }
}
