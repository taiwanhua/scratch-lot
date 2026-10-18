import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import type { Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import {
  createOrg,
  createUser,
  findRootOrgId,
} from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  type GcsBucket,
  type GcsDeleteOptions,
  type GcsSignedUrlOptions,
  GcsStorageService,
} from "./gcs-storage.service";
import { RecordingStorageService } from "./recording-storage.service";
import {
  DEFAULT_SIGNED_URL_TTL,
  type StorageConfig,
  loadStorageConfig,
} from "./storage.config";
import { createStorageService } from "./storage.module";
import { StorageService, isReleaseObjectPath } from "./storage.service";
import {
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  UPLOAD_URL_TTL_MS,
  UploadPurpose,
  isOwnedUploadPath,
} from "./upload-rules";

const ONE_HOUR_MS = 60 * 60 * 1000;

/** 假時鐘的固定時間(值本身不重要,只要測試期間不動)。 */
const FIXED_NOW = Date.UTC(2026, 0, 1, 0, 0, 0);

/**
 * 在固定時鐘下跑一段測試,讓效期斷言可以「精確相等」。
 *
 * 舊寫法是呼叫**前**取 `before = Date.now()`,再斷言 `expiresAt - before <= TTL`;但到期時間是
 * 簽名端以呼叫**當下**(較晚)的 `Date.now()` 加 TTL 算出來的,只要呼叫過程經過 ≥ 1 ms 就必然
 * 大於 TTL —— 本機幾乎同毫秒完成而僥倖綠,CI runner 慢一點就紅。
 *
 * 這裡用假時鐘而非容差:簽名路徑(`StorageService` + 記錄用 / 假 bucket adapter)只讀 `Date.now()`,
 * 沒有任何非同步計時器,`await` 走的是 promise microtask、不受假時鐘影響,所以不會卡住。
 */
async function withFixedClock<T>(run: () => Promise<T>): Promise<T> {
  jest.useFakeTimers({ now: FIXED_NOW });
  try {
    return await run();
  } finally {
    jest.useRealTimers();
  }
}

