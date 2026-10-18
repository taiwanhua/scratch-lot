import { describe, expect, it } from "@jest/globals";

import {
  PRINT_AGENT_PLATFORMS,
  type PrintAgentRelease,
  parsePrintAgentManifest,
} from "@repo/domain/printing";

import {
  PRINT_AGENT_RELEASES_KEPT,
  ReleaseError,
  addRelease,
  archiveName,
  hostPlatform,
  privateBucketOf,
  sortFiles,
} from "./release";

const release = (version: string): PrintAgentRelease => ({
  version,
  publishedAt: "2026-10-17T00:00:00.000Z",
  files: PRINT_AGENT_PLATFORMS.map((platform) => ({
    platform,
    name: archiveName(platform),
    sha256: "a".repeat(64),
    size: 100,
  })),
});

describe("發布:檔名與平台", () => {
  it("壓縮檔名:Windows zip、其他 tar.gz", () => {
    expect(
      PRINT_AGENT_PLATFORMS.map((platform) => archiveName(platform)),
    ).toEqual([
      "print-agent-windows-x64.zip",
      "print-agent-linux-x64.tar.gz",
      "print-agent-linux-arm64.tar.gz",
      "print-agent-macos-arm64.tar.gz",
    ]);
  });

  it("只能打包四個平台;Intel Mac、Windows arm64 不支援", () => {
    expect(hostPlatform("win32", "x64")).toBe("windows-x64");
    expect(hostPlatform("linux", "arm64")).toBe("linux-arm64");
    expect(hostPlatform("darwin", "arm64")).toBe("macos-arm64");
    expect(hostPlatform("darwin", "x64")).toBeNull();
    expect(hostPlatform("win32", "arm64")).toBeNull();
  });

  it("檔案依平台順序排(下載按鈕的順序)", () => {
    const files = release("1.0.0").files.toReversed();
    expect(sortFiles(files).map((file) => file.platform)).toEqual([
      ...PRINT_AGENT_PLATFORMS,
    ]);
  });
});

describe("發布:manifest 更新", () => {
  it("第一次發布:latest = 新版本,四個檔與 SHA-256,格式通過 domain 驗證", () => {
    const { manifest, removedObjects } = addRelease(null, release("1.0.0"));
    expect(manifest.latest).toBe("1.0.0");
    expect(manifest.releases).toHaveLength(1);
    expect(manifest.releases[0]?.files).toHaveLength(4);
    expect(parsePrintAgentManifest(manifest)).toEqual(manifest);
    expect(removedObjects).toEqual([]);
  });

  it(`只保留最近 ${String(PRINT_AGENT_RELEASES_KEPT)} 版,新到舊;更舊的列入刪除`, () => {
    let manifest: unknown = null;
    let removed: string[] = [];
    for (const version of ["1.0.0", "1.0.1", "1.1.0", "2.0.0"]) {
      const update = addRelease(manifest, release(version));
      manifest = update.manifest;
      removed = update.removedObjects;
    }
    expect(manifest).toMatchObject({
      latest: "2.0.0",
      releases: [
        { version: "2.0.0" },
        { version: "1.1.0" },
        { version: "1.0.1" },
      ],
    });
    expect(removed).toEqual(
      PRINT_AGENT_PLATFORMS.map(
        (platform) => `print-agent/1.0.0/${archiveName(platform)}`,
      ),
    );
  });

  it("已發布的版本不能覆蓋;新版本必須大於目前的最新", () => {
    const { manifest } = addRelease(null, release("1.2.0"));
    expect(() => addRelease(manifest, release("1.2.0"))).toThrow(ReleaseError);
    expect(() => addRelease(manifest, release("1.1.9"))).toThrow(ReleaseError);
  });

  it("目前的 manifest 讀不懂 → 不更新;版本格式不對、缺平台 → 拒絕", () => {
    expect(() => addRelease({ latest: "x" }, release("1.0.0"))).toThrow(
      ReleaseError,
    );
    expect(() => addRelease(null, release("v1.0"))).toThrow(ReleaseError);
    const missing = release("1.0.0");
    missing.files = missing.files.slice(1);
    expect(() => addRelease(null, missing)).toThrow(ReleaseError);
  });
});

describe("發布:目標 bucket", () => {
  it("讀 deploy/env 的 GCS_BUCKET_PRIVATE(引號、行尾註解都可)", () => {
    expect(
      privateBucketOf('# x\nGCS_BUCKET_PRIVATE: "example-assets-dev"\n'),
    ).toBe("example-assets-dev");
    expect(privateBucketOf("GCS_BUCKET_PRIVATE: assets-prod # 私有\r\n")).toBe(
      "assets-prod",
    );
  });

  it("沒寫、被註解掉、空值都回 null", () => {
    expect(privateBucketOf("GCS_BUCKET_PUBLIC: x\n")).toBeNull();
    expect(privateBucketOf('# GCS_BUCKET_PRIVATE: "a-b-c"\n')).toBeNull();
    expect(privateBucketOf('GCS_BUCKET_PRIVATE: ""\n')).toBeNull();
  });
});
