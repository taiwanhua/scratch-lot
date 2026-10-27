import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

/**
 * Windows 安裝包的批次檔(`packaging/windows/*.bat`)離線檢查:打包會把整個資料夾放進 zip,
 * cmd 的語法錯誤要到店家電腦上才會發現,這裡先守住。
 */
const dir = path.resolve(__dirname, "../../packaging/windows");
const batchFiles = readdirSync(dir).filter((name) => name.endsWith(".bat"));
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");

/** `if ... (` 到 `)` 之間的 echo 行。 */
function echoLinesInBlocks(text: string): string[] {
  const lines: string[] = [];
  let depth = 0;
  for (const raw of text.split("\r\n")) {
    const line = raw.trim();
    // `)` 與 `) else (` 先收掉一層
    if (line.startsWith(")")) {
      depth -= 1;
    } else if (depth > 0 && /^echo\b/i.test(line)) {
      lines.push(line);
    }
    if (line.endsWith("(")) {
      depth += 1;
    }
  }
  return lines;
}

describe("Windows 安裝包的批次檔", () => {
  it("有安裝與重新配對兩支", () => {
    expect(
      batchFiles.toSorted((a, b) => a.localeCompare(b, "zh-Hant")),
    ).toEqual(["安裝.bat", "重新配對.bat"]);
  });

  it.each(batchFiles)("%s:CRLF、沒有 BOM、先切 UTF-8 字碼頁", (name) => {
    const text = read(name);
    expect(text.replaceAll("\r\n", "")).not.toContain("\n");
    expect(text.startsWith("@echo off\r\nchcp 65001 >nul\r\n")).toBe(true);
  });

  it.each(batchFiles)(
    "%s:區塊內 echo 的半形括號都有跳脫(否則 cmd 把 ) 當成區塊結束,整支中斷)",
    (name) => {
      const unescaped = echoLinesInBlocks(read(name)).filter((line) =>
        /[()]/.test(line.replaceAll("^(", "").replaceAll("^)", "")),
      );
      expect(unescaped).toEqual([]);
    },
  );

  it("重新配對.bat:沿用安裝.bat 的安裝位置與服務,配對加 --force", () => {
    const install = read("安裝.bat");
    const repair = read("重新配對.bat");
    for (const line of [
      String.raw`set "TARGET=%ProgramFiles%\print-agent"`,
      String.raw`set "CONFIG=%ProgramData%\print-agent"`,
      String.raw`set "SERVICE=%TARGET%\print-agent-service.exe"`,
      "sc query print-agent >nul 2>&1",
    ]) {
      expect(install).toContain(line);
      expect(repair).toContain(line);
    }
    expect(repair).toContain(
      String.raw`"%TARGET%\print-agent.exe" pair --server "%SERVER%" --code "%CODE%" --force`,
    );
    // WinSW 的 stop 只送出停止就返回,緊接著 start 會撞上「停止中」;stopwait 等到真的停了
    for (const text of [install, repair]) {
      expect(text).toContain('"%SERVICE%" stopwait >nul 2>&1');
      expect(text).not.toMatch(/"%SERVICE%" stop /);
    }
    expect(repair).toContain('"%SERVICE%" start || goto :fail');
  });
});
