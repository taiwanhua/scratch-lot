/**
 * demo 指令的安全閥(`docs/deployment.md`「示範資料(demo)」;規則同 reset 的 `reset-safety.ts`)。
 *
 * 純函式:目標環境由操作者以 `--environment` 指定(**不從資料庫名推測**),必須在 `DEMO_ALLOW_ENV` 的
 * 允許清單內,而且 `--confirm` 要與 `demo:<environment>:<實際資料庫名>:<mode>` 完全相同。
 * 「實際資料庫名」是 `--api-url` 那個 api **自己回報**的資料庫名(`provisionTarget`),所以確認字串綁的是
 * 實際寫入的資料庫:確認字串對、`--api-url` 卻指到別的環境 → 資料庫名段不符,不執行。
 * 指令分兩次呼叫:還沒問 api 之前先以 `databaseName: null` 檢查其餘各段,以 root 登入讀到資料庫名後
 * 再完整檢查一次;兩次都在任何寫入之前。
 * 三個環境(含 production)同一套規則。示範機構名稱固定,由專案的示範資料決定,不放進確認字串。
 *
 * 拒絕原因只帶資料庫名,不回顯收到的確認字串(操作者可能誤貼連線字串)。
 */
import {
  RESET_ENVIRONMENTS,
  type ResetTarget,
  isResetEnvironment,
  mismatchedSegments,
  parseAllowedEnvironments,
} from "../reset/reset-safety";

/** 三個環境(與 reset 同一份對照)。 */
export const DEMO_ENVIRONMENTS = RESET_ENVIRONMENTS;

/**
 * `create` = 建立 / 補齊示範機構(冪等);`purge` = 清空示範機構;`rebuild` = `purge` + `create`。
 * `purge` / `rebuild` 的執行由 P34 補上:本指令先通過同一個安全閥,再拒絕執行(一筆都不寫也不刪)。
 */
export const DEMO_MODES = ["create", "purge", "rebuild"] as const;

export type DemoMode = (typeof DEMO_MODES)[number];

/** 允許執行 demo 的環境名單(逗號分隔),正本:docs/env-registry.md。 */
export const DEMO_ALLOW_ENV_NAME = "DEMO_ALLOW_ENV";

const CONFIRM_PREFIX = "demo";
const CONFIRM_FORMAT = `${CONFIRM_PREFIX}:<environment>:<資料庫名>:<mode>`;

/** 操作者必須完整輸入的確認字串(Reset DB 勾「重建後灌示範資料」時由 workflow 以同一條規則組出)。 */
export function demoConfirmationOf({
  environment,
  databaseName,
  mode,
}: ResetTarget): string {
  return `${CONFIRM_PREFIX}:${environment}:${databaseName}:${mode}`;
}

export interface DemoSafetyInput {
  /** api 回報的資料庫名;還沒問 api 時為 null(只檢查資料庫名以外的各段)。 */
  databaseName: string | null;
  /** `--environment` 的值(未給為 undefined)。 */
  environment: string | undefined;
  mode: DemoMode;
  /** `--confirm` 的值(未給為 undefined)。 */
  confirm: string | undefined;
  /** `DEMO_ALLOW_ENV` 的原始值。 */
  allowEnv: string | undefined;
}

/** 回傳拒絕原因;`null` = 全部通過。 */
export function findDemoSafetyViolation({
  databaseName,
  environment,
  mode,
  confirm,
  allowEnv,
}: DemoSafetyInput): string | null {
  if (environment === undefined || !isResetEnvironment(environment)) {
    return `--environment 必填,且必須是 ${DEMO_ENVIRONMENTS.join(" / ")}(目標環境由操作者指定,不從資料庫名推測)`;
  }

  const allowed = parseAllowedEnvironments(allowEnv);
  if (!allowed.includes(environment)) {
    return `${DEMO_ALLOW_ENV_NAME}(目前:${allowEnv ?? "(未設)"})不含目標環境 ${environment}`;
  }

  // 還不知道資料庫名:拿確認字串自己的資料庫名段來比(= 這一段先不檢查)
  const knownName =
    databaseName ?? (confirm ?? "").split(":").slice(2, -1).join(":");
  const target = { environment, databaseName: knownName, mode };
  const describe = `目標:環境 ${environment}、資料庫 ${databaseName ?? "(api 回報)"}、模式 ${mode}`;
  if (confirm === undefined || confirm === "") {
    return `--confirm 必填:請完整輸入 ${CONFIRM_FORMAT}(${describe})`;
  }
  if (confirm !== demoConfirmationOf(target)) {
    const reasons = mismatchedSegments(confirm, target, CONFIRM_PREFIX);
    return `--confirm 與目標不符(${reasons.length > 0 ? reasons.join("、") : "須完全相同,含大小寫與空白"});請完整輸入 ${CONFIRM_FORMAT}(${describe})`;
  }

  return null;
}
