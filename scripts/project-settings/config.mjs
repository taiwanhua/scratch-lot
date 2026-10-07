/**
 * 專案部署設定的唯一讀取 / 驗證 / 解析模組(契約正本:docs/deployment.md「專案部署設定(deploy/project)」)。
 *
 * 來源只有兩份 JSON:`deploy/project/github.json`(repo 與看板識別)、`deploy/project/cloud.json`(GCP 目標與 Secret 名稱)。
 * 只用 Node 內建模組,workflow 在 pnpm install 之前就能執行。這裡只處理非機密設定與 Secret「名稱」,
 * 不讀環境變數、不取任何 token 或 Secret 值;沒有有效設定時一律丟錯,不回退任何預設值。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const ENVIRONMENTS = ["dev", "staging", "production"];

/** 看板 Status 的十個選項;自動化實際會寫入的六個見 project-status.mjs。 */
export const STATUS_OPTION_KEYS = [
  "backlog",
  "ready",
  "inProgress",
  "review",
  "devVerify",
  "devPassed",
  "stagingVerify",
  "stagingPassed",
  "released",
  "wontDo",
];

/** `--scope cloud` 啟用時的固定輸出鍵(順序即輸出順序);workflow 只映射這些鍵。停用時只有 `enabled`。 */
export const CLOUD_OUTPUT_KEYS = [
  "gcp_project_id",
  "region",
  "registry",
  "registry_host",
  "wif_provider",
  "deployer_sa",
  "api_service",
  "admin_service",
  "api_url",
  "mongodb_secret",
  "enc_secret",
  "root_secret",
  "jwt_secret",
  "resend_secret",
  "root_account",
  "root_email",
];

/** `--scope github` 啟用時的固定輸出鍵;停用時只有 `enabled`。 */
export const GITHUB_OUTPUT_KEYS = [
  "enabled",
  "project_id",
  "status_field_id",
  "options",
];

/** 設定或輸入不合法。訊息只含檔名與欄位路徑,不回印設定值(值可能帶控制字元)。 */
export class ProjectSettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectSettingsError";
  }
}

const GITHUB_FILE = "deploy/project/github.json";
const CLOUD_FILE = "deploy/project/cloud.json";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** 各欄位允許的字元:雲端識別都有固定格式,順便把 shell 特殊字元擋在外面。 */
const PATTERNS = {
  repository: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
  gcpProjectId: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
  region: /^[a-z]+(-[a-z0-9]+)+$/,
  artifactRegistry: /^[a-z0-9-]+(\.[a-z0-9-]+)+\/[a-z0-9-]+\/[a-z0-9_-]+$/,
  workloadIdentityProvider:
    /^projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/,
  serviceAccount: /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/,
  cloudRunService: /^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/,
  httpsOrigin: /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]+)?$/,
  secretName: /^[A-Za-z0-9_-]{1,255}$/,
  email: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/,
  nodeId: /^[A-Za-z0-9_-]+$/,
};

const fail = (message) => {
  throw new ProjectSettingsError(message);
};

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readJson(rootDir, file) {
  let text;
  try {
    text = readFileSync(path.join(rootDir, file), "utf8");
  } catch {
    fail(`${file} 讀不到(檔案不存在或無法讀取)`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`${file} 不是合法的 JSON`);
  }
  if (!isPlainObject(parsed)) fail(`${file} 的最外層必須是物件`);
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    fail(`${file} 的 schemaVersion 必須是 ${SCHEMA_VERSION}(未知版本不讀取)`);
  }
  return parsed;
}

/** 取出子物件(key 為 null 時就是 parent 本身),並要求鍵「剛好」是 keys:缺鍵與未知鍵都拒絕。 */
function section(file, parent, key, keys, at = key) {
  const value = key === null ? parent : parent[key];
  const where = at === null ? "最外層" : at;
  if (!isPlainObject(value)) fail(`${file} 的 ${where} 必須是物件`);
  for (const name of keys) {
    if (!Object.hasOwn(value, name)) {
      fail(`${file} 缺少 ${at === null ? name : `${at}.${name}`}`);
    }
  }
  for (const name of Object.keys(value)) {
    if (!keys.includes(name)) fail(`${file} 的 ${where} 有未知欄位`);
  }
  return value;
}

