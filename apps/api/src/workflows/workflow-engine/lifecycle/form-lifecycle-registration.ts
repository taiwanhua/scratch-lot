import type { InjectionToken } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import type { RealtimeSignal } from "@repo/domain/realtime";

import type { OperatorContext } from "../../../database/operator-context";
import type { NotifyInput } from "../../../notifications/notification.service";

/**
 * 表單 / 流程的生命週期掛接點(現況說明 `docs/concepts/workflow-engine.md`「掛接點」)。
 *
 * 專案在固定入口 `src/project/form-lifecycles.ts` 列出 `registerFormLifecycle({...})`(STRUCT-12 的靜態清單,
 * 同 `project/lookup-providers.ts`);清單只由 `database/database.module.ts` 經 `composeFormLifecycles`
 * 組裝,以 `FORM_LIFECYCLES` 提供 —— api 與受管定義 CLI 拿到同一份,登記不合契約兩邊都起不來。
 *
 * - **守門**(`guards`,8 個):動作的交易內、寫入之前呼叫,**只能讀**;回 `null` = 通過,
 *   回 `{ code, message }` = 擋下(`FORBIDDEN` + `reason = code`,整個動作沒有任何寫入)
 * - **事後動作**(`effects`,7 個):狀態改變後在**同一個交易內**呼叫,以系統身分執行;拋錯 = 整個動作回復
 */

/** 守門(時機見 `docs/concepts/workflow-engine.md`「掛接點」)。 */
export const FORM_GUARD_NAMES = [
  "beforeSubmit",
  "beforeApprove",
  "beforeReject",
  "beforeReturn",
  "beforeWithdraw",
  "beforeVoid",
  "beforeDelete",
  "beforeEditCompleted",
] as const;

export type FormGuardName = (typeof FORM_GUARD_NAMES)[number];

/** 事後動作的事件。 */
export const FORM_EFFECT_NAMES = [
  "submitted",
  "stepPassed",
  "returned",
  "withdrawn",
  "completed",
  "rejected",
  "voided",
] as const;

export type FormEffectName = (typeof FORM_EFFECT_NAMES)[number];

/** 守門與事後動作看得到的提交(落庫的那一筆;`values` = 目前的值)。 */
export interface LifecycleSubmission {
  readonly _id: Types.ObjectId;
  readonly tenantId: Types.ObjectId | null;
  readonly orgId: Types.ObjectId;
  readonly moduleKey: string;
  readonly formKey: string;
  readonly status: string;
  readonly revision: number;
  readonly createdBy?: Types.ObjectId | null;
  readonly values: StoredValues;
}

/** 作廢原因(`beforeVoid` 守門與 `voided` 事後動作才有;規則見 `docs/modules/forms.md`「作廢原因」)。 */
export interface FormVoidReason {
  /** 選項值;表單沒設作廢原因類別 = null。 */
  readonly reasonKey: string | null;
  /** 選項名稱(作廢當下);沒設類別 = null。 */
  readonly reasonLabel: string | null;
  /** 說明(去空白);沒填 = null。沒設類別時就是自由文字理由(必填,一定有)。 */
  readonly reasonNote: string | null;
}

/**
 * 取這筆登記在 `inject` 宣告過的 repository / service;沒宣告的 token → 拋錯
 * (實例在啟動時解析好,見 `resolveLifecycleInjections`)。
 */
export type LifecycleResolver = <T>(token: InjectionToken<T>) => T;

export interface FormGuardContext {
  /** 哪一個守門。 */
  readonly guard: FormGuardName;
  /** 按下按鈕的人(他的可見範圍與資料範圍照套)。 */
  readonly operator: OperatorContext;
  readonly submission: LifecycleSubmission;
  /** 這一版的欄位值:送出 / 修改已完成單 = 這次要寫入的新值;其他 = 目前的值。 */
  readonly values: StoredValues;
  /** 關卡 key(核准 / 駁回 / 退回);其他守門為 null。 */
  readonly stepKey: string | null;
  /** 作廢原因:只有 `beforeVoid` 有。 */
  readonly voidReason?: FormVoidReason;
  /** 動作所在交易的 session(唯讀用;repository 不帶 session 時也會自動用它)。 */
  readonly session: ClientSession;
  readonly get: LifecycleResolver;
}

/** 擋下:`code` = 專案錯誤碼(大寫英數與底線,例 `PURCHASE_UNRECEIVED_ROWS`),`message` 給開發者看。 */
export interface FormGuardBlock {
  code: string;
  message: string;
}

/** `null` = 通過。 */
export type FormGuardResult = FormGuardBlock | null;

export type FormGuard = (
  context: FormGuardContext,
) => FormGuardResult | Promise<FormGuardResult>;

/**
 * 事後動作內呼叫的通知入口 = 通知的單一入口 `NotificationService.notify()`(`docs/modules/notification-settings.md`):
 * 寫入 notifications 併進這個動作的交易,動作回復就沒有通知、沒有信號、沒有信。
 */
