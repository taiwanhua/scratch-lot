import { describe, expect, it, jest } from "@jest/globals";

import {
  APP_VERSION_PATH,
  ROUTE_CHECK_INTERVAL_MS,
  createVersionChecker,
  deployedVersionOf,
  fetchDeployedVersion,
  isGraphqlValidationFailed,
} from "./app-version";

/** 可控的時鐘:`advance` 往前推毫秒數。 */
const clock = (start = 1_000_000) => {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
};

const checkerWith = (deployed: string | null, currentVersion = "v1") => {
  const time = clock();
  const fetchVersion = jest.fn(() => Promise.resolve(deployed));
  const onOutdated = jest.fn();
  const checker = createVersionChecker({
    currentVersion,
    fetchVersion,
    onOutdated,
    now: time.now,
  });
  return { checker, fetchVersion, onOutdated, time };
};

describe("deployedVersionOf:只收非空字串的 version", () => {
  it("形狀對 → 版本;缺欄位、空字串、非物件 → null", () => {
    expect(deployedVersionOf({ version: "abc" })).toBe("abc");
    expect(deployedVersionOf({ version: "" })).toBeNull();
    expect(deployedVersionOf({ version: 1 })).toBeNull();
    expect(deployedVersionOf({})).toBeNull();
    expect(deployedVersionOf(null)).toBeNull();
    expect(deployedVersionOf("abc")).toBeNull();
  });
});

describe("fetchDeployedVersion", () => {
  it("抓 /version.json 且不用瀏覽器快取", async () => {
    const fetchImpl = jest.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ version: "v2" })),
    );
    await expect(fetchDeployedVersion(fetchImpl)).resolves.toBe("v2");
    expect(fetchImpl).toHaveBeenCalledWith(APP_VERSION_PATH, {
      cache: "no-store",
    });
  });

  it("非 2xx、網路錯誤、內容不是 JSON → null(不提示)", async () => {
    await expect(
      fetchDeployedVersion(() =>
        Promise.resolve(new Response("x", { status: 404 })),
      ),
    ).resolves.toBeNull();
    await expect(
      fetchDeployedVersion(() => Promise.reject(new Error("offline"))),
    ).resolves.toBeNull();
    await expect(
      fetchDeployedVersion(() => Promise.resolve(new Response("<html>"))),
    ).resolves.toBeNull();
  });
});

describe("createVersionChecker", () => {
  it("版本相同 → 不提示", async () => {
    const { checker, onOutdated } = checkerWith("v1");
    await checker.check();
    expect(onOutdated).not.toHaveBeenCalled();
  });

  it("沒抓到版本 → 不提示", async () => {
    const { checker, onOutdated } = checkerWith(null);
    await checker.check();
    expect(onOutdated).not.toHaveBeenCalled();
  });

  it("版本不同 → 提示;之後每次觸發直接再回報、不再抓", async () => {
    const { checker, fetchVersion, onOutdated } = checkerWith("v2");
    await checker.check();
    expect(onOutdated).toHaveBeenCalledTimes(1);
    await checker.check();
    await checker.checkOnRoute();
    expect(fetchVersion).toHaveBeenCalledTimes(1);
    expect(onOutdated).toHaveBeenCalledTimes(3);
  });

  it("同一時間只發一個請求", async () => {
    const { checker, fetchVersion } = checkerWith("v1");
    await Promise.all([checker.check(), checker.check()]);
    expect(fetchVersion).toHaveBeenCalledTimes(1);
  });

  it("換路由:距上次檢查(起算點是建立時)未滿 1 分鐘不抓,滿了才抓", async () => {
    const { checker, fetchVersion, time } = checkerWith("v1");
    await checker.checkOnRoute();
    expect(fetchVersion).not.toHaveBeenCalled();

    time.advance(ROUTE_CHECK_INTERVAL_MS);
    await checker.checkOnRoute();
    expect(fetchVersion).toHaveBeenCalledTimes(1);

    // 回前景那次也算「上次檢查」
    time.advance(ROUTE_CHECK_INTERVAL_MS - 1);
    await checker.checkOnRoute();
    expect(fetchVersion).toHaveBeenCalledTimes(1);
    await checker.check();
    expect(fetchVersion).toHaveBeenCalledTimes(2);
    time.advance(ROUTE_CHECK_INTERVAL_MS - 1);
    await checker.checkOnRoute();
    expect(fetchVersion).toHaveBeenCalledTimes(2);
  });
});

/** graphql-request 的 ClientError 形狀 */
const clientError = (code: unknown) => ({
  response: { errors: [{ message: "x", extensions: { code } }] },
});

describe("isGraphqlValidationFailed", () => {
  it("errors[] 帶 GRAPHQL_VALIDATION_FAILED → true", () => {
    expect(
      isGraphqlValidationFailed(clientError("GRAPHQL_VALIDATION_FAILED")),
    ).toBe(true);
  });

  it("其他碼、沒有 response、不是物件 → false", () => {
    expect(isGraphqlValidationFailed(clientError("FORBIDDEN"))).toBe(false);
    expect(isGraphqlValidationFailed(new Error("x"))).toBe(false);
    expect(isGraphqlValidationFailed({ response: {} })).toBe(false);
    expect(isGraphqlValidationFailed(null)).toBe(false);
  });
});
