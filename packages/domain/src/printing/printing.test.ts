import { describe, expect, it } from "@jest/globals";

import {
  PRINT_AGENT_OFFLINE_AFTER_MS,
  isAgentVersionOutdated,
  isPrintAgentOffline,
  normalizePairingCode,
  parsePrintAgentManifest,
  printAgentReleaseObjectPath,
} from "./index";

const SHA = "a".repeat(64);

function manifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    latest: "1.2.0",
    releases: [
      {
        version: "1.2.0",
        publishedAt: "2026-10-17T00:00:00.000Z",
        files: [
          {
            platform: "windows-x64",
            name: "print-agent-windows-x64.zip",
            sha256: SHA,
            size: 1024,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("配對碼正規化", () => {
  it("去掉空白與連字號、轉大寫", () => {
    expect(normalizePairingCode(" abcd-efgh ")).toBe("ABCDEFGH");
  });

  it("長度不對或含易混淆字元 → null", () => {
    expect(normalizePairingCode("ABCDEFG")).toBeNull();
    expect(normalizePairingCode("ABCDEFG0")).toBeNull();
    expect(normalizePairingCode("ABCDEFGI")).toBeNull();
    expect(normalizePairingCode(12_345_678)).toBeNull();
  });
});

describe("離線判斷(2 分鐘)", () => {
  const now = new Date("2026-10-17T10:00:00.000Z");

  it("2 分鐘內看到過 → 已連線", () => {
    const seen = new Date(now.getTime() - PRINT_AGENT_OFFLINE_AFTER_MS);
    expect(isPrintAgentOffline(seen, now)).toBe(false);
  });

  it("超過 2 分鐘或從沒連過 → 離線", () => {
    const seen = new Date(now.getTime() - PRINT_AGENT_OFFLINE_AFTER_MS - 1);
    expect(isPrintAgentOffline(seen, now)).toBe(true);
    expect(isPrintAgentOffline(null, now)).toBe(true);
  });
});

describe("代理程式版本比較", () => {
  it("目前版本較舊 → 請更新", () => {
    expect(isAgentVersionOutdated("1.1.9", "1.2.0")).toBe(true);
    expect(isAgentVersionOutdated("1.10.0", "1.9.0")).toBe(false);
    expect(isAgentVersionOutdated("1.2.0", "1.2.0")).toBe(false);
  });

  it("任何一邊不認得 → 不標", () => {
    expect(isAgentVersionOutdated(null, "1.2.0")).toBe(false);
    expect(isAgentVersionOutdated("dev", "1.2.0")).toBe(false);
    expect(isAgentVersionOutdated("1.0.0", null)).toBe(false);
  });
});

describe("manifest.json", () => {
  it("合法的 manifest 原樣讀出", () => {
    expect(parsePrintAgentManifest(manifest())).toEqual(manifest());
  });

  it("latest 不在 releases 裡、平台不認得、SHA-256 格式不對 → null", () => {
    expect(parsePrintAgentManifest(manifest({ latest: "9.9.9" }))).toBeNull();
    expect(
      parsePrintAgentManifest(
        manifest({
          releases: [
            {
              version: "1.2.0",
              publishedAt: "x",
              files: [
                { platform: "macos-x64", name: "a.zip", sha256: SHA, size: 1 },
              ],
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parsePrintAgentManifest(
        manifest({
          releases: [
            {
              version: "1.2.0",
              publishedAt: "x",
              files: [
                {
                  platform: "linux-x64",
                  name: "a.tar.gz",
                  sha256: "XYZ",
                  size: 1,
                },
              ],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("檔案的物件路徑 = print-agent/<版本>/<檔名>", () => {
    expect(printAgentReleaseObjectPath("1.2.0", "a.zip")).toBe(
      "print-agent/1.2.0/a.zip",
    );
  });
});
