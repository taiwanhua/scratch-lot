import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";

import {
  appVersionPlugin,
  appVersionSource,
  resolveAppVersion,
} from "./app-version-plugin.mjs";

/**
 * 版本號外掛的 build 端行為,以及部署設定的防回歸:nginx 對 version.json no-cache、
 * Dockerfile 在 build 後確認 dist/version.json 存在、只有正式入口接外掛。
 */
const adminDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(adminDir, file), "utf8");

describe("resolveAppVersion", () => {
  it("有 APP_VERSION(部署的 commit SHA)就用它", () => {
    expect(resolveAppVersion({ APP_VERSION: " abc123 " })).toBe("abc123");
  });

  it("沒有(或空字串)就用 build 時間", () => {
    const now = () => new Date("2026-10-27T01:02:03.000Z");
    expect(resolveAppVersion({}, now)).toBe("2026-10-27T01:02:03.000Z");
    expect(resolveAppVersion({ APP_VERSION: "" }, now)).toBe(
      "2026-10-27T01:02:03.000Z",
    );
  });
});

describe("appVersionPlugin", () => {
  it("只在 build 生效;烘進 import.meta.env.APP_VERSION", () => {
    const plugin = appVersionPlugin("v9");
    expect(plugin.apply).toBe("build");
    expect(plugin.config()).toEqual({
      define: { "import.meta.env.APP_VERSION": '"v9"' },
    });
  });

  it("輸出同一個值的 version.json", () => {
    const emitted = [];
    appVersionPlugin("v9").generateBundle.call({
      emitFile: (file) => emitted.push(file),
    });
    expect(emitted).toEqual([
      {
        type: "asset",
        fileName: "version.json",
        source: appVersionSource("v9"),
      },
    ]);
    expect(JSON.parse(emitted[0].source)).toEqual({ version: "v9" });
  });
});

describe("部署設定的防回歸", () => {
  it("vite.config.ts 接外掛、vite.mock.config.ts 不接(mock 模式不提示)", () => {
    expect(read("vite.config.ts")).toContain("appVersionPlugin(");
    expect(read("vite.mock.config.ts")).not.toContain("appVersionPlugin");
  });

  it("nginx 對 /version.json 給 no-cache(不可被瀏覽器啟發式快取)", () => {
    const block = /location = \/version\.json \{([^}]*)\}/.exec(
      read("nginx.conf"),
    );
    expect(block?.[1]).toContain('add_header Cache-Control "no-cache" always;');
  });

  it("Dockerfile 在 build 後確認 dist/version.json 存在,並接收 APP_VERSION", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("ARG APP_VERSION");
    expect(dockerfile).toContain("test -s apps/admin/dist/version.json");
  });
});
