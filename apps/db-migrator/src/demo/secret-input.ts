/**
 * 機密的輸入(示範密碼、基底信箱、平台管理員密碼,以及專案指令要的密碼):**只從標準輸入讀**,
 * 不從參數、環境變數或檔案讀,也不寫進任何輸出。
 *
 * - 終端機(TTY):逐字讀、不回顯(raw mode),Enter 結束、Backspace 刪一字、Ctrl+C 中止
 * - 不是終端機(workflow 以管線送進來):依序一行一個值(`printf '%s\n%s\n' "$A" "$B" | pnpm …`)
 *
 * 提示文字寫到 stderr,stdout 保留給指令的摘要輸出(STRUCT-06)。
 */
import type { Readable, Writable } from "node:stream";

/** 讀一個機密;`label` 是要輸入什麼(例:「示範帳號密碼」),提示為「<label>:」。 */
export type SecretReader = (label: string) => Promise<string>;

const ENTER = new Set(["\r", "\n"]);
const BACKSPACE = new Set(["\u007F", "\b"]);
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";

interface TtyInput extends Readable {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
}

/** 從終端機讀一個值,不回顯。 */
function readFromTerminal(
  input: TtyInput,
  output: Writable,
  prompt: string,
): Promise<string> {
  output.write(prompt);
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error: Error | null): void => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
      output.write("\n");
      if (error === null) {
        resolve(value);
      } else {
        reject(error);
      }
    };
    const onData = (chunk: Buffer | string): void => {
      for (const character of String(chunk)) {
        if (ENTER.has(character)) {
          finish(null);
          return;
        }
        if (character === CTRL_C || character === CTRL_D) {
          finish(new Error("已取消輸入"));
          return;
        }
        if (BACKSPACE.has(character)) {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    input.setRawMode?.(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
  });
}

/** 讀完整個管線,切成一行一個值(去掉行尾的 `\r`)。 */
async function readAllLines(input: Readable): Promise<string[]> {
  let text = "";
  input.setEncoding("utf8");
  for await (const chunk of input) {
    text += String(chunk);
  }
  return text.split("\n").map((line) => line.replace(/\r$/, ""));
}

/**
 * 建一個讀機密的函式(同一個指令裡多次呼叫依序取值)。
 * 讀到空值一律拒絕:管線少給一行、或在終端機直接按 Enter,都不當成「空密碼」往下做。
 */
export function createSecretReader(
  input: TtyInput = process.stdin,
  output: Writable = process.stderr,
): SecretReader {
  let lines: Promise<string[]> | null = null;
  let next = 0;
  return async (label) => {
    let value: string;
    if (input.isTTY === true) {
      value = await readFromTerminal(input, output, `${label}:`);
    } else {
      lines ??= readAllLines(input);
      const all = await lines;
      value = all[next] ?? "";
      next += 1;
    }
    if (value.trim() === "") {
      throw new Error(`${label}沒有輸入值`);
    }
    return value;
  };
}