/** 非空字串、不含控制字元、前後無空白;有 pattern 時再比對格式。 */
function text(file, at, value, pattern) {
  if (typeof value !== "string" || value === "") {
    fail(`${file} 的 ${at} 必須是非空字串`);
  }
  if (CONTROL_CHARACTERS.test(value)) {
    fail(`${file} 的 ${at} 含控制字元`);
  }
  if (value !== value.trim()) fail(`${file} 的 ${at} 前後不可有空白`);
  if (pattern && !pattern.test(value)) fail(`${file} 的 ${at} 格式不符`);
  return value;
}

/**
 * 讀 github.json 並核對專案身分。`repository` 必須由呼叫端從受信任的 context 傳入
 * (workflow 的 `github.repository`),不拿設定檔自己的 expectedRepository 充當。
 */
function readGithubIdentity(rootDir, repository) {
  if (typeof repository !== "string" || !PATTERNS.repository.test(repository)) {
    fail("repository 輸入必須是 owner/repo(由 workflow 的受信任 context 傳入)");
  }
  const github = section(GITHUB_FILE, readJson(rootDir, GITHUB_FILE), null, [
    "schemaVersion",
    "expectedRepository",
    "projectStatus",
  ]);
  const expected = text(
    GITHUB_FILE,
    "expectedRepository",
    github.expectedRepository,
    PATTERNS.repository,
  );
  if (expected !== repository) {
    fail(
      `repository 不符:${GITHUB_FILE} 的 expectedRepository 是 ${expected},目前執行的是 ${repository};換專案時先改專案設定,不沿用原專案的目標`,
    );
  }
  return github;
}

/** `--scope github`:看板識別。停用時不要求 IDs / options,只回 `{ enabled: false }`。 */
export function resolveGithubConfig({ rootDir, repository }) {
  const github = readGithubIdentity(rootDir, repository);
  const status = github.projectStatus;
  if (!isPlainObject(status)) {
    fail(`${GITHUB_FILE} 的 projectStatus 必須是物件`);
  }
  if (typeof status.enabled !== "boolean") {
    fail(`${GITHUB_FILE} 的 projectStatus.enabled 必須是 true 或 false`);
  }
  if (!status.enabled) return { enabled: false };

  section(GITHUB_FILE, github, "projectStatus", [
    "enabled",
    "projectId",
    "statusFieldId",
    "options",
  ]);
  const options = section(
    GITHUB_FILE,
    status,
    "options",
    STATUS_OPTION_KEYS,
    "projectStatus.options",
  );
  return {
    enabled: true,
    project_id: text(
      GITHUB_FILE,
      "projectStatus.projectId",
      status.projectId,
      PATTERNS.nodeId,
    ),
    status_field_id: text(
      GITHUB_FILE,
      "projectStatus.statusFieldId",
      status.statusFieldId,
      PATTERNS.nodeId,
    ),
    options: Object.fromEntries(
      STATUS_OPTION_KEYS.map((key) => [
        key,
        text(
          GITHUB_FILE,
          `projectStatus.options.${key}`,
          options[key],
          PATTERNS.nodeId,
        ),
      ]),
    ),
  };
}

function validateEnvironment(environments, name) {
  const at = `environments.${name}`;
  const env = section(
    CLOUD_FILE,
    environments,
    name,
    ["apiService", "adminService", "apiUrl", "rootAdmin", "secrets"],
    at,
  );
  const rootAdmin = section(
    CLOUD_FILE,
    env,
    "rootAdmin",
    ["account", "email"],
    `${at}.rootAdmin`,
  );
  const secrets = section(
    CLOUD_FILE,
    env,
    "secrets",
    [
      "mongodbUri",
      "fieldEncryptionKey",
      "rootAdminPassword",
      "jwtSecret",
      "resendApiKey",
    ],
    `${at}.secrets`,
  );
  const secret = (key) =>
    text(CLOUD_FILE, `${at}.secrets.${key}`, secrets[key], PATTERNS.secretName);
  return {
    api_service: text(
      CLOUD_FILE,
      `${at}.apiService`,
      env.apiService,
      PATTERNS.cloudRunService,
    ),
    admin_service: text(
      CLOUD_FILE,
      `${at}.adminService`,
      env.adminService,
      PATTERNS.cloudRunService,
    ),
    api_url: text(CLOUD_FILE, `${at}.apiUrl`, env.apiUrl, PATTERNS.httpsOrigin),
    mongodb_secret: secret("mongodbUri"),
    enc_secret: secret("fieldEncryptionKey"),
    root_secret: secret("rootAdminPassword"),
    jwt_secret: secret("jwtSecret"),
    // null means this project has not enabled transactional email yet.
    resend_secret: secrets.resendApiKey === null ? "" : secret("resendApiKey"),
    // 帳號是自由文字(只擋控制字元);workflow 以 env 傳遞,不進 shell 程式文本
    root_account: text(
      CLOUD_FILE,
      `${at}.rootAdmin.account`,
      rootAdmin.account,
    ),
    root_email: text(
      CLOUD_FILE,
      `${at}.rootAdmin.email`,
      rootAdmin.email,
      PATTERNS.email,
    ),
  };
}

