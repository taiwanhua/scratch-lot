import { describe, expect, it } from "@jest/globals";

import { AGENT_VERSION } from "../version";
import { type CliIo, EXIT, parseArgs, runCli } from "./cli";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIo = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  return { value, out, err };
}

describe("指令列", () => {
  it("version 印版本(開發時 0.0.0;發布時由 build 烘入)", async () => {
    const { value, out } = io();
    await expect(runCli(["version"], value)).resolves.toBe(EXIT.ok);
    expect(out).toEqual([`${AGENT_VERSION}\n`]);
  });

  it("參數解析:pnpm 多帶的 -- 略過;不認得的參數、缺值都是用法錯誤", async () => {
    expect(
      parseArgs([
        "--",
        "pair",
        "--server",
        "https://x",
        "--code",
        "c",
        "--force",
      ]),
    ).toMatchObject({
      command: "pair",
      flags: new Set(["--force"]),
    });
    const { value, err } = io();
    await expect(runCli(["run", "--bogus"], value)).resolves.toBe(EXIT.usage);
    await expect(runCli(["pair", "--server"], value)).resolves.toBe(EXIT.usage);
    await expect(runCli(["pair"], value)).resolves.toBe(EXIT.usage);
    await expect(runCli([], value)).resolves.toBe(EXIT.usage);
    expect(err.join("")).toContain("用法");
  });
});
