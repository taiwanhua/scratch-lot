import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "@jest/globals";
import { ConfigService } from "@nestjs/config";

import {
  GcsStorageService,
  createGcsClient,
  gcsClientOptions,
} from "./gcs-storage.service";
import { type StorageConfig, loadStorageConfig } from "./storage.config";
import { UploadPurpose } from "./upload-rules";

/**
 * `GCS_API_ENDPOINT`:**只在劇本 E2E 用**的端點覆寫。
 * 兩條路徑都要釘住 —— 沒設 = 原本的 `new Storage()`(雲端環境走 ADC),
 * 有設 = 帶端點與測試用假憑證、簽名網址指向那個端點。
 *
 * 簽名是 SDK 在本機用私鑰算的,不打網路;這裡的金鑰每次測試現產,沒有任何真實權限。
 */

const ONE_HOUR_MS = 60 * 60 * 1000;
const ENDPOINT = "http://127.0.0.1:4443";
const CLIENT_EMAIL = "fake-gcs@cookhome-e2e.test";
const LOGO_PATH = "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png";
const COVER_PATH = "demo/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png";

const { privateKey: PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function configWith(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

const BASE: StorageConfig = {
  privateBucket: "cookhome-e2e-private",
  publicBucket: "cookhome-e2e-public",
  signedUrlTtlMs: ONE_HOUR_MS,
};

const WITH_OVERRIDE: StorageConfig = {
  ...BASE,
  endpointOverride: {
    apiEndpoint: ENDPOINT,
    clientEmail: CLIENT_EMAIL,
    privateKey: PRIVATE_KEY,
  },
};

describe("GCS 端點覆寫(GCS_API_ENDPOINT,只在劇本 E2E 用)", () => {
  describe("設定", () => {
    it("沒設 GCS_API_ENDPOINT:沒有 endpointOverride 這個欄位(雲端環境的樣子)", () => {
      const config = loadStorageConfig(
        configWith({
          GCS_BUCKET_PRIVATE: "cookhome-assets-dev",
          // 只給憑證、沒給端點:憑證一律不讀
          GCS_FAKE_CLIENT_EMAIL: CLIENT_EMAIL,
          GCS_FAKE_PRIVATE_KEY: PRIVATE_KEY,
        }),
      );
      expect(config).not.toHaveProperty("endpointOverride");
    });

    it("空字串的 GCS_API_ENDPOINT 視同未設定", () => {
      expect(
        loadStorageConfig(configWith({ GCS_API_ENDPOINT: "  " })),
      ).not.toHaveProperty("endpointOverride");
    });

    it("有設:讀端點與假憑證;去掉結尾的 /,單行寫法的換行符號還原成換行", () => {
      const singleLine = PRIVATE_KEY.replaceAll("\n", String.raw`\n`);
      const config = loadStorageConfig(
        configWith({
          GCS_API_ENDPOINT: `${ENDPOINT}/`,
          GCS_FAKE_CLIENT_EMAIL: CLIENT_EMAIL,
          GCS_FAKE_PRIVATE_KEY: singleLine,
        }),
      );
      expect(config.endpointOverride).toEqual({
        apiEndpoint: ENDPOINT,
        clientEmail: CLIENT_EMAIL,
        privateKey: PRIVATE_KEY,
      });
    });

    it.each([
      ["GCS_FAKE_CLIENT_EMAIL", { GCS_FAKE_PRIVATE_KEY: PRIVATE_KEY }],
      ["GCS_FAKE_PRIVATE_KEY", { GCS_FAKE_CLIENT_EMAIL: CLIENT_EMAIL }],
    ])("有端點但缺 %s:啟動即拋錯(不靜默退回 ADC)", (_missing, values) => {
      expect(() =>
        loadStorageConfig(
          configWith({ GCS_API_ENDPOINT: ENDPOINT, ...values }),
        ),
      ).toThrow("GCS_FAKE_PRIVATE_KEY");
    });
  });

  describe("SDK client 的建法", () => {
    it("沒有端點覆寫:不給任何參數(= 原本的 new Storage(),走 ADC、打真 GCS)", () => {
      expect(gcsClientOptions(BASE)).toBeUndefined();
      expect(createGcsClient(BASE).apiEndpoint).toBe(
        "https://storage.googleapis.com",
      );
    });

    it("有端點覆寫:帶 apiEndpoint 與假憑證", () => {
      expect(gcsClientOptions(WITH_OVERRIDE)).toEqual({
        apiEndpoint: ENDPOINT,
        credentials: { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY },
      });
      expect(createGcsClient(WITH_OVERRIDE).apiEndpoint).toBe(ENDPOINT);
    });
  });

  describe("簽出來的網址指向覆寫的端點(真 SDK、本機簽名、不打網路)", () => {
    const storage = new GcsStorageService(WITH_OVERRIDE);

    it("私有用途的上傳網址:端點 + 私有 bucket + V4 簽名", async () => {
      const { uploadUrl, objectPath } = await storage.createUploadUrl({
        purpose: UploadPurpose.ORG_LOGO,
        contentType: "image/png",
        size: 1024,
      });
      const url = new URL(uploadUrl);
      expect(url.origin).toBe(ENDPOINT);
      expect(url.pathname).toBe(`/cookhome-e2e-private/${objectPath}`);
      expect(url.searchParams.get("X-Goog-Algorithm")).toBe("GOOG4-RSA-SHA256");
      expect(url.searchParams.get("X-Goog-Credential")).toMatch(
        new RegExp(`^${CLIENT_EMAIL}/`),
      );
      expect(url.searchParams.get("X-Goog-Signature")).not.toBeNull();
    });

    it("公開用途的上傳網址落在公開 bucket", async () => {
      const { uploadUrl, objectPath } = await storage.createUploadUrl({
        purpose: UploadPurpose.DEMO_COVER,
        contentType: "image/png",
        size: 1024,
      });
      expect(new URL(uploadUrl).pathname).toBe(
        `/cookhome-e2e-public/${objectPath}`,
      );
    });

    it("讀取網址:端點 + 私有 bucket + 簽名,效期為 TTL", async () => {
      const url = new URL((await storage.readUrlOf(LOGO_PATH)) ?? "");
      expect(url.origin).toBe(ENDPOINT);
      expect(url.pathname).toBe(`/cookhome-e2e-private/${LOGO_PATH}`);
      expect(url.searchParams.get("X-Goog-Expires")).toBe(
        String(ONE_HOUR_MS / 1000),
      );
      expect(url.searchParams.get("X-Goog-Signature")).not.toBeNull();
    });

    it("公開 URL:同一個端點 + 公開 bucket,不簽名", () => {
      expect(storage.publicUrlOf(COVER_PATH)).toBe(
        `${ENDPOINT}/cookhome-e2e-public/${COVER_PATH}`,
      );
    });

    it("對照:沒有端點覆寫時公開 URL 仍是 storage.googleapis.com", () => {
      const cloud = new GcsStorageService(BASE);
      expect(cloud.publicUrlOf(COVER_PATH)).toBe(
        `https://storage.googleapis.com/cookhome-e2e-public/${COVER_PATH}`,
      );
    });
  });
});