export type LifecycleNotify = (input: NotifyInput) => Promise<void>;

export interface FormEffectContext {
  readonly event: FormEffectName;
  readonly submissionId: Types.ObjectId;
  readonly tenantId: Types.ObjectId | null;
  readonly orgId: Types.ObjectId;
  readonly moduleKey: string;
  readonly formKey: string;
  /** 修訂號(走流程 = 實例的修訂號)。 */
  readonly revision: number;
  /** 關卡 key:`stepPassed` = 通過 / 跳過的那一關;`returned` / `rejected` = 做決定的那一關;其他 null。 */
  readonly stepKey: string | null;
  /** `stepPassed` 是跳過的(其他事件一律 false)。 */
  readonly skipped: boolean;
  /** 作廢原因:只有 `voided` 有。 */
  readonly voidReason?: FormVoidReason;
  /**
   * 系統身分:沒有操作者、不帶任何角色,可見範圍 = 單據的組織(租戶頂層開了「含下層」時含其下層),
   * 不使用按下按鈕那個人的權限。專案寫入以它當 operator。
   */
  readonly operator: OperatorContext;
  /**
   * 造成這個事件的人(只給「誰讓資料變了」的記錄用,例:基礎欄位的修改者;**不是**權限來源):
   * `submitted` = 送出的人(沒走流程直接完成的單,接著的 `completed` 也是送出的人)、`voided` = 作廢的人、
   * `rejected` / `returned` = 做這個決定的審核者、`withdrawn` = 撤回的人(申請人)。
   * 只有系統推進的事件(排程、自動通過、重試)是 null:`stepPassed` 與走流程的 `completed`。
   */
  readonly actorId: Types.ObjectId | null;
  readonly session: ClientSession;
  readonly get: LifecycleResolver;
  readonly notify: LifecycleNotify;
  /** 即時信號:交易提交後才送(回復就不送)。 */
  readonly realtime: {
    publishAfterCommit(topics: readonly string[], signal: RealtimeSignal): void;
  };
}

export type FormEffect = (context: FormEffectContext) => Promise<void> | void;

export interface FormLifecycleRegistration {
  /** 業務模組 key(例 `purchasing.purchase`)。 */
  moduleKey: string;
  /** 表單 key;省略 = 這個模組的所有表單(不可寫 `"*"`)。 */
  formKey?: string;
  /**
   * 守門與事後動作要用的 repository / service(Nest 的 provider token)。啟動時逐一解析,
   * 找不到 → app 起不來;handler 的 `get` 只拿得到這裡列的。
   */
  inject?: readonly InjectionToken[];
  guards?: Partial<Record<FormGuardName, FormGuard>>;
  effects?: Partial<Record<FormEffectName, FormEffect>>;
}

/** 固定入口用的宣告 helper(型別檢查用;登記本身是 `project/form-lifecycles.ts` 的靜態清單)。 */
export function registerFormLifecycle(
  registration: FormLifecycleRegistration,
): FormLifecycleRegistration {
  return registration;
}

/** 組裝好的登記:依 (moduleKey, formKey) 查。 */
export interface FormLifecycles {
  /** 全部登記(啟動時解析 `inject` 用)。 */
  readonly registrations: readonly FormLifecycleRegistration[];
  /** 這張表單適用的那一筆(先找指定表單、再找整個模組);沒有 → null。 */
  lookup(moduleKey: string, formKey: string): FormLifecycleRegistration | null;
}

/** DI token:組裝好的掛接點登記。 */
export const FORM_LIFECYCLES = Symbol("FORM_LIFECYCLES");

/** 掛接點登記不合契約:組裝時拋出,app 起不來。 */
export class FormLifecycleRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormLifecycleRegistrationError";
  }
}

function labelOf(registration: FormLifecycleRegistration): string {
  return registration.formKey === undefined
    ? registration.moduleKey
    : `${registration.moduleKey} / ${registration.formKey}`;
}

function checkHandlers(
  registration: FormLifecycleRegistration,
  what: string,
  handlers: Readonly<Record<string, unknown>> | undefined,
  names: readonly string[],
): void {
  for (const [name, handler] of Object.entries(handlers ?? {})) {
    if (!names.includes(name)) {
      throw new FormLifecycleRegistrationError(
        `掛接點 ${labelOf(registration)}:沒有 ${what}「${name}」(可用:${names.join("、")})`,
      );
    }
    if (typeof handler !== "function") {
      throw new FormLifecycleRegistrationError(
        `掛接點 ${labelOf(registration)}:${what}「${name}」必須是函式`,
      );
    }
  }
}

function tokenLabel(token: InjectionToken): string {
  return typeof token === "function" ? token.name : String(token);
}

