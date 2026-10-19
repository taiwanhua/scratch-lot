import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  COMPOSE_PROJECT,
  E2E_DIR,
  FAKE_GCS_STATE_PATH,
  GCS_BUCKET_PRIVATE,
  GCS_BUCKET_PUBLIC,
  GCS_ENDPOINT,
  GCS_FAKE_CLIENT_EMAIL,
  GCS_FAKE_PRIVATE_KEY,
  GCS_PORT,
  GCS_REQUIRED,
} from "../config";
import { log, run, waitUntil } from "./process";

/**
 * fake GCS 容器:劇本 11(封面 / 附件)與 15(側欄商標)要真的上傳、讀回檔案。
 *
 * - 容器定義在 `apps/e2e/docker-compose.yml`,本機與 CI 都由這裡 `up -d` / `down`(同一份)。
 * - **本機沒有 Docker** → 不起容器、api 維持記錄用 adapter,這兩條 spec 讀狀態檔後 `test.skip`,
 *   其餘劇本照跑;`E2E_GCS_REQUIRED=1`(CI)時改成直接失敗。
 * - bucket 以 JSON API 建:名稱是變數(`E2E_GCS_BUCKET_*`),compose 的 `-data` 預建目錄吃不到。
 */

/**
 * 以 `apps/e2e` 為 cwd、檔名用相對路徑:Windows 上 `docker` 經 shell 呼叫,
 * 絕對路徑含空白時會被拆成兩段(`process.ts` 開頭那段說明)。
 */
const COMPOSE_FILE = "docker-compose.yml";

export type FakeGcsState =
  { available: true; endpoint: string } | { available: false; reason: string };

/** 這一輪有沒有起容器(teardown 只收自己起的)。 */
let isStarted = false;

/**
 * up 與 down 共用的 compose 參數。專案名明確用 `-p` 帶:shell 的 `COMPOSE_PROJECT_NAME`
 * 優先於 compose 檔的 `name`,只靠 `composeEnv()` 會被它蓋過、起到(或收掉)別的專案。
 */
function composeArgs(...command: string[]): string[] {
  return ["compose", "-p", COMPOSE_PROJECT, "-f", COMPOSE_FILE, ...command];
}

function composeEnv(): NodeJS.ProcessEnv {
  return {
    E2E_COMPOSE_PROJECT: COMPOSE_PROJECT,
    E2E_GCS_PORT: String(GCS_PORT),
    E2E_GCS_ENDPOINT: GCS_ENDPOINT,
    E2E_GCS_PUBLIC_HOST: new URL(GCS_ENDPOINT).host,
  };
}

/** `docker version` 連得到 daemon 才算有(Docker Desktop 裝了但沒開也是「沒有」)。 */
async function dockerUnavailableReason(): Promise<string | null> {
  try {
    await run("docker", ["version", "--format", "{{.Server.Version}}"], {
      label: "檢查 Docker",
    });
    await run("docker", ["compose", "version"], {
      label: "檢查 docker compose",
    });
    return null;
  } catch (error) {
    return `找不到可用的 Docker(${error instanceof Error ? error.message : String(error)})`;
  }
}

async function isFakeGcsReady(): Promise<boolean> {
  try {
    const response = await fetch(`${GCS_ENDPOINT}/storage/v1/b`);
    return response.ok;
  } catch {
    return false;
  }
}

/** 建 bucket;已經有了(容器沒收乾淨又被沿用)回 409,一樣算成功。 */
async function ensureBucket(name: string): Promise<void> {
  const response = await fetch(`${GCS_ENDPOINT}/storage/v1/b?project=e2e`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(
      `fake GCS 建 bucket「${name}」失敗:${String(response.status)} ${await response.text()}`,
    );
  }
}

function writeState(state: FakeGcsState): FakeGcsState {
  writeFileSync(FAKE_GCS_STATE_PATH, JSON.stringify(state, null, 2));
  return state;
}

