import type { ClientSession } from "mongoose";

import { TransactionService } from "../../database/transaction";
import {
  FORM_EFFECT_NAMES,
  FORM_GUARD_NAMES,
  type FormEffect,
  type FormEffectContext,
  type FormEffectName,
  type FormGuard,
  type FormGuardContext,
  type FormGuardName,
  type FormLifecycleRegistration,
  registerFormLifecycle,
} from "../workflow-engine/lifecycle/form-lifecycle-registration";
import { FORM_KEY, WORKFLOW_MODULE } from "./workflow-fixtures";

/** 測試擋下時回的專案錯誤碼。 */
export const LIFECYCLE_BLOCKED_CODE = "LIFECYCLE_TEST_BLOCKED";

/** 事後動作被觸發的一筆紀錄(不含 session / 工具)。 */
export interface EffectCall {
  event: FormEffectName;
  submissionId: string;
  revision: number;
  stepKey: string | null;
  skipped: boolean;
}

/**
 * 交易的這一次嘗試:driver 每次 `startTransaction` 換一個新的交易物件(公開型別沒有列出,所以轉型讀)。
 * 交易遇到暫時性錯誤自動重試時,同一個 session 會重新開始交易、整個動作重跑。
 */
function attemptOf(session: ClientSession): object | undefined {
  return (session as unknown as { transaction?: object }).transaction;
}

/** 一筆紀錄與它發生在哪個 session 的哪一次交易嘗試。 */
interface Recorded<T> {
  value: T;
  session: ClientSession;
  attempt: object | undefined;
}

function record<T>(
  list: Recorded<T>[],
  value: T,
  session: ClientSession,
): void {
  list.push({ value, session, attempt: attemptOf(session) });
}

/**
 * 只留下各 session 最後一次嘗試的紀錄:被自動重試取代的那一輪(已回復、整個重跑)不算,
 * 否則同一個動作的守門與事後動作會重複出現。沒被重試的回復(例:事後動作拋錯)仍照實保留。
 */
function finalAttempts<T>(list: readonly Recorded<T>[]): T[] {
  return list
    .filter(
      (one) =>
        one.attempt === undefined || attemptOf(one.session) === one.attempt,
    )
    .map((one) => one.value);
}

const recorded: {
  guards: Recorded<{ guard: FormGuardName; context: FormGuardContext }>[];
  effects: Recorded<EffectCall>[];
  effectContexts: Recorded<FormEffectContext>[];
} = { guards: [], effects: [], effectContexts: [] };

/**
 * 掛接點測試的探針:病假表單登記全部 8 個守門與 7 個事後動作,行為由測試切換。
 * - `guards` / `effects` / `effectContexts`:被呼叫的紀錄(唯讀),交易自動重試時只算最後一次嘗試
 * - `blockOn`:這個守門回「擋下」
 * - `blockWhen`:給了就只擋它回 true 的那幾筆(例:批次核准只擋其中幾張單)
 * - `onEffect`:事後動作被呼叫時要做的事(例:以 `context.session` 寫一筆專案資料、拋錯)
 */
export const lifecycleProbe: {
  readonly guards: { guard: FormGuardName; context: FormGuardContext }[];
  readonly effects: EffectCall[];
  readonly effectContexts: FormEffectContext[];
  blockOn: FormGuardName | null;
  blockWhen: ((context: FormGuardContext) => boolean) | null;
  /** 擋下時回的錯誤碼(預設 `LIFECYCLE_BLOCKED_CODE`;測不合格的碼時換掉)。 */
  blockCode: string;
  onEffect: ((context: FormEffectContext) => Promise<void>) | null;
} = {
  get guards() {
    return finalAttempts(recorded.guards);
  },
  get effects() {
    return finalAttempts(recorded.effects);
  },
  get effectContexts() {
    return finalAttempts(recorded.effectContexts);
  },
  blockOn: null,
  blockWhen: null,
  blockCode: LIFECYCLE_BLOCKED_CODE,
  onEffect: null,
};

/** 每個情境開始前清掉紀錄與切換。 */
export function resetLifecycleProbe(): void {
  recorded.guards = [];
  recorded.effects = [];
  recorded.effectContexts = [];
  lifecycleProbe.blockOn = null;
  lifecycleProbe.blockWhen = null;
  lifecycleProbe.blockCode = LIFECYCLE_BLOCKED_CODE;
  lifecycleProbe.onEffect = null;
}

const guard: FormGuard = (context) => {
  record(recorded.guards, { guard: context.guard, context }, context.session);
  const isBlocked =
    lifecycleProbe.blockOn === context.guard &&
    (lifecycleProbe.blockWhen?.(context) ?? true);
  return isBlocked
    ? { code: lifecycleProbe.blockCode, message: `blocked by ${context.guard}` }
    : null;
};

const effect: FormEffect = async (context) => {
  record(
    recorded.effects,
    {
      event: context.event,
      submissionId: String(context.submissionId),
      revision: context.revision,
      stepKey: context.stepKey,
      skipped: context.skipped,
    },
    context.session,
  );
  record(recorded.effectContexts, context, context.session);
  await lifecycleProbe.onEffect?.(context);
};

/** 以專案身分接進 `project/form-lifecycles.ts` 的登記(測試以 `jest.mock` 替換固定入口)。 */
export const LIFECYCLE_FIXTURE_REGISTRATIONS: readonly FormLifecycleRegistration[] =
  [
    registerFormLifecycle({
      moduleKey: WORKFLOW_MODULE,
      formKey: FORM_KEY,
      // handler 的 get 只拿得到這一個(測試驗「宣告的拿得到、沒宣告的拋錯」)
      inject: [TransactionService],
      guards: Object.fromEntries(FORM_GUARD_NAMES.map((name) => [name, guard])),
      effects: Object.fromEntries(
        FORM_EFFECT_NAMES.map((name) => [name, effect]),
      ),
    }),
  ];
