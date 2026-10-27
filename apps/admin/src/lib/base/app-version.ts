/**
 * 偵測「這個分頁跑的是舊版」的純邏輯(提示與事件監聽在 `hooks/base/useAppUpdateNotice.ts`)。
 *
 * 部署後已開著的分頁(含安裝成 app 的視窗)仍跑舊 bundle,打到新 api 會失敗。build 時把版本烘進
 * bundle(`import.meta.env.APP_VERSION`),並輸出同一個值的 `/version.json`(外掛 `scripts/app-version-plugin.mjs`);
 * 分頁回到前景、換路由時抓 `/version.json`,和自己的版本不同就提示重新整理。**不定時輪詢**。
 */

/** build 輸出的版本檔網址(nginx 對它 `no-cache`,見 `apps/admin/nginx.conf`)。 */
export const APP_VERSION_PATH = "/version.json";

/** 換路由觸發的檢查,距上次檢查至少隔這麼久才再抓一次。 */
export const ROUTE_CHECK_INTERVAL_MS = 60_000;

/** api 回這個碼 = 舊 bundle 送出新 schema 已不認得的查詢(Apollo 的查詢驗證失敗)。 */
export const GRAPHQL_VALIDATION_FAILED_CODE = "GRAPHQL_VALIDATION_FAILED";

/** `/version.json` 的內容取出版本;形狀不對回 null(當作沒抓到,不提示)。 */
export const deployedVersionOf = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null || !("version" in body)) {
    return null;
  }
  const { version } = body as { version?: unknown };
  return typeof version === "string" && version !== "" ? version : null;
};

/** 抓目前部署的版本;網路錯誤、非 2xx、內容不對都回 null(不提示,下次再試)。 */
export const fetchDeployedVersion = async (
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> => {
  try {
    const response = await fetchImpl(APP_VERSION_PATH, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return deployedVersionOf(await response.json());
  } catch {
    return null;
  }
};

export interface VersionCheckerOptions {
  /** 這個 bundle 的版本 */
  currentVersion: string;
  /** 抓目前部署的版本(預設 `fetchDeployedVersion`);null = 沒抓到 */
  fetchVersion: () => Promise<string | null>;
  /** 發現版本不同時呼叫;之後每次觸發都直接再呼叫(不再抓),由呼叫端決定要不要重新顯示 */
  onOutdated: () => void;
  /** 時鐘(測試用) */
  now?: () => number;
  /** 換路由的節流間隔(預設 `ROUTE_CHECK_INTERVAL_MS`) */
  routeIntervalMs?: number;
}

export interface VersionChecker {
  /** 分頁回到前景:一律檢查(同一時間只發一個請求) */
  check: () => Promise<void>;
  /** 換路由:距上次檢查(含回前景那次;起算點是建立時)未滿間隔就略過;已確定是舊版時不節流(不再抓) */
  checkOnRoute: () => Promise<void>;
}

export const createVersionChecker = ({
  currentVersion,
  fetchVersion,
  onOutdated,
  now = Date.now,
  routeIntervalMs = ROUTE_CHECK_INTERVAL_MS,
}: VersionCheckerOptions): VersionChecker => {
  let lastCheckedAt = now();
  let isOutdated = false;
  let inflight: Promise<void> | null = null;

  const check = (): Promise<void> => {
    if (isOutdated) {
      onOutdated();
      return Promise.resolve();
    }
    lastCheckedAt = now();
    inflight ??= fetchVersion()
      .then((deployed) => {
        if (deployed !== null && deployed !== currentVersion) {
          isOutdated = true;
          onOutdated();
        }
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    check,
    checkOnRoute: () =>
      !isOutdated && now() - lastCheckedAt < routeIntervalMs
        ? Promise.resolve()
        : check(),
  };
};

/**
 * codegen hook 拋出的錯誤(graphql-request 的 `ClientError`,`response.errors[]`)是不是查詢驗證失敗。
 * 以形狀判斷、不 import `ClientError`:本檔也被 build 端外掛(node)讀取常數,不拉進 GraphQL client。
 */
export const isGraphqlValidationFailed = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return false;
  }
  const { response } = error as { response?: unknown };
  const errors =
    typeof response === "object" && response !== null && "errors" in response
      ? (response as { errors?: unknown }).errors
      : undefined;
  return (
    Array.isArray(errors) &&
    errors.some(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        (item as { extensions?: { code?: unknown } }).extensions?.code ===
          GRAPHQL_VALIDATION_FAILED_CODE,
    )
  );
};

/**
 * 動態 import(lazy chunk)載入失敗的錯誤訊息:Chromium / Firefox / Safari 的原生訊息與 Vite 預載 CSS 失敗。
 * 部署後舊分頁要的 chunk 檔名已不在伺服器上,`React.lazy` 會在 render 時拋出這類錯誤。
 */
const CHUNK_LOAD_ERROR_PATTERN =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css/i;

/** 頁面區 error boundary 接到的錯誤是不是 chunk 載入失敗(是 → 也當作「這個分頁跑的是舊版」)。 */
export const isChunkLoadError = (error: unknown): boolean =>
  error instanceof Error && CHUNK_LOAD_ERROR_PATTERN.test(error.message);
