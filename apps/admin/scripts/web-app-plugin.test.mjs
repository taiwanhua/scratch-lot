import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "@jest/globals";

import { projectPublic } from "@repo/project-config/public";

import { WEB_APP_ICONS } from "../src/lib/base/web-app-manifest.ts";
import {
  pngSizeOf,
  webAppIconProblems,
  webAppManifestPlugin,
} from "./web-app-plugin.mjs";

/**
 * 可安裝 app 外掛的 build 端行為:圖示檢查(以暫存目錄擺出缺檔、非 PNG、尺寸錯)、
 * `webApp` 為 null 時什麼都不做、有值時輸出 manifest,以及只有正式入口接這個外掛。
 */
const adminDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const SAMPLE = {
  name: "Acme Portal",
  shortName: "Acme",
  themeColor: "#0B3D91",
  backgroundColor: "#F4F6F8",
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 只有檔頭的假 PNG:簽章 + IHDR(寬高),足夠讓檢查讀到尺寸。 */
const fakePng = (width, height) => {
  const buffer = Buffer.alloc(33);
  Buffer.from(PNG_SIGNATURE).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const ICONS = {
  small: { src: "/project/small.png", size: 192 },
  large: { src: "/project/large.png", size: 512 },
};

const temporaryDirs = [];

const publicDirWith = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "web-app-plugin-"));
  temporaryDirs.push(dir);
  mkdirSync(join(dir, "project"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, "project", name), content);
  }
  return dir;
};

/** 預設清單的圖示都齊全、尺寸正確的暫存 public 目錄(不依賴專案有沒有提交圖示)。 */
const completePublicDir = () =>
  publicDirWith(
    Object.fromEntries(
      Object.values(WEB_APP_ICONS).map(({ src, size }) => [
        src.slice(src.lastIndexOf("/") + 1),
        fakePng(size, size),
      ]),
    ),
  );

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 以 Vite / Rollup 呼叫外掛 hook 的方式跑一遍,收集 emitFile 的內容。 */
const runBuild = (plugin, publicDir) => {
  const emitted = [];
  plugin.configResolved({ publicDir });
  plugin.buildStart();
  plugin.generateBundle.call({ emitFile: (file) => emitted.push(file) });
  return { emitted, tags: plugin.transformIndexHtml() };
};

describe("pngSizeOf:先驗長度與簽章,再讀寬高", () => {
  it("合法檔頭讀出寬高", () => {
    expect(pngSizeOf(fakePng(192, 180))).toEqual({ width: 192, height: 180 });
  });

  it("太短、簽章錯、第一個 chunk 不是 IHDR → null(不丟 RangeError)", () => {
    expect(pngSizeOf(Buffer.from(PNG_SIGNATURE))).toBeNull();
    expect(pngSizeOf(Buffer.alloc(0))).toBeNull();
    const wrongSignature = fakePng(192, 192);
    wrongSignature[1] = 0x00;
    expect(pngSizeOf(wrongSignature)).toBeNull();
    const wrongChunk = fakePng(192, 192);
    wrongChunk.write("IDAT", 12, "ascii");
    expect(pngSizeOf(wrongChunk)).toBeNull();
  });
});

describe("webAppIconProblems:逐檔指出問題", () => {
  it("全部存在且尺寸對 → 沒有問題", () => {
    const dir = publicDirWith({
      "small.png": fakePng(192, 192),
      "large.png": fakePng(512, 512),
    });

    expect(webAppIconProblems(dir, ICONS)).toEqual([]);
  });

  it("缺檔、不是 PNG、尺寸不對各自一條,訊息帶檔名與原因", () => {
    const missing = publicDirWith({ "large.png": fakePng(512, 512) });
    expect(webAppIconProblems(missing, ICONS)).toEqual([
      `圖示不存在:${join(missing, "/project/small.png")}`,
    ]);

    const notPng = publicDirWith({
      "small.png": "<svg/>",
      "large.png": fakePng(512, 512).subarray(0, 20),
    });
    expect(webAppIconProblems(notPng, ICONS)).toEqual([
      `圖示不是 PNG:${join(notPng, "/project/small.png")}`,
      `圖示不是 PNG:${join(notPng, "/project/large.png")}`,
    ]);

    const wrongSize = publicDirWith({
      "small.png": fakePng(192, 192),
      "large.png": fakePng(512, 256),
    });
    expect(webAppIconProblems(wrongSize, ICONS)).toEqual([
      `圖示尺寸不對:${join(wrongSize, "/project/large.png")} 是 512×256,應為 512×512`,
    ]);
  });

  // 底座的 `admin.webApp` 是 null(不可安裝、不帶圖示):沒有圖示要檢查
  it("正式的 public/ 目錄:webApp 有值時專案提交的圖示齊全(預設清單)", () => {
    const problems =
      projectPublic.admin.webApp === null
        ? []
        : webAppIconProblems(join(adminDir, "public"));
    expect(problems).toEqual([]);
  });
});

describe("webAppManifestPlugin", () => {
  it("webApp 為 null:不檢查圖示、不加標籤、不輸出 manifest", () => {
    const empty = publicDirWith({});

    expect(runBuild(webAppManifestPlugin(null), empty)).toEqual({
      emitted: [],
      tags: [],
    });
  });

  it("有值:輸出 manifest.webmanifest 並加 <head> 標籤", () => {
    const { emitted, tags } = runBuild(
      webAppManifestPlugin(SAMPLE),
      completePublicDir(),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: "asset",
      fileName: "manifest.webmanifest",
    });
    expect(JSON.parse(emitted[0].source)).toMatchObject({
      name: SAMPLE.name,
      short_name: SAMPLE.shortName,
    });
    expect(tags.map((tag) => tag.attrs.rel ?? tag.attrs.name)).toEqual([
      "manifest",
      "theme-color",
      "apple-touch-icon",
      "apple-mobile-web-app-title",
    ]);
  });

  it("圖示有問題時 build 失敗,列出每個問題", () => {
    const plugin = webAppManifestPlugin(SAMPLE);
    plugin.configResolved({ publicDir: publicDirWith({}) });

    expect(() => plugin.buildStart()).toThrow(/圖示有問題[\s\S]*圖示不存在/);
  });
});

describe("只有正式入口接外掛", () => {
  // Vite 設定檔會載入 @vitejs/plugin-react 等,不在 jest 裡執行;以原始碼確認接線
  it("vite.config.ts 接、vite.mock.config.ts 不接", () => {
    const appConfig = readFileSync(join(adminDir, "vite.config.ts"), "utf8");
    const mockConfig = readFileSync(
      join(adminDir, "vite.mock.config.ts"),
      "utf8",
    );

    expect(appConfig).toContain("webAppManifestPlugin(");
    expect(mockConfig).not.toContain("web-app-plugin");
    expect(mockConfig).not.toContain("webAppManifestPlugin");
  });
});