/**
 * `--scope cloud`:核對 repo 後解析某一環境的部署參數。
 * 三個環境每次都整份驗證(鍵固定為 dev / staging / production),壞掉的設定不會等到輪到該環境才被發現。
 * github.json 只用到身分欄位,看板是否啟用不影響部署。
 * 尚未啟用雲端(`enabled: false`,檔案只有 schemaVersion 與 enabled)時照樣先核對環境與 repo,只回 `{ enabled: false }`。
 */
export function resolveCloudConfig({ rootDir, environment, repository }) {
  if (!ENVIRONMENTS.includes(environment)) {
    fail(`environment 必須是 ${ENVIRONMENTS.join(" / ")} 其中之一`);
  }
  readGithubIdentity(rootDir, repository);

  const raw = readJson(rootDir, CLOUD_FILE);
  // enabled 可省略(= 已啟用);寫了就必須是 boolean,不把 null / 字串 / 數字猜成任何一邊
  const hasEnabled = Object.hasOwn(raw, "enabled");
  if (hasEnabled && typeof raw.enabled !== "boolean") {
    fail(`${CLOUD_FILE} 的 enabled 必須是 true 或 false`);
  }
  if (hasEnabled && !raw.enabled) {
    // 尚未啟用雲端:不得夾帶 gcp / environments(舊專案的目標)或未知鍵
    section(CLOUD_FILE, raw, null, ["schemaVersion", "enabled"]);
    return { enabled: false };
  }

  const cloud = section(CLOUD_FILE, raw, null, [
    "schemaVersion",
    ...(hasEnabled ? ["enabled"] : []),
    "gcp",
    "environments",
  ]);
  const gcp = section(CLOUD_FILE, cloud, "gcp", [
    "projectId",
    "region",
    "artifactRegistry",
    "workloadIdentityProvider",
    "deployServiceAccount",
  ]);
  const registry = text(
    CLOUD_FILE,
    "gcp.artifactRegistry",
    gcp.artifactRegistry,
    PATTERNS.artifactRegistry,
  );
  const shared = {
    gcp_project_id: text(
      CLOUD_FILE,
      "gcp.projectId",
      gcp.projectId,
      PATTERNS.gcpProjectId,
    ),
    region: text(CLOUD_FILE, "gcp.region", gcp.region, PATTERNS.region),
    registry,
    // registry 的主機名由 registry 衍生,不另存一份
    registry_host: registry.slice(0, registry.indexOf("/")),
    wif_provider: text(
      CLOUD_FILE,
      "gcp.workloadIdentityProvider",
      gcp.workloadIdentityProvider,
      PATTERNS.workloadIdentityProvider,
    ),
    deployer_sa: text(
      CLOUD_FILE,
      "gcp.deployServiceAccount",
      gcp.deployServiceAccount,
      PATTERNS.serviceAccount,
    ),
  };

  const environments = section(CLOUD_FILE, cloud, "environments", ENVIRONMENTS);
  const resolved = Object.fromEntries(
    ENVIRONMENTS.map((name) => [name, validateEnvironment(environments, name)]),
  );
  const merged = { ...shared, ...resolved[environment] };
  return Object.fromEntries(CLOUD_OUTPUT_KEYS.map((key) => [key, merged[key]]));
}
