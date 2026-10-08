/**
 * 專案設定測試的共用工具:隔離夾具、CLI 子行程、workflow 步驟擷取與「假命令」執行。
 * 全部只用 Node 內建模組;不碰雲端、不讀任何 Secret。
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const scriptsDir = path.join(repoRoot, "scripts/project-settings");

/** 與正式設定同形狀、但值全是假專案的夾具(確認讀取器不夾帶 CookHome 常數)。 */
export function sampleGithub() {
  return {
    schemaVersion: 1,
    expectedRepository: "acme/widgets",
    projectStatus: {
      enabled: true,
      projectId: "PVT_sampleProject",
      statusFieldId: "PVTSSF_sampleField",
      options: {
        backlog: "a0000001",
        ready: "a0000002",
        inProgress: "a0000003",
        review: "a0000004",
        devVerify: "a0000005",
        devPassed: "a0000006",
        stagingVerify: "a0000007",
        stagingPassed: "a0000008",
        released: "a0000009",
        wontDo: "a000000a",
      },
    },
  };
}

function sampleEnvironment(suffix) {
  return {
    apiService: `widgets-api${suffix}`,
    adminService: `widgets-admin${suffix}`,
    apiUrl: `https://api${suffix}.widgets.example`,
    rootAdmin: { account: "owner", email: "owner@widgets.example" },
    secrets: {
      mongodbUri: `db-uri${suffix}`,
      fieldEncryptionKey: `enc-key${suffix}`,
      rootAdminPassword: `owner-password${suffix}`,
      jwtSecret: `jwt${suffix}`,
      resendApiKey: `mail-key${suffix}`,
    },
  };
}

export function sampleCloud() {
  return {
    schemaVersion: 1,
    gcp: {
      projectId: "acme-widgets",
      region: "europe-west1",
      artifactRegistry: "europe-west1-docker.pkg.dev/acme-widgets/widgets",
      workloadIdentityProvider:
        "projects/123456789/locations/global/workloadIdentityPools/gh/providers/gh-oidc",
      deployServiceAccount: "deployer@acme-widgets.iam.gserviceaccount.com",
    },
    environments: {
      dev: sampleEnvironment("-dev"),
      staging: sampleEnvironment("-staging"),
      production: sampleEnvironment(""),
    },
  };
}

/** 尚未啟用雲端的 cloud.json:只能有這兩欄。 */
export function disabledCloud() {
  return { schemaVersion: 1, enabled: false };
}

/**
 * CookHome 相容性夾具:設定抽出當下的 CookHome 兩份 JSON 的固定副本。
 * 「抽設定前後行為相同」的斷言一律拿它當輸入,不讀 repo 裡的正式設定 ——
 * 正式設定之後可以合法地換 endpoint、換資源,或整份換成另一個專案,都不該讓這些測試變紅。
 * 預期值另外手抄在各測試檔(輸出形狀),不由這裡或受測輸出推導。
 */
export function legacyCookhomeGithub() {
  return {
    schemaVersion: 1,
    expectedRepository: "taiwanhua/cookhome",
    projectStatus: {
      enabled: true,
      projectId: "PVT_kwHOAeiiKc4BjXhz",
      statusFieldId: "PVTSSF_lAHOAeiiKc4BjXhzzhiME14",
      options: {
        backlog: "2882aeb7",
        ready: "e053bab2",
        inProgress: "5adedc57",
        review: "43e18a1a",
        devVerify: "0eaa8179",
        devPassed: "cc87d3d5",
        stagingVerify: "e94980d1",
        stagingPassed: "45c49925",
        released: "e3445e43",
        wontDo: "b6b968cd",
      },
    },
  };
}

function legacyCookhomeEnvironment(suffix) {
  return {
    apiService: `cookhome-api${suffix}`,
    adminService: `cookhome-admin${suffix}`,
    apiUrl: `https://api${suffix}.cookhome.online`,
    rootAdmin: { account: "root", email: "a0987837233@gmail.com" },
    secrets: {
      mongodbUri: `mongodb-uri${suffix}`,
      fieldEncryptionKey: `field-encryption-key${suffix}`,
      rootAdminPassword: `root-admin-password${suffix}`,
      jwtSecret: `jwt-secret${suffix}`,
      resendApiKey: `resend-api-key${suffix}`,
    },
  };
}

