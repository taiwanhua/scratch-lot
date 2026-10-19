import { describe, expect, it } from "@jest/globals";

import {
  type DemoCommandOptions,
  redactSecrets,
  runDemoCommand,
} from "./command";
import type { DemoSource } from "./demo-source";
import type { FetchLike } from "./graphql-client";

const DATABASE = "wowgo-base-dev";
const API_URL = "http://127.0.0.1:1";
const DEMO_PASSWORD = ["demo", "secret", "pass", "1"].join("-");
const EMAIL_BASE = ["owner", "example.com"].join("@");
const ROOT_PASSWORD = ["root", "secret", "pass", "2"].join("-");

interface Harness {
  options: DemoCommandOptions;
  /** 送出的 GraphQL 操作名(依序)。 */
  operations: string[];
  secretsRead: string[];
  populated: number;
}

/** 回一個 GraphQL 回應的假 fetch。 */
function reply(body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

/** 假 api:root 登入成功、`provisionTarget` 回 `apiDatabase`;其他操作一律回錯(寫入不該走到)。 */
function fakeApi(apiDatabase: string): FetchLike {
  return (_url, init) => {
    const { query } = JSON.parse(init.body) as { query: string };
    if (query.includes("login(")) {
      return reply({ data: { login: { accessToken: "token" } } });
    }
    if (query.includes("provisionTarget")) {
      return reply({
        data: { provisionTarget: { databaseName: apiDatabase } },
      });
    }
    return reply({ errors: [{ message: "測試的假 api 不接受寫入" }] });
  };
}

function secretFor(label: string): string {
  if (label === "基底信箱") {
    return EMAIL_BASE;
  }
  return label === "平台管理員密碼" ? ROOT_PASSWORD : DEMO_PASSWORD;
}

/** 假的 api / 機密輸入 / 示範資料:記下指令碰了哪些東西。 */
function harness(
  env: Record<string, string | undefined> = {},
  respond: FetchLike = fakeApi(DATABASE),
): Harness {
  const state: Harness = {
    operations: [],
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
      DEMO_ALLOW_ENV: "dev",
      ROOT_ADMIN_ACCOUNT: "root",
      ROOT_ADMIN_PASSWORD: ROOT_PASSWORD,
      ...env,
    },
    readSecret: (label) => {
      state.secretsRead.push(label);
      return Promise.resolve(secretFor(label));
    },
    loadDemoSource: () => Promise.resolve(source),
    fetch: (url, init) => {
      const { query } = JSON.parse(init.body) as { query: string };
      state.operations.push(/(?:query|mutation) (\w+)/.exec(query)?.[1] ?? "");
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
  ])("%s:不執行,沒有呼叫 api、沒有讀機密", async (_case, argv) => {
    const state = harness();
    await expect(runDemoCommand(argv, state.options)).rejects.toThrow(
      /--confirm 與目標不符/,
    );
    expect(state.operations).toEqual([]);
    expect(state.secretsRead).toEqual([]);
    expect(state.populated).toBe(0);
  });

  it("確認字串的資料庫名與 api 回報的不同(例:--api-url 指到別的環境):只做了 root 登入與讀目標,沒有寫入、沒讀示範機密", async () => {
    const state = harness({}, fakeApi("wowgo-base-staging"));
    await expect(runDemoCommand(args(), state.options)).rejects.toThrow(
      /資料庫名段不符.*--api-url/,
    );
    expect(state.operations).toEqual(["DemoLogin", "DemoProvisionTarget"]);
    expect(state.secretsRead).toEqual([]);
    expect(state.populated).toBe(0);
  });

  it("不需要 MONGODB_URI:資料庫名一律以 api 回報的為準", async () => {
    const state = harness({ MONGODB_URI: undefined });
    // 確認字串通過後才往下,到第一個要寫入前的讀取才因假 api 停下
    await expect(runDemoCommand(args(), state.options)).rejects.toThrow(
      /假 api/,
    );
    expect(state.operations.slice(0, 2)).toEqual([
      "DemoLogin",
      "DemoProvisionTarget",
    ]);
    expect(state.secretsRead).toEqual(["示範帳號密碼", "基底信箱"]);
  });

  it("--environment 不在 DEMO_ALLOW_ENV:不執行", async () => {
    const state = harness({ DEMO_ALLOW_ENV: "staging" });
    await expect(runDemoCommand(args(), state.options)).rejects.toThrow(
      /DEMO_ALLOW_ENV/,
    );
    expect(state.operations).toEqual([]);
    expect(state.secretsRead).toEqual([]);
  });

  it.each(["purge", "rebuild"])(
    "--mode=%s:安全閥通過也先拒絕(清空 / 重建另行實作),沒有呼叫 api",
    async (mode) => {
      const state = harness();
      await expect(
        runDemoCommand(args({ mode }), state.options),
      ).rejects.toThrow(/尚未提供/);
      expect(state.operations).toEqual([]);
      expect(state.secretsRead).toEqual([]);
    },
  );

  it("密碼不從參數讀:多給任何參數(例 --password)直接拒絕", async () => {
    const state = harness();
    await expect(
      runDemoCommand([...args(), `--password=${DEMO_PASSWORD}`], state.options),
    ).rejects.toThrow(/無法辨識的參數/);
    expect(state.operations).toEqual([]);
  });

  it("沒給 --api-url:不執行", async () => {
    const state = harness();
    await expect(
      runDemoCommand(args().slice(0, 3), state.options),
    ).rejects.toThrow(/--api-url 必填/);
    expect(state.operations).toEqual([]);
  });

  it("沒設 ROOT_ADMIN_PASSWORD:平台管理員密碼也從標準輸入讀,而且排在最前面", async () => {
    const state = harness({ ROOT_ADMIN_PASSWORD: undefined });
    await expect(runDemoCommand(args(), state.options)).rejects.toThrow(
      /假 api/,
    );
    expect(state.secretsRead).toEqual([
      "平台管理員密碼",
      "示範帳號密碼",
      "基底信箱",
    ]);
  });

  it("api 的錯誤訊息裡若帶到機密一律遮掉", async () => {
    const state = harness({}, () =>
      reply({
        errors: [
          {
            message: `echo ${ROOT_PASSWORD} done`,
            extensions: { code: "UNAUTHENTICATED" },
          },
        ],
      }),
    );
    const failure = runDemoCommand(args(), state.options);
    await expect(failure).rejects.toThrow(/登入失敗/);
    const message = await failure.catch((error: unknown) =>
      error instanceof Error ? error.message : "",
    );
    expect(message).not.toContain(ROOT_PASSWORD);
    expect(message).toContain("echo *** done");
    expect(state.operations).toEqual(["DemoLogin"]);
    expect(state.populated).toBe(0);
  });
});

describe("錯誤訊息的機密遮罩", () => {
  it("8 個字以上的機密逐字遮掉;更短的不遮(以免把一般文字也換掉)", () => {
    expect(
      redactSecrets("連不上 api:secret-value 與 pw", ["secret-value", "pw"]),
    ).toBe("連不上 api:*** 與 pw");
    expect(redactSecrets("連不上 api(http://x)", ["p", "a", undefined])).toBe(
      "連不上 api(http://x)",
    );
    expect(redactSecrets("x 12345678 y", ["12345678"])).toBe("x *** y");
  });
});
