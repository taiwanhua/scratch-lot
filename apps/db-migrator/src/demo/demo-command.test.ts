import { describe, expect, it } from "@jest/globals";

import { type DemoCommandOptions, runDemoCommand } from "./command";
import type { DemoSource } from "./demo-source";
import type { FetchLike } from "./graphql-client";

const URI = "mongodb://127.0.0.1:27017/scratch-lot-dev";
const DATABASE = "scratch-lot-dev";
const API_URL = "http://127.0.0.1:1";
const DEMO_PASSWORD = ["demo", "secret", "pass", "1"].join("-");
const EMAIL_BASE = ["owner", "example.com"].join("@");
const ROOT_PASSWORD = ["root", "secret", "2"].join("-");

interface Harness {
  options: DemoCommandOptions;
  calls: string[];
  secretsRead: string[];
  populated: number;
}

/** 假的 api / 機密輸入 / 示範資料:記下指令碰了哪些東西。 */
function harness(
  env: Record<string, string | undefined> = {},
  respond: FetchLike = () =>
    Promise.resolve({ status: 200, text: () => Promise.resolve("{}") }),
): Harness {
  const state: Harness = {
    calls: [],
    secretsRead: [],
    populated: 0,
    options: {} as DemoCommandOptions,
  };
  const source: DemoSource = {
    tenant: { name: "示範機構", slug: "demo_test", adminAlias: "demo-admin" },
    populate: () => {
      state.populated += 1;
      return Promise.resolve();
    },
  };
  state.options = {
    env: {
      MONGODB_URI: URI,
      DEMO_ALLOW_ENV: "dev",
      ROOT_ADMIN_ACCOUNT: "root",
      ROOT_ADMIN_PASSWORD: ROOT_PASSWORD,
      ...env,
    },
    readSecret: (label) => {
      state.secretsRead.push(label);
      return Promise.resolve(
        label === "示範帳號密碼" ? DEMO_PASSWORD : EMAIL_BASE,
      );
    },
    loadDemoSource: () => Promise.resolve(source),
    fetch: (url, init) => {
      state.calls.push(init.body);
      return respond(url, init);
    },
    print: () => true,
  };
  return state;
}

function args(
  overrides: Partial<Record<"environment" | "mode" | "confirm", string>> = {},
): string[] {
  const environment = overrides.environment ?? "dev";
  const mode = overrides.mode ?? "create";
  const confirm =
    overrides.confirm ?? ["demo", environment, DATABASE, mode].join(":");
  return [
    `--environment=${environment}`,
    `--mode=${mode}`,
    `--confirm=${confirm}`,
    `--api-url=${API_URL}`,
  ];
}

describe("demo 指令:不執行的情況一筆都不寫(規格 2.2 操作表)", () => {
  it.each([
    ["確認字串少一個字", args({ confirm: `demo:dev:${DATABASE}:creat` })],
    [
      "確認字串的環境對不上",
      args({ confirm: `demo:staging:${DATABASE}:create` }),
    ],
    [
      "確認字串的 mode 對不上",
      args({ confirm: `demo:dev:${DATABASE}:rebuild` }),
    ],
    ["確認字串的資料庫名對不上", args({ confirm: "demo:dev:other-db:create" })],
  ])("%s:不執行,沒有呼叫 api、沒有讀機密", async (_case, argv) => {
    const state = harness();
    await expect(runDemoCommand(argv, state.options)).rejects.toThrow(
      /--confirm 與目標不符/,
    );
    expect(state.calls).toEqual([]);
    expect(state.secretsRead).toEqual([]);
    expect(state.populated).toBe(0);
  });

  it("--environment 不在 DEMO_ALLOW_ENV:不執行", async () => {
    const state = harness({ DEMO_ALLOW_ENV: "staging" });
    await expect(runDemoCommand(args(), state.options)).rejects.toThrow(
      /DEMO_ALLOW_ENV/,
    );
    expect(state.calls).toEqual([]);
    expect(state.secretsRead).toEqual([]);
  });

  it.each(["purge", "rebuild"])(
    "--mode=%s:安全閥通過也先拒絕(清空 / 重建另行實作),沒有呼叫 api",
    async (mode) => {
      const state = harness();
      await expect(
        runDemoCommand(args({ mode }), state.options),
      ).rejects.toThrow(/尚未提供/);
      expect(state.calls).toEqual([]);
      expect(state.secretsRead).toEqual([]);
    },
  );

  it("密碼不從參數讀:多給任何參數(例 --password)直接拒絕", async () => {
    const state = harness();
    await expect(
      runDemoCommand([...args(), `--password=${DEMO_PASSWORD}`], state.options),
    ).rejects.toThrow(/無法辨識的參數/);
    expect(state.calls).toEqual([]);
  });

  it("沒給 --api-url:不執行", async () => {
    const state = harness();
    await expect(
      runDemoCommand(args().slice(0, 3), state.options),
    ).rejects.toThrow(/--api-url 必填/);
    expect(state.calls).toEqual([]);
  });

  it("示範密碼與基底信箱從機密輸入讀(依序兩個),api 的錯誤訊息裡若帶到機密一律遮掉", async () => {
    const state = harness({}, () =>
      Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              errors: [
                {
                  message: `echo ${ROOT_PASSWORD} ${DEMO_PASSWORD} ${EMAIL_BASE}`,
                  extensions: { code: "UNAUTHENTICATED" },
                },
              ],
            }),
          ),
      }),
    );
    const failure = runDemoCommand(args(), state.options);
    await expect(failure).rejects.toThrow(/登入失敗/);
    const message = await failure.catch((error: unknown) =>
      error instanceof Error ? error.message : "",
    );
    expect(state.secretsRead).toEqual(["示範帳號密碼", "基底信箱"]);
    expect(message).not.toContain(ROOT_PASSWORD);
    expect(message).not.toContain(DEMO_PASSWORD);
    expect(message).not.toContain(EMAIL_BASE);
    // 送出的請求只有 root 登入那一筆
    expect(state.calls).toHaveLength(1);
    expect(state.populated).toBe(0);
  });
});