export function legacyCookhomeCloud() {
  return {
    schemaVersion: 1,
    gcp: {
      projectId: "cookhome-online",
      region: "asia-east1",
      artifactRegistry: "asia-east1-docker.pkg.dev/cookhome-online/cookhome",
      workloadIdentityProvider:
        "projects/728045896207/locations/global/workloadIdentityPools/github/providers/github-oidc",
      deployServiceAccount:
        "github-deployer@cookhome-online.iam.gserviceaccount.com",
    },
    environments: {
      dev: legacyCookhomeEnvironment("-dev"),
      staging: legacyCookhomeEnvironment("-staging"),
      production: legacyCookhomeEnvironment(""),
    },
  };
}

export const LEGACY_COOKHOME_REPOSITORY = "taiwanhua/cookhome";

/** 含 CookHome 相容性夾具的隔離根目錄(可選擇連讀取腳本一起裝,模擬 checkout 後的工作目錄)。 */
export function makeLegacyCookhomeRoot() {
  return installScripts(
    makeProjectRoot({
      github: legacyCookhomeGithub(),
      cloud: legacyCookhomeCloud(),
    }),
  );
}

/**
 * 驗正式設定時要帶入的 repo 身分。CI 上取 runner 給的 `GITHUB_REPOSITORY`(受信任 context,
 * 設定與實際 repo 不符就該紅);本機沒有這個變數時退回設定檔自己的 expectedRepository,等於只驗 schema。
 */
export function liveRepository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return JSON.parse(
    readFileSync(path.join(repoRoot, "deploy/project/github.json"), "utf8"),
  ).expectedRepository;
}

/**
 * 建一個隔離的專案根目錄。`github` / `cloud` 給物件就寫成 JSON、給字串就原樣寫入(測壞掉的 JSON)、
 * 給 `null` 就不建該檔(測檔案不存在)。
 */
export function makeProjectRoot({
  github = sampleGithub(),
  cloud = sampleCloud(),
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "project-settings-"));
  const dir = path.join(root, "deploy/project");
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of [
    ["github.json", github],
    ["cloud.json", cloud],
  ]) {
    if (value === null) continue;
    writeFileSync(
      path.join(dir, name),
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    );
  }
  return root;
}

/** 以子行程跑 scripts/project-settings 下的 CLI;設定檔相對於 `cwd` 解析。 */
export function runScript(script, args, { cwd, input, env } = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(scriptsDir, script), ...args],
    {
      cwd,
      input,
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function readWorkflow(name) {
  return readFileSync(
    path.join(repoRoot, ".github/workflows", name),
    "utf8",
  ).replaceAll("\r\n", "\n");
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "");
}

/**
 * 只認本 repo workflow 用到的 YAML 子集的步驟擷取器(Node 沒有內建 YAML parser,測試又不能依賴 pnpm install):
 * 回傳每個 step 的 name / id / uses / if / shell / run,以及 env / with 的原始字串值。
 */
export function parseSteps(text) {
  const lines = text.split("\n");
  const stepsLine = lines.findIndex((line) => /^\s+steps:\s*$/.test(line));
  if (stepsLine === -1) throw new Error("找不到 steps:");
  const itemIndent = indentOf(lines[stepsLine]) + 2;
  const keyIndent = itemIndent + 2;
  const steps = [];
  let step = null;
  let index = stepsLine + 1;

  const readBlock = (minIndent) => {
    const block = [];
    while (
      index < lines.length &&
      (lines[index].trim() === "" || indentOf(lines[index]) >= minIndent)
    ) {
      block.push(lines[index].slice(minIndent));
      index += 1;
    }
    while (block.length > 0 && block.at(-1).trim() === "") block.pop();
    return `${block.join("\n")}\n`;
  };

  const readValue = (raw, ownIndent) =>
    raw.trim() === "|" ? readBlock(ownIndent + 2) : unquote(raw);

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "" || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }
    const indent = indentOf(line);
    if (indent < itemIndent) break;
    let content = line.slice(indent);
    let ownIndent = indent;
    if (indent === itemIndent && content.startsWith("- ")) {
      step = { env: {}, with: {} };
      steps.push(step);
      content = content.slice(2);
      ownIndent = keyIndent;
    } else if (indent !== keyIndent) {
      throw new Error(`無法解析的步驟行:${line}`);
    }
    const match = /^([\w-]+):(.*)$/.exec(content);
    if (!match) throw new Error(`無法解析的步驟行:${line}`);
    const [, key, raw] = match;
    index += 1;
    if (key === "env" || key === "with") {
      while (index < lines.length) {
        const entry = lines[index];
        if (entry.trim() === "" || entry.trim().startsWith("#")) {
          index += 1;
          continue;
        }
        if (indentOf(entry) <= ownIndent) break;
        const entryIndent = indentOf(entry);
        const entryMatch = /^([\w-]+):(.*)$/.exec(entry.trim());
        if (!entryMatch) throw new Error(`無法解析的 ${key} 行:${entry}`);
        index += 1;
        step[key][entryMatch[1]] = readValue(entryMatch[2], entryIndent);
      }
    } else {
      step[key] = readValue(raw, ownIndent);
    }
  }
  return steps;
}

