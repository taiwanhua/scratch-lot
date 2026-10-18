import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * e2e 的設定(TEST-11):**埠、主機、帳密一律走環境變數**,程式裡只放測試用預設值。
 * 範本與說明見 `apps/e2e/.env.example`;本機要覆寫就複製成 `apps/e2e/.env`。
 *
 * 這裡的帳密是**測試值**,只會用在本機或 CI 起的拋棄式資料庫上;
 * 任何真實環境的密碼 / 金鑰都不放進這個包(也不放進 workflow 的 inputs)。
 */

/** `apps/e2e` 的絕對路徑。 */
export const E2E_DIR = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
/** repo 根(harness 要從這裡呼叫 pnpm / node)。 */
export const REPO_ROOT = path.resolve(E2E_DIR, "..", "..");
/** 執行期產物(api log、schema.gql、memory server 的檔案);已在 .gitignore 內。 */
export const TMP_DIR = path.join(E2E_DIR, ".tmp");
/** api 的 stdout;`fixtures/activation-link.ts` 從這裡撈啟用信連結。 */
export const API_LOG_PATH = path.join(TMP_DIR, "api.log");

/** 極簡 `.env` 載入器:只支援 `KEY=value` 與 `#` 註解,已存在的環境變數不覆蓋。 */
function loadDotEnv(): void {
  const file = path.join(E2E_DIR, ".env");
  if (!existsSync(file)) {
    return;
  }
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z_][A-Z\d_]*)=(.*)$/.exec(raw.trim());
    if (match?.[1] !== undefined && process.env[match[1]] === undefined) {
      process.env[match[1]] = (match[2] ?? "")
        .trim()
        .replaceAll(/^["']|["']$/g, "");
    }
  }
}

loadDotEnv();

function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function port(name: string, fallback: number): number {
  const value = Number.parseInt(text(name, String(fallback)), 10);
  if (Number.isNaN(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} 不是合法的埠號:${text(name, "")}`);
  }
  return value;
}

/**
 * admin 與 api 必須用**同一個主機名**:refresh token 的 cookie 是 SameSite=Lax,
 * `localhost` 與 `127.0.0.1` 對瀏覽器是兩個不同的站台,混用會讓換票整個失效。
 */
export const HOST = text("E2E_HOST", "127.0.0.1");
export const API_PORT = port("E2E_API_PORT", 5101);
export const ADMIN_PORT = port("E2E_ADMIN_PORT", 4301);

export const API_URL = `http://${HOST}:${String(API_PORT)}`;
export const GRAPHQL_ENDPOINT = `${API_URL}/graphql`;
export const ADMIN_URL = `http://${HOST}:${String(ADMIN_PORT)}`;

/** 空 = harness 自己起單一成員 replica set(本機與 CI 皆然);給值時須指向 replica set。 */
export const MONGODB_URI = text("E2E_MONGODB_URI", "");
export const DB_NAME = text("E2E_DB_NAME", "wowgo_base_e2e");

/** seed 建出來的超級管理員(ADR-0002 的 `ROOT_ADMIN_*`,這裡一律是測試值)。 */
export const ROOT_ACCOUNT = text("E2E_ROOT_ACCOUNT", "root");
export const ROOT_EMAIL = text("E2E_ROOT_EMAIL", "e2e-root@wowgo-base.test");
export const ROOT_PASSWORD = text("E2E_ROOT_PASSWORD", "e2e-root-pw-2026");

/** 劇本裡自己建出來的帳號(+tenant / +user)共用的密碼(密碼規則:8 碼以上、非純數字)。 */
export const MEMBER_PASSWORD = text(
  "E2E_MEMBER_PASSWORD",
  "e2e-member-pw-2026",
);

/** api 沒有 JWT_SECRET 會啟動失敗;e2e 給一個假值就夠。 */
export const JWT_SECRET = text("E2E_JWT_SECRET", "e2e-only-jwt-secret");

/**
 * fake GCS(`fsouza/fake-gcs-server`):劇本 11 / 15 要真的把檔案傳上去、再讀回來。
 * harness 以 `apps/e2e/docker-compose.yml` 起容器,api 以 `GCS_API_ENDPOINT` 指過去。
 * 主機沿用 `HOST`:瀏覽器從 admin 的頁面直傳 / 讀圖,跟 api 同一個主機名最單純。
 */
export const GCS_PORT = port("E2E_GCS_PORT", 4443);
export const GCS_ENDPOINT = `http://${HOST}:${String(GCS_PORT)}`;
/** fake GCS 的 Compose 專案名:compose 檔的 `name` 與 harness 的 up / down 用同一個值。 */
export const COMPOSE_PROJECT = text("E2E_COMPOSE_PROJECT", "wowgo-base-e2e");
export const GCS_BUCKET_PUBLIC = text(
  "E2E_GCS_BUCKET_PUBLIC",
  "wowgo-base-e2e-public",
);
export const GCS_BUCKET_PRIVATE = text(
  "E2E_GCS_BUCKET_PRIVATE",
  "wowgo-base-e2e-private",
);
/**
 * 簽名用的**假**憑證(api 的 `GCS_FAKE_CLIENT_EMAIL` / `GCS_FAKE_PRIVATE_KEY`):
 * 本機 / CI 沒有 ADC,V4 簽名要一把私鑰才算得出來;fake GCS 不驗簽章,這組值**沒有任何真實權限**。
 * 私鑰預設留空 = harness 每次啟動現產一把(repo 裡不放任何長得像金鑰的東西)。
 */
export const GCS_FAKE_CLIENT_EMAIL = text(
  "E2E_GCS_FAKE_CLIENT_EMAIL",
  "fake-gcs@wowgo-base-e2e.test",
);
export const GCS_FAKE_PRIVATE_KEY = text("E2E_GCS_FAKE_PRIVATE_KEY", "");
/**
 * 1 = 起不了 fake GCS 就整個失敗(CI 用;本機沒有 Docker 時劇本 11 / 15 改成 skip)。
 * 沒有這個開關,CI 上 Docker 出狀況會變成「兩條 skip、其餘全綠」,看起來像過了。
 */
export const GCS_REQUIRED = text("E2E_GCS_REQUIRED", "") === "1";
/** harness 寫、spec 讀:fake GCS 這一輪起不起得來(spec 跑在別的行程,只能走檔案)。 */
export const FAKE_GCS_STATE_PATH = path.join(TMP_DIR, "fake-gcs.json");

/**
 * 只跑標題符合這個 pattern 的劇本(Playwright 的 `grep`,空 = 全部)。
 * 走環境變數而不是命令列參數:`pnpm e2e` 中間隔了一層 `pnpm --filter`,`--` 之後的旗標傳不進去。
 */
export const GREP = text("E2E_GREP", "");

/** 1 = 不重新 build api / admin(本機反覆跑同一條劇本時省時間)。 */
export const SKIP_BUILD = text("E2E_SKIP_BUILD", "") === "1";
/** 1 = 不起 stack,直接打已經跑著的 api / admin(接上手動起好的環境除錯用)。 */
export const SKIP_STACK = text("E2E_SKIP_STACK", "") === "1";