/** 起容器 → 等 JSON API 回應 → 建兩個 bucket;結果寫進狀態檔給 spec 讀。 */
export async function startFakeGcs(): Promise<FakeGcsState> {
  const reason = await dockerUnavailableReason();
  if (reason !== null) {
    if (GCS_REQUIRED) {
      throw new Error(`E2E_GCS_REQUIRED=1 但${reason}`);
    }
    log(`${reason}:劇本 11 / 15 本輪 skip,其餘照跑`);
    return writeState({ available: false, reason });
  }

  await run("docker", composeArgs("up", "-d"), {
    label: "起 fake GCS",
    cwd: E2E_DIR,
    env: composeEnv(),
  });
  isStarted = true;
  await waitUntil(isFakeGcsReady, {
    label: `fake GCS ${GCS_ENDPOINT}`,
    timeoutMs: 60_000,
  });
  await ensureBucket(GCS_BUCKET_PUBLIC);
  await ensureBucket(GCS_BUCKET_PRIVATE);
  log(
    `fake GCS 就緒:${GCS_ENDPOINT}(${GCS_BUCKET_PUBLIC} / ${GCS_BUCKET_PRIVATE})`,
  );
  return writeState({ available: true, endpoint: GCS_ENDPOINT });
}

export async function stopFakeGcs(): Promise<void> {
  if (!isStarted) {
    return;
  }
  isStarted = false;
  await run("docker", composeArgs("down"), {
    label: "收 fake GCS",
    cwd: E2E_DIR,
    env: composeEnv(),
  });
}

/** 沒有設定私鑰就現產一把(PKCS#8 PEM);只給 fake GCS 簽名用,跑完即丟。 */
function fakePrivateKey(): string {
  if (GCS_FAKE_PRIVATE_KEY !== "") {
    return GCS_FAKE_PRIVATE_KEY;
  }
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return privateKey;
}

/**
 * api 子行程的 `GCS_*`。fake GCS 起不來時**明確給空字串**:
 * 不讓開發者自己 shell 裡的 `GCS_*` 漏進來,api 就維持記錄用 adapter(其餘劇本不受影響)。
 */
export function apiStorageEnv(state: FakeGcsState): NodeJS.ProcessEnv {
  if (!state.available) {
    return {
      GCS_BUCKET_PRIVATE: "",
      GCS_BUCKET_PUBLIC: "",
      GCS_API_ENDPOINT: "",
    };
  }
  return {
    GCS_BUCKET_PRIVATE: GCS_BUCKET_PRIVATE,
    GCS_BUCKET_PUBLIC: GCS_BUCKET_PUBLIC,
    GCS_API_ENDPOINT: state.endpoint,
    GCS_FAKE_CLIENT_EMAIL: GCS_FAKE_CLIENT_EMAIL,
    GCS_FAKE_PRIVATE_KEY: fakePrivateKey(),
  };
}

/**
 * spec 用:fake GCS 不可用時回 skip 的原因,可用時回 null。
 * 狀態檔由 globalSetup 寫(spec 跑在 worker 行程,拿不到 harness 的記憶體);
 * `E2E_SKIP_STACK=1` 接在手動起的 stack 上時沒有這個檔,一樣當成不可用。
 */
export function fakeGcsSkipReason(): string | null {
  if (!existsSync(FAKE_GCS_STATE_PATH)) {
    return "沒有 fake GCS 的狀態檔(E2E_SKIP_STACK=1 時 harness 不起容器)";
  }
  const state = JSON.parse(
    readFileSync(FAKE_GCS_STATE_PATH, "utf8"),
  ) as FakeGcsState;
  return state.available
    ? null
    : `fake GCS 不可用(${state.reason});本機要跑這條請開 Docker Desktop`;
}

/** 劇本 11 / 15 上傳用的測試檔(`apps/e2e/fixtures/assets/`,幾十 bytes 的 PNG 與 PDF)。 */
export function assetPath(name: string): string {
  return path.join(E2E_DIR, "fixtures", "assets", name);
}

/**
 * 以**不帶任何 cookie / token** 的請求取一個網址(= 文件寫的「複製到無痕視窗開」)。
 * 回狀態碼與內容,呼叫端拿內容跟 `assetPath` 的原檔比對 —— 比 URL 長相更直接:
 * 讀回來的就是剛才傳上去的那個檔,而不是「某個 200」。
 */
export async function fetchAnonymously(
  url: string,
): Promise<{ status: number; body: Buffer }> {
  const response = await fetch(url);
  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
  };
}