export function findStep(steps, predicate) {
  const index = steps.findIndex(predicate);
  if (index === -1) throw new Error("找不到指定的 step");
  return { step: steps[index], index };
}

/** Windows 上 `bash` 可能解析到 WSL;優先用 Git for Windows 的 bash。 */
function findBash() {
  if (process.platform !== "win32") return "bash";
  const candidates = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"),
  ]
    .filter(Boolean)
    .map((base) => path.join(base, "Git/bin/bash.exe"));
  return candidates.find((candidate) => existsSync(candidate)) ?? "bash";
}

const posixPath = (value) => value.replaceAll("\\", "/");

/**
 * 「假命令」前言:gcloud / docker / pnpm 一律是 shell function(優先於 PATH 上的真命令,
 * 所以測試永遠碰不到真的 gcloud),每次呼叫把 argv 記到 `$FAKE_LOG`(一行一次呼叫,引數以 \x1f 分隔)。
 * gcloud 的回應由 FAKE_* 環境變數決定。
 */
export const fakeCommands = String.raw`
record() { { printf '%s' "$1"; shift; for a in "$@"; do printf '\037%s' "$a"; done; printf '\n'; } >> "$FAKE_LOG"; }
gcloud() {
  record gcloud "$@"
  case "$1 $2" in
    "run services")
      if [ "$4" = "$API_SERVICE" ]; then printf '%s\n' "$FAKE_API_IMAGE"; else printf '%s\n' "$FAKE_ADMIN_IMAGE"; fi ;;
    "secrets versions")
      case "$5" in
        "--secret=$MONGODB_SECRET_NAME") printf '%s\n' "$FAKE_MONGODB_URI" ;;
        *) printf '%s\n' "fake-secret-value" ;;
      esac ;;
  esac
}
docker() { record docker "$@"; }
pnpm() {
  record pnpm "$@"
  # printenv 是外部程式:只看得到真的 export 出去的變數
  for name in MONGODB_URI ROOT_ADMIN_PASSWORD ROOT_ADMIN_ACCOUNT ROOT_ADMIN_EMAIL RESET_ALLOW_ENV; do
    record env "$name=$(printenv "$name" || true)"
  done
}
git() {
  case "$1" in
    rev-parse) if [ "$2" = --short ] && [ -n "$FAKE_SHORT_HEAD" ]; then printf '%s\n' "$FAKE_SHORT_HEAD"; else printf '%s\n' "$FAKE_HEAD"; fi ;;
    cat-file) [ "$FAKE_BASE_IN_HISTORY" = 1 ] ;;
    diff) record git "$@"; printf '%s' "$FAKE_DIFF" ;;
  esac
}
npx() { for name in $FAKE_TURBO_AFFECTED; do printf '%s\n' "$name"; done; }
jq() { cat; }
`;

/**
 * 以 GitHub Actions 預設的 `bash -e` 執行一段 step 的 run 腳本。
 * 只給明確傳入的環境變數(加上 PATH 與暫存路徑),模擬 step 的 `env:`。
 */
export function runStepScript(script, { env = {}, prelude = "", cwd } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "workflow-step-"));
  const file = path.join(work, "step.sh");
  const log = path.join(work, "calls.log");
  const output = path.join(work, "github-output.txt");
  writeFileSync(log, "");
  writeFileSync(output, "");
  writeFileSync(file, `${prelude}\n${script}`);
  const result = spawnSync(
    findBash(),
    ["--noprofile", "--norc", "-e", posixPath(file)],
    {
      cwd: cwd ?? repoRoot,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        FAKE_LOG: posixPath(log),
        GITHUB_OUTPUT: posixPath(output),
        RUNNER_TEMP: posixPath(work),
        ...env,
      },
    },
  );
  if (result.error) throw result.error;
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\u001f"));
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls,
    outputs,
    work,
  };
}