function checkInject(registration: FormLifecycleRegistration): void {
  const tokens = registration.inject ?? [];
  const seen = new Set<InjectionToken>();
  for (const token of tokens) {
    if ((token as unknown) === undefined || (token as unknown) === null) {
      throw new FormLifecycleRegistrationError(
        `掛接點 ${labelOf(registration)}:inject 有空的 token(多半是循環 import)`,
      );
    }
    if (seen.has(token)) {
      throw new FormLifecycleRegistrationError(
        `掛接點 ${labelOf(registration)}:inject 重複列了 ${tokenLabel(token)}`,
      );
    }
    seen.add(token);
  }
}

/** 整個模組那一筆的查詢 key。 */
const MODULE_WIDE = "*";

function keyOf(moduleKey: string, formKey: string): string {
  return `${moduleKey}\u0000${formKey}`;
}

/**
 * 驗證並組裝專案的掛接點登記(由 `database/database.module.ts` 組裝時呼叫):
 * - 同一個 (moduleKey, formKey) 只能登記一次;重複 → 拋錯
 * - 同一個模組不能同時有「整個模組」與「指定表單」的登記(兩筆都適用同一張表單時,誰先誰後沒有定義)
 * - moduleKey / formKey 不可空白,formKey 不可是 `"*"`(內部代表整個模組);守門與事後動作的名字要是
 *   已知的、值要是函式;`inject` 的 token 不可空、不可重複(是否存在在啟動時由 `resolveLifecycleInjections` 驗)
 */
export function composeFormLifecycles(
  registrations: readonly FormLifecycleRegistration[],
): FormLifecycles {
  const byKey = new Map<string, FormLifecycleRegistration>();
  const moduleShapes = new Map<string, "module" | "forms">();
  for (const registration of registrations) {
    const { moduleKey, formKey } = registration;
    if (moduleKey.trim() === "" || formKey?.trim() === "") {
      throw new FormLifecycleRegistrationError(
        `掛接點的 moduleKey / formKey 不可空白(${labelOf(registration)})`,
      );
    }
    if (formKey === MODULE_WIDE) {
      throw new FormLifecycleRegistrationError(
        `掛接點 ${moduleKey}:formKey 不可是 "${MODULE_WIDE}"(整個模組請省略 formKey)`,
      );
    }
    checkInject(registration);
    checkHandlers(registration, "守門", registration.guards, FORM_GUARD_NAMES);
    checkHandlers(
      registration,
      "事後動作",
      registration.effects,
      FORM_EFFECT_NAMES,
    );
    const key = keyOf(moduleKey, formKey ?? MODULE_WIDE);
    if (byKey.has(key)) {
      throw new FormLifecycleRegistrationError(
        `掛接點 ${labelOf(registration)} 重複登記`,
      );
    }
    const shape = formKey === undefined ? "module" : "forms";
    const existing = moduleShapes.get(moduleKey);
    if (existing !== undefined && existing !== shape) {
      throw new FormLifecycleRegistrationError(
        `掛接點 ${moduleKey}:不能同時登記整個模組與指定表單`,
      );
    }
    moduleShapes.set(moduleKey, shape);
    byKey.set(key, registration);
  }
  return {
    registrations: [...registrations],
    lookup(moduleKey, formKey) {
      return (
        byKey.get(keyOf(moduleKey, formKey)) ??
        byKey.get(keyOf(moduleKey, MODULE_WIDE)) ??
        null
      );
    },
  };
}

/**
 * 啟動時解析每筆登記的 `inject`(`resolve` 正式為 `ModuleRef.get(token, { strict: false })`),回每筆登記
 * 專屬的 `get`:只拿得到自己宣告的 token。宣告的 token 找不到 → `FormLifecycleRegistrationError`(app 起不來)。
 */
export function resolveLifecycleInjections(
  registrations: readonly FormLifecycleRegistration[],
  resolve: (token: InjectionToken) => unknown,
): ReadonlyMap<FormLifecycleRegistration, LifecycleResolver> {
  const resolvers = new Map<FormLifecycleRegistration, LifecycleResolver>();
  for (const registration of registrations) {
    const instances = new Map<InjectionToken, unknown>();
    for (const token of registration.inject ?? []) {
      let instance: unknown;
      try {
        instance = resolve(token);
      } catch (error) {
        throw new FormLifecycleRegistrationError(
          `掛接點 ${labelOf(registration)}:inject 的 ${tokenLabel(token)} 找不到(${error instanceof Error ? error.message : String(error)})`,
        );
      }
      instances.set(token, instance);
    }
    const label = labelOf(registration);
    resolvers.set(registration, <T>(token: InjectionToken<T>): T => {
      if (!instances.has(token)) {
        throw new Error(
          `掛接點 ${label} 沒有在 inject 宣告 ${tokenLabel(token)},取不到`,
        );
      }
      return instances.get(token) as T;
    });
  }
  return resolvers;
}
