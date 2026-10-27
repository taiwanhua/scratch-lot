import { PassThrough, Readable } from "node:stream";

import { describe, expect, it } from "@jest/globals";

import { aliasEmail } from "./demo-source";
import { createSecretReader } from "./secret-input";

/** 收下寫到 stderr 的內容(看有沒有回顯)。 */
function sink(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  let written = "";
  stream.on("data", (chunk: Buffer) => {
    written += chunk.toString("utf8");
  });
  return { stream, text: () => written };
}

describe("機密輸入:只從標準輸入讀", () => {
  it("管線(workflow):一行一個值,依序取用;少給一行 → 拒絕,不當成空密碼", async () => {
    const output = sink();
    const read = createSecretReader(
      Readable.from(["first-secret\r\nsecond", "@example.com\n"]),
      output.stream,
    );
    expect(await read("示範帳號密碼")).toBe("first-secret");
    expect(await read("基底信箱")).toBe("second@example.com");
    await expect(read("第三個")).rejects.toThrow("第三個沒有輸入值");
    expect(output.text()).not.toContain("first-secret");
  });

  it("終端機:不回顯,Backspace 刪一字、Enter 結束;只印提示", async () => {
    const rawModes: boolean[] = [];
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: (mode: boolean) => {
        rawModes.push(mode);
      },
    });
    const output = sink();
    const read = createSecretReader(input, output.stream);
    const value = read("租戶管理員密碼");
    input.write("pass");
    input.write("x\u007Fword\r");
    expect(await value).toBe("password");
    expect(rawModes).toEqual([true, false]);
    expect(output.text()).toBe("租戶管理員密碼:\n");
  });

  it("終端機:Ctrl+C 取消", async () => {
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: () => true,
    });
    const read = createSecretReader(input, sink().stream);
    const value = read("示範帳號密碼");
    input.write("abc\u0003");
    await expect(value).rejects.toThrow("已取消輸入");
  });
});

describe("示範帳號的信箱:基底加 + 別名", () => {
  it("name@example.com + demo-admin → name+demo-admin@example.com", () => {
    expect(aliasEmail(" name@example.com ", "demo-admin")).toBe(
      "name+demo-admin@example.com",
    );
  });

  it("基底不是信箱、已帶 + 別名、別名不合格式:拒絕,訊息不帶基底本身", () => {
    for (const base of ["someone", "@corp.test", "x+y@corp.test", "x@corp"]) {
      expect(() => aliasEmail(base, "demo-admin")).toThrow(/基底信箱格式不對/);
      try {
        aliasEmail(base, "demo-admin");
      } catch (error) {
        expect((error as Error).message).not.toContain(base);
      }
    }
    expect(() => aliasEmail("name@example.com", "Demo Admin")).toThrow(/別名/);
  });
});