/** 把讀取器腳本(不含測試)與最小的 package.json 複製進隔離根目錄,模擬「checkout 之後」的工作目錄。 */
export function installScripts(root) {
  const target = path.join(root, "scripts/project-settings");
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(scriptsDir)) {
    if (!name.endsWith(".mjs") || name.includes("test")) continue;
    copyFileSync(path.join(scriptsDir, name), path.join(target, name));
  }
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ devDependencies: { turbo: "^2.0.0" } }),
  );
  return root;
}

/** 解開 workflow 字串裡的 `${{ … }}`;只認本 repo 用到的幾種 context,其餘直接丟錯。 */
export function resolveExpressions(value, context) {
  return value.replaceAll(/\$\{\{\s*(.+?)\s*\}\}/g, (_, expression) => {
    const secretCheck = /^secrets\.(\w+) != ''$/.exec(expression);
    if (secretCheck) {
      return String((context.secrets?.[secretCheck[1]] ?? "") !== "");
    }
    if (!/^[\w.-]+$/.test(expression)) {
      throw new Error(`未支援的 expression:${expression}`);
    }
    const segments = expression.split(".");
    if (!["inputs", "steps", "github", "secrets"].includes(segments[0])) {
      throw new Error(`未支援的 context:${expression}`);
    }
    let current = context;
    for (const segment of segments) current = current?.[segment];
    return current === undefined || current === null ? "" : String(current);
  });
}

function stepEnabled(step, context) {
  if (step.if === undefined) return true;
  const match = /^steps\.([\w-]+)\.outputs\.([\w-]+) == 'true'$/.exec(step.if);
  if (!match) throw new Error(`未支援的 if:${step.if}`);
  return context.steps?.[match[1]]?.outputs?.[match[2]] === "true";
}

const mapValues = (object, fn) =>
  Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, fn(value)]),
  );

/**
 * 離線模擬一個 job:依序跑每個 step,`run` 用 bash + 假命令實際執行,`uses` 只記錄(可由 onUses 接手),
 * 任一步失敗即停(與 Actions 相同)。回傳走過的步驟、所有假命令呼叫與各 step 的輸出。
 */
export async function runJob(
  workflow,
  { inputs = {}, github = {}, secrets = {}, env = {}, cwd, onUses } = {},
) {
  const context = { inputs, github, secrets, steps: {} };
  const trace = [];
  const calls = [];
  let failed = null;
  for (const step of parseSteps(readWorkflow(workflow))) {
    const label = step.name ?? step.uses;
    if (!stepEnabled(step, context)) {
      trace.push({ label, skipped: true });
      continue;
    }
    const stepEnv = mapValues(step.env, (value) =>
      resolveExpressions(value, context),
    );
    if (step.uses !== undefined) {
      const resolvedWith = mapValues(step.with, (value) =>
        resolveExpressions(value, context),
      );
      trace.push({ label, uses: step.uses, with: resolvedWith });
      if (onUses) await onUses({ step, env: stepEnv, with: resolvedWith });
      continue;
    }
    const result = runStepScript(step.run, {
      env: { ...env, ...stepEnv },
      prelude: fakeCommands,
      cwd,
    });
    calls.push(...result.calls);
    trace.push({ label, ...result });
    if (step.id !== undefined) {
      context.steps[step.id] = { outputs: result.outputs };
    }
    if (result.status !== 0) {
      failed = { label, ...result };
      break;
    }
  }
  return { trace, calls, failed, steps: context.steps };
}

/** 跑單一 step(以 name 指定);env 的 expression 由 context 解開,再疊上 extraEnv。 */
export function runNamedStep(
  workflow,
  name,
  { context = {}, env = {}, cwd } = {},
) {
  const { step } = findStep(
    parseSteps(readWorkflow(workflow)),
    (candidate) => candidate.name === name,
  );
  const stepEnv = mapValues(step.env, (value) =>
    resolveExpressions(value, { steps: {}, ...context }),
  );
  return {
    step,
    ...runStepScript(step.run, {
      env: { ...stepEnv, ...env },
      prelude: fakeCommands,
      cwd,
    }),
  };
}
