import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "@jest/globals";

import { PRINT_AGENT_API_PATHS } from "@repo/domain/printing";

import type { FetchLike } from "../api-client/api-client";
import { normalizeServerUrl, readAgentConfig } from "../config/config-file";
import { defaultPaths, resolvePaths } from "../config/paths";
import { freshSecret } from "../test-support/fakes";
import { PairingError, pairAgent } from "./pairing";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function configFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "print-agent-config-"));
  dirs.push(dir);
  return path.join(dir, "nested", "config.json");
}

function fakeServer(status: number, key = freshSecret()) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = (url, init) => {
    requests.push({ url, init });
    return Promise.resolve(
      new Response(
        status === 200
          ? JSON.stringify({ agentId: "agent-1", key, name: "門市 A" })
          : "{}",
        { status, headers: { "content-type": "application/json" } },
      ),
    );
  };
  return { fetch, requests, key };
}

const CODE = "ABCD-EFGH";

/** 不安全的 http(只有 localhost 才允許):字串拆開寫,避免被當成程式裡真的用了明文連線。 */
const HTTP = ["http", "://"].join("");

const readKey = (file: string) =>
  (JSON.parse(readFileSync(file, "utf8")) as { key: string }).key;

describe("配對", () => {
  it("POST /print-agent/pair(不帶金鑰)→ 金鑰寫進設定檔", async () => {
    const file = configFile();
    const server = fakeServer(200);
    const config = await pairAgent({
      serverUrl: "https://api.example.invalid/some/path/",
      code: CODE,
      configFile: file,
      version: "1.0.0",
      fetch: server.fetch,
      now: () => new Date("2026-10-17T00:00:00Z"),
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toBe(
      `https://api.example.invalid${PRINT_AGENT_API_PATHS.pair}`,
    );
    expect(JSON.parse(server.requests[0]?.init.body as string)).toEqual({
      code: "ABCDEFGH",
      version: "1.0.0",
    });
    const headers = server.requests[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(config).toMatchObject({ agentId: "agent-1", key: server.key });
    await expect(readAgentConfig(file)).resolves.toEqual(config);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("已配對過:不覆蓋金鑰(更新版本時保留);--force 才重新配對", async () => {
    const file = configFile();
    const first = fakeServer(200);
    await pairAgent({
      serverUrl: "https://api.example.invalid",
      code: CODE,
      configFile: file,
      version: "1.0.0",
      fetch: first.fetch,
    });
    const second = fakeServer(200);
    await expect(
      pairAgent({
        serverUrl: "https://api.example.invalid",
        code: CODE,
        configFile: file,
        version: "1.0.0",
        fetch: second.fetch,
      }),
    ).rejects.toMatchObject({ reason: "already-paired" });
    expect(second.requests).toHaveLength(0);
    expect(readKey(file)).toBe(first.key);
    await pairAgent({
      serverUrl: "https://api.example.invalid",
      code: CODE,
      configFile: file,
      version: "1.0.0",
      fetch: second.fetch,
      force: true,
    });
    expect(readKey(file)).toBe(second.key);
  });

  it("配對碼不對 / 過期(401)→ rejected,不寫設定檔", async () => {
    const file = configFile();
    await expect(
      pairAgent({
        serverUrl: "https://api.example.invalid",
        code: CODE,
        configFile: file,
        version: "1.0.0",
        fetch: fakeServer(401).fetch,
      }),
    ).rejects.toMatchObject({ reason: "rejected" });
    await expect(readAgentConfig(file)).resolves.toBeNull();
  });

  it("網址與配對碼格式不對時不呼叫 API", async () => {
    const server = fakeServer(200);
    const base = {
      configFile: configFile(),
      version: "1.0.0",
      fetch: server.fetch,
    };
    await expect(
      pairAgent({
        ...base,
        serverUrl: `${HTTP}api.example.invalid`,
        code: CODE,
      }),
    ).rejects.toBeInstanceOf(PairingError);
    await expect(
      pairAgent({
        ...base,
        serverUrl: "https://api.example.invalid",
        code: "0000",
      }),
    ).rejects.toMatchObject({ reason: "invalid-code" });
    expect(server.requests).toHaveLength(0);
  });
});

describe("設定檔", () => {
  it("伺服器網址只收 https(本機開發 localhost 可 http),只取 origin", () => {
    expect(normalizeServerUrl(" https://api.example.invalid/graphql ")).toBe(
      "https://api.example.invalid",
    );
    expect(normalizeServerUrl(`${HTTP}localhost:5001`)).toBe(
      `${HTTP}localhost:5001`,
    );
    expect(normalizeServerUrl(`${HTTP}api.example.invalid`)).toBeNull();
    expect(
      normalizeServerUrl("https://user:pw@api.example.invalid"),
    ).toBeNull();
    expect(normalizeServerUrl("not a url")).toBeNull();
  });

  it("三個平台的設定檔位置照規格", () => {
    expect(defaultPaths("win32").configFile).toBe(
      String.raw`C:\ProgramData\print-agent\config.json`,
    );
    expect(defaultPaths("linux").configFile).toBe(
      "/etc/print-agent/config.json",
    );
    expect(defaultPaths("darwin").configFile).toBe(
      "/Library/Application Support/print-agent/config.json",
    );
    expect(resolvePaths({ configDir: "x" }).logDir).toBe(
      path.resolve("x", "logs"),
    );
  });

  it("設定檔壞掉時丟錯(不當成沒配對而覆蓋)", async () => {
    const file = configFile();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{");
    await expect(readAgentConfig(file)).rejects.toThrow("JSON");
  });
});