function configWith(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

function recordingWith(overrides: Partial<StorageConfig> = {}) {
  return new RecordingStorageService({
    privateBucket: undefined,
    publicBucket: undefined,
    signedUrlTtlMs: ONE_HOUR_MS,
    ...overrides,
  });
}

/** 假 bucket:記下 getSignedUrl / delete 的參數、回固定網址,不打網路(寫法同 mail 的假 Resend client)。 */
function fakeBucket(): {
  bucket: GcsBucket;
  getSignedUrl: jest.Mock<(options: GcsSignedUrlOptions) => Promise<[string]>>;
  deleteFile: jest.Mock<(options?: GcsDeleteOptions) => Promise<unknown>>;
  files: string[];
} {
  const files: string[] = [];
  const getSignedUrl = jest.fn<
    (options: GcsSignedUrlOptions) => Promise<[string]>
  >(() => Promise.resolve(["https://storage.googleapis.com/signed"]));
  const deleteFile = jest.fn<(options?: GcsDeleteOptions) => Promise<unknown>>(
    () => Promise.resolve([]),
  );
  const bucket: GcsBucket = {
    file: (name: string) => {
      files.push(name);
      return {
        getSignedUrl,
        delete: deleteFile,
        copy: () => Promise.resolve([]),
        download: () => Promise.resolve([Buffer.from("{}")]),
      };
    },
  };
  return { bucket, getSignedUrl, deleteFile, files };
}

/** GCS adapter + 假 bucket 的組合(單元測試用)。 */
function gcsWith(): ReturnType<typeof fakeBucket> & {
  storage: StorageService;
} {
  const fake = fakeBucket();
  return {
    ...fake,
    storage: new GcsStorageService(
      {
        privateBucket: "cookhome-assets-dev",
        publicBucket: undefined,
        signedUrlTtlMs: ONE_HOUR_MS,
      },
      fake.bucket,
    ),
  };
}

async function expectUploadRejected(
  run: () => Promise<unknown>,
): Promise<void> {
  await expect(run()).rejects.toMatchObject({
    extensions: { code: "UPLOAD_REJECTED" },
  });
}

describe("檔案儲存(ADR-0010:StorageService 介面 + GCS adapter + 記錄用 adapter)", () => {
  describe("設定(環境變數;登記於 docs/env-registry.md)", () => {
    it("都有內建預設值:沒有 bucket、讀取網址 TTL 1h", () => {
      expect(loadStorageConfig(configWith({}))).toEqual({
        privateBucket: undefined,
        publicBucket: undefined,
        signedUrlTtlMs: ONE_HOUR_MS,
      });
      expect(DEFAULT_SIGNED_URL_TTL).toBe("1h");
    });

    it("讀三個變數;空字串視同未設定", () => {
      expect(
        loadStorageConfig(
          configWith({
            GCS_BUCKET_PRIVATE: "cookhome-assets-dev",
            GCS_BUCKET_PUBLIC: "  ",
            GCS_SIGNED_URL_TTL: "15m",
          }),
        ),
      ).toEqual({
        privateBucket: "cookhome-assets-dev",
        publicBucket: undefined,
        signedUrlTtlMs: 15 * 60 * 1000,
      });
    });

    it("TTL 格式不對即拋錯(設定錯誤要在啟動時暴露)", () => {
      expect(() =>
        loadStorageConfig(configWith({ GCS_SIGNED_URL_TTL: "一小時" })),
      ).toThrow("GCS_SIGNED_URL_TTL");
    });

    it("有私有 bucket 才用 GCS adapter,沒有就用記錄用 adapter", () => {
      const base = {
        publicBucket: undefined,
        signedUrlTtlMs: ONE_HOUR_MS,
      };
      expect(
        createStorageService({ ...base, privateBucket: undefined }),
      ).toBeInstanceOf(RecordingStorageService);
      expect(
        createStorageService({
          ...base,
          privateBucket: "cookhome-assets-dev",
        }),
      ).toBeInstanceOf(GcsStorageService);
    });
  });

  describe("簽上傳票:依 purpose 驗檔型與大小,產 <前綴>/<uuid>.<副檔名>", () => {
    it.each([
      ["image/png", "png"],
      ["image/jpeg", "jpg"],
      ["image/webp", "webp"],
      ["IMAGE/PNG", "png"],
    ])("%s 可上傳,副檔名 %s", async (contentType, extension) => {
      const storage = recordingWith();
      const ticket = await storage.createUploadUrl({
        purpose: UploadPurpose.ORG_LOGO,
        contentType,
        size: 1024,
      });
      expect(ticket.objectPath).toMatch(
        new RegExp(String.raw`^org-logos/[0-9a-f-]{36}\.${extension}$`),
      );
      expect(ticket.uploadUrl).toContain(ticket.objectPath);
      expect(isOwnedUploadPath(ticket.objectPath)).toBe(true);
    });

    /**
     * 附件:除了圖片還收 pdf / doc / docx / xls / xlsx / zip。
     * `application/x-zip-compressed` 是 Windows 瀏覽器對 `.zip` 的申報值,與 `application/zip` 同副檔名。
     */
    it.each([
      ["application/pdf", "pdf"],
      ["application/msword", "doc"],
      [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docx",
      ],
      ["application/vnd.ms-excel", "xls"],
      [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx",
      ],
      ["application/zip", "zip"],
      ["application/x-zip-compressed", "zip"],
      ["APPLICATION/PDF", "pdf"],
      ["image/png", "png"],
    ])(
      "DEMO_ATTACHMENT:%s 可上傳,副檔名 %s",
      async (contentType, extension) => {
        const storage = recordingWith();
        const ticket = await storage.createUploadUrl({
          purpose: UploadPurpose.DEMO_ATTACHMENT,
          contentType,
          size: 1024,
        });
        expect(ticket.objectPath).toMatch(
          new RegExp(String.raw`^demo/[0-9a-f-]{36}\.${extension}$`),
        );
        expect(isOwnedUploadPath(ticket.objectPath)).toBe(true);
      },
    );

    it.each([
      ["application/pdf", UploadPurpose.ORG_LOGO],
      ["application/pdf", UploadPurpose.DEMO_COVER],
      ["application/zip", UploadPurpose.DEMO_COVER],
    ])(
      "圖片類用途不收文件檔:%s + %s → UPLOAD_REJECTED",
      async (contentType, purpose) => {
        const storage = recordingWith();
        await expectUploadRejected(() =>
          storage.createUploadUrl({ purpose, contentType, size: 1024 }),
        );
      },
    );

    it.each([
      ["image/png", "png"],
      ["image/webp", "webp"],
    ])(
      "DEMO_COVER:%s 可上傳,落在 demo/ 前綴",
      async (contentType, extension) => {
        const storage = recordingWith();
        const ticket = await storage.createUploadUrl({
          purpose: UploadPurpose.DEMO_COVER,
          contentType,
          size: 1024,
        });
        expect(ticket.objectPath).toMatch(
          new RegExp(String.raw`^demo/[0-9a-f-]{36}\.${extension}$`),
        );
      },
    );

    it("上傳網址效期 10 分鐘(ADR-0010),與讀取網址的 TTL 無關", async () => {
      const storage = recordingWith({ signedUrlTtlMs: ONE_HOUR_MS });
      const ticket = await withFixedClock(() =>
        storage.createUploadUrl({
          purpose: UploadPurpose.ORG_LOGO,
          contentType: "image/png",
          size: 1024,
        }),
      );
      expect(ticket.expiresAt.getTime()).toBe(FIXED_NOW + UPLOAD_URL_TTL_MS);
    });

    it("每次路徑都不同(uuid,覆蓋不到別人的檔)", async () => {
      const storage = recordingWith();
      const input = {
        purpose: UploadPurpose.ORG_LOGO,
        contentType: "image/png",
        size: 1024,
      };
      const first = await storage.createUploadUrl(input);
      const second = await storage.createUploadUrl(input);
      expect(first.objectPath).not.toBe(second.objectPath);
    });

    it.each(["image/gif", "image/svg+xml", "application/pdf", "text/plain"])(
      "%s 被拒:UPLOAD_REJECTED",
      async (contentType) => {
        const storage = recordingWith();
        await expectUploadRejected(() =>
          storage.createUploadUrl({
            purpose: UploadPurpose.ORG_LOGO,
            contentType,
            size: 1024,
          }),
        );
      },
    );

    it.each([
      ["超過 2MB", MAX_IMAGE_UPLOAD_BYTES + 1],
      ["空檔", 0],
      ["負數", -1],
      ["非整數", 1.5],
    ])("大小 %s 被拒:UPLOAD_REJECTED", async (_case, size) => {
      const storage = recordingWith();
      await expectUploadRejected(() =>
        storage.createUploadUrl({
          purpose: UploadPurpose.ORG_LOGO,
          contentType: "image/png",
          size,
        }),
      );
    });

    /** 大小上限也依 purpose:圖片類 2MB、附件 20MB,各自的邊界都要剛好過 / 剛好被拒。 */
    it.each([
      ["ORG_LOGO", UploadPurpose.ORG_LOGO, MAX_IMAGE_UPLOAD_BYTES],
      ["DEMO_COVER", UploadPurpose.DEMO_COVER, MAX_IMAGE_UPLOAD_BYTES],
      [
        "DEMO_ATTACHMENT",
        UploadPurpose.DEMO_ATTACHMENT,
        MAX_ATTACHMENT_UPLOAD_BYTES,
      ],
    ])("%s:剛好上限可以過,多 1 byte 被拒", async (_case, purpose, maxBytes) => {
      const storage = recordingWith();
      await expect(
        storage.createUploadUrl({
          purpose,
          contentType: "image/png",
          size: maxBytes,
        }),
      ).resolves.toMatchObject({ objectPath: expect.any(String) });
      await expectUploadRejected(() =>
        storage.createUploadUrl({
          purpose,
          contentType: "image/png",
          size: maxBytes + 1,
        }),
      );
    });

    it("圖片類的上限是 2MB、附件是 20MB(附件的上限對圖片類無效)", async () => {
      expect(MAX_IMAGE_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
      expect(MAX_ATTACHMENT_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
      const storage = recordingWith();
      await expectUploadRejected(() =>
        storage.createUploadUrl({
          purpose: UploadPurpose.DEMO_COVER,
          contentType: "image/png",
          size: MAX_ATTACHMENT_UPLOAD_BYTES,
        }),
      );
    });
  });

  describe("路徑歸屬 isOwnedUploadPath(供組織寫入端驗 logoPath)", () => {
    it.each([
      "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png",
      "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg",
      "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp",
      "demo/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png",
      "demo/3f2504e0-4f89-41d3-9a0c-0305e82c3301.pdf",
      "demo/3f2504e0-4f89-41d3-9a0c-0305e82c3301.xlsx",
      "demo/3f2504e0-4f89-41d3-9a0c-0305e82c3301.zip",
    ])("%s 是本 API 簽出來的", (path) => {
      expect(isOwnedUploadPath(path)).toBe(true);
    });

    it.each([
      ["別的前綴", "secrets/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png"],
      ["跳出前綴", "org-logos/../secrets/x.png"],
      ["不是 uuid", "org-logos/logo.png"],
      ["副檔名不合", "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.exe"],
      // 放寬的是附件用途,不是全站:org-logos 底下仍然只收圖片
      [
        "附件副檔名用在商標前綴",
        "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.pdf",
      ],
      [
        "附件副檔名用在商標前綴",
        "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.zip",
      ],
      [
        "demo 前綴的不合副檔名",
        "demo/3f2504e0-4f89-41d3-9a0c-0305e82c3301.exe",
      ],
      ["帶查詢字串", "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png?x=1"],
      ["絕對網址", "https://storage.googleapis.com/bucket/a.png"],
      ["空字串", ""],
    ])("%s 不是(%s)", (_case, path) => {
      expect(isOwnedUploadPath(path)).toBe(false);
    });
  });

  describe("發布檔 isReleaseObjectPath / readReleaseObject(代理程式安裝檔)", () => {
    it("只收 print-agent/ 前綴底下的路徑", () => {
      expect(isReleaseObjectPath("print-agent/manifest.json")).toBe(true);
      expect(
        isReleaseObjectPath("print-agent/1.2.0/print-agent-windows-x64.zip"),
      ).toBe(true);
      expect(isReleaseObjectPath("org-logo/abc.png")).toBe(false);
      expect(isReleaseObjectPath("print-agentx/manifest.json")).toBe(false);
      expect(isReleaseObjectPath("print-agent")).toBe(false);
    });

    it("拒絕 .. / . 與奇怪字元", () => {
      expect(isReleaseObjectPath("print-agent/../org-logo/a.png")).toBe(false);
      expect(isReleaseObjectPath("print-agent/./manifest.json")).toBe(false);
      expect(isReleaseObjectPath("print-agent/a b.zip")).toBe(false);
      expect(isReleaseObjectPath("/print-agent/manifest.json")).toBe(false);
    });

    it("前綴不對 → 不讀、不簽(回 null)", async () => {
      const storage = recordingWith();
      storage.putObject("org-logo/secret.png", "x");
      await expect(
        storage.readReleaseObject("org-logo/secret.png"),
      ).resolves.toBeNull();
      await expect(
        storage.releaseDownloadUrlOf("org-logo/secret.png", 1000),
      ).resolves.toBeNull();
      expect(storage.signed).toHaveLength(0);
    });
  });

  describe("簽讀取網址 readUrlOf", () => {
    const OWNED = "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png";

    it.each([
      ["沒有路徑(undefined)", undefined],
      ["沒有路徑(null)", null],
      ["只有空白", " "],
      ["不是本 API 簽出來的路徑", "secrets/passwords.png"],
    ])("%s 回 null,不簽", async (_case, path) => {
      await expect(recordingWith().readUrlOf(path)).resolves.toBeNull();
    });

    it("合法路徑回網址,效期為 GCS_SIGNED_URL_TTL", async () => {
      const ttlMs = 15 * 60 * 1000;
      const storage = recordingWith({ signedUrlTtlMs: ttlMs });
      const url = await withFixedClock(() => storage.readUrlOf(OWNED));
      expect(url).toContain(OWNED);
      const [signature] = storage.signed;
      expect(signature?.action).toBe("read");
      expect(signature?.expiresAt.getTime()).toBe(FIXED_NOW + ttlMs);
    });
  });

  describe("刪物件 deleteObject(換商標後清掉舊物件)", () => {
    const OWNED = "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png";

    it("合法路徑:真的交給 adapter 刪,回 true", async () => {
      const storage = recordingWith();
      await expect(storage.deleteObject(OWNED)).resolves.toBe(true);
      expect(storage.deleted).toEqual([OWNED]);
    });

    it.each([
      ["沒有路徑(undefined)", undefined],
      ["沒有路徑(null)", null],
      ["只有空白", " "],
      ["不是本 API 簽出來的路徑", "secrets/passwords.png"],
      ["跳出前綴", "org-logos/../secrets/x.png"],
    ])("%s 回 false,不刪(不讓呼叫端刪到任意物件)", async (_case, path) => {
      const storage = recordingWith();
      await expect(storage.deleteObject(path)).resolves.toBe(false);
      expect(storage.deleted).toEqual([]);
    });
  });

  describe("GCS adapter:V4 簽名的參數(以假 bucket 驗,不打網路)", () => {
    it("上傳:version v4、action write、綁 content type、效期 10 分鐘", async () => {
      const { storage, getSignedUrl, files } = gcsWith();
      const ticket = await storage.createUploadUrl({
        purpose: UploadPurpose.ORG_LOGO,
        contentType: "image/png",
        size: 1024,
      });
      expect(files).toEqual([ticket.objectPath]);
      expect(getSignedUrl).toHaveBeenCalledWith({
        version: "v4",
        action: "write",
        expires: ticket.expiresAt,
        contentType: "image/png",
      });
      expect(ticket.uploadUrl).toBe("https://storage.googleapis.com/signed");
    });

    it("讀取:version v4、action read、效期為 TTL、不帶 content type", async () => {
      const { storage, getSignedUrl, files } = gcsWith();
      const path = "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png";
      await expect(withFixedClock(() => storage.readUrlOf(path))).resolves.toBe(
        "https://storage.googleapis.com/signed",
      );
      expect(files).toEqual([path]);
      const options = getSignedUrl.mock.calls[0]?.[0];
      expect(options?.version).toBe("v4");
      expect(options?.action).toBe("read");
      expect(options?.contentType).toBeUndefined();
      expect(options?.expires.getTime()).toBe(FIXED_NOW + ONE_HOUR_MS);
    });

    it("刪除:對該物件呼叫 delete,物件已不在不算失敗", async () => {
      const { storage, deleteFile, files } = gcsWith();
      const path = "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png";
      await expect(storage.deleteObject(path)).resolves.toBe(true);
      expect(files).toEqual([path]);
      expect(deleteFile).toHaveBeenCalledWith({ ignoreNotFound: true });
    });

    it("刪除:不是本 API 簽出來的路徑,連 bucket 都不碰", async () => {
      const { storage, deleteFile, files } = gcsWith();
      await expect(storage.deleteObject("secrets/passwords.png")).resolves.toBe(
        false,
      );
      expect(files).toEqual([]);
      expect(deleteFile).not.toHaveBeenCalled();
    });

    it("刪除:供應商端失敗時原樣拋出(要不要擋由呼叫端決定)", async () => {
      const { storage, deleteFile } = gcsWith();
      deleteFile.mockRejectedValueOnce(new Error("GCS 掛了"));
      await expect(
        storage.deleteObject(
          "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png",
        ),
      ).rejects.toThrow("GCS 掛了");
    });

    it("沒有 bucket 名稱就不給建(啟動即失敗,不靜默用錯 bucket)", () => {
      expect(
        () =>
          new GcsStorageService({
            privateBucket: undefined,
            publicBucket: undefined,
            signedUrlTtlMs: ONE_HOUR_MS,
          }),
      ).toThrow("GCS_BUCKET_PRIVATE");
    });
  });
});

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const CREATE_UPLOAD_URL = /* GraphQL */ `
  mutation CreateUploadUrl($input: CreateUploadUrlInput!) {
    createUploadUrl(input: $input) {
      uploadUrl
      objectPath
      expiresAt
    }
  }
`;

const ME_LOGO = /* GraphQL */ `
  query MeLogo {
    me {
      currentOrg {
        id
        name
        logoUrl
      }
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface CreateUploadUrlData {
  createUploadUrl: {
    uploadUrl: string;
    objectPath: string;
    expiresAt: string;
  };
}

interface MeLogoData {
  me: { currentOrg: { id: string; name: string; logoUrl: string | null } };
}

const PASSWORD = ["test", "pass", "word"].join("-");
const LOGO_PATH = "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png";

describe("商標上傳線(GraphQL 端點,對真 Nest app + 真 MongoDB;未設 GCS_BUCKET_PRIVATE = 記錄用 adapter)", () => {
  let api: AuthTestApp;
  let rootOrgId: Types.ObjectId;
  let rootToken: string;

  async function loginAccessToken(
    account: string,
    password: string,
  ): Promise<string> {
    const result = await api.graphql<LoginData>(LOGIN, {
      input: { account, password },
    });
    expect(result.errors).toBeUndefined();
    const token = result.data?.login.accessToken;
    if (!token) {
      throw new Error("login 沒有回 accessToken");
    }
    return token;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-storage");
    rootOrgId = await findRootOrgId(api.connection);
    rootToken = await loginAccessToken(ROOT_ADMIN.account, ROOT_ADMIN.password);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("記錄用 adapter 被選中:回假的、一眼看得出來的上傳網址", async () => {
    const result = await api.graphql<CreateUploadUrlData>(
      CREATE_UPLOAD_URL,
      {
        input: {
          purpose: "ORG_LOGO",
          contentType: "image/png",
          size: 51_200,
        },
      },
      { accessToken: rootToken },
    );

    expect(result.errors).toBeUndefined();
    const ticket = result.data?.createUploadUrl;
    expect(ticket?.objectPath).toMatch(/^org-logos\//);
    expect(ticket?.uploadUrl).toContain("recording.storage.invalid");
    expect(new Date(ticket?.expiresAt ?? "").getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it.each([
    ["檔型不合", { contentType: "image/gif", size: 1024 }],
    [
      "超過 2MB",
      { contentType: "image/png", size: MAX_IMAGE_UPLOAD_BYTES + 1 },
    ],
    ["商標不收 pdf", { contentType: "application/pdf", size: 1024 }],
  ])("%s → UPLOAD_REJECTED", async (_case, overrides) => {
    const result = await api.graphql(
      CREATE_UPLOAD_URL,
      { input: { purpose: "ORG_LOGO", ...overrides } },
      { accessToken: rootToken },
    );
    expect(result.errors?.[0]?.extensions?.code).toBe("UPLOAD_REJECTED");
  });

  it("DEMO_ATTACHMENT:pdf 與 20MB 內的檔要得到票(附件放寬)", async () => {
    const result = await api.graphql<CreateUploadUrlData>(
      CREATE_UPLOAD_URL,
      {
        input: {
          purpose: "DEMO_ATTACHMENT",
          contentType: "application/pdf",
          size: MAX_ATTACHMENT_UPLOAD_BYTES,
        },
      },
      { accessToken: rootToken },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.createUploadUrl.objectPath).toMatch(/^demo\/.+\.pdf$/);
  });

  it("DEMO_ATTACHMENT:超過 20MB → UPLOAD_REJECTED", async () => {
    const result = await api.graphql(
      CREATE_UPLOAD_URL,
      {
        input: {
          purpose: "DEMO_ATTACHMENT",
          contentType: "application/pdf",
          size: MAX_ATTACHMENT_UPLOAD_BYTES + 1,
        },
      },
      { accessToken: rootToken },
    );
    expect(result.errors?.[0]?.extensions?.code).toBe("UPLOAD_REJECTED");
  });

  it("沒登入要不到上傳票:UNAUTHENTICATED", async () => {
    const result = await api.graphql(CREATE_UPLOAD_URL, {
      input: { purpose: "ORG_LOGO", contentType: "image/png", size: 1024 },
    });
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("沒有組織管理權限的使用者要不到上傳票:FORBIDDEN", async () => {
    const tenantId = await createOrg(api.connection, { name: "租戶(儲存)" });
    await createUser(api.connection, {
      account: "storage-nobody",
      password: PASSWORD,
      orgIds: [tenantId],
    });
    const token = await loginAccessToken("storage-nobody", PASSWORD);

    const result = await api.graphql(
      CREATE_UPLOAD_URL,
      { input: { purpose: "ORG_LOGO", contentType: "image/png", size: 1024 } },
      { accessToken: token },
    );
    expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("me.currentOrg.logoUrl:沒有商標時為 null;有 logoPath 時回簽名讀取網址", async () => {
    const before = await api.graphql<MeLogoData>(
      ME_LOGO,
      {},
      {
        accessToken: rootToken,
      },
    );
    expect(before.errors).toBeUndefined();
    expect(before.data?.me.currentOrg.logoUrl).toBeNull();

    await api.connection
      .collection("orgs")
      .updateOne({ _id: rootOrgId }, { $set: { logoPath: LOGO_PATH } });

    const after = await api.graphql<MeLogoData>(
      ME_LOGO,
      {},
      {
        accessToken: rootToken,
      },
    );
    expect(after.data?.me.currentOrg.logoUrl).toContain(LOGO_PATH);
    expect(after.data?.me.currentOrg.logoUrl).toContain("action=read");
  });

  it("logoPath 被塞成不是本 API 簽出來的路徑時,logoUrl 回 null(不外洩任意物件)", async () => {
    await api.connection
      .collection("orgs")
      .updateOne(
        { _id: rootOrgId },
        { $set: { logoPath: "secrets/passwords.png" } },
      );

    const result = await api.graphql<MeLogoData>(
      ME_LOGO,
      {},
      {
        accessToken: rootToken,
      },
    );
    expect(result.data?.me.currentOrg.logoUrl).toBeNull();

    await api.connection
      .collection("orgs")
      .updateOne({ _id: rootOrgId }, { $unset: { logoPath: "" } });
  });
});
