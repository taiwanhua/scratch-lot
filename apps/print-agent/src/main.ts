import { runCli } from "./cli/cli";

/** 執行檔進入點(SEA 打包的 main;開發時 `pnpm --filter @repo/print-agent agent <指令>`)。 */
// eslint-disable-next-line unicorn/prefer-top-level-await -- 打包成 CommonJS(Node 24 的 SEA 只吃 CommonJS 主程式),不能用 top-level await
void runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
