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
 * 掛接點測試的探針:病假表單登記全部 8 個守門與 7 個事後動作,行為由測試切換。
 * - `blockOn`:這個守門回「擋下」
 * - `onEffect`:事後動作被呼叫時要做的事(例:以 `context.session` 寫一筆專案資料、拋錯)
 */
export const lifecycleProbe: {
  guards: { guard: FormGuardName; context: FormGuardContext }[];
  effects: EffectCall[];
  effectContexts: FormEffectContext[];
  blockOn: FormGuardName | null;
  onEffect: ((context: FormEffectContext) => Promise<void>) | null;
} = {
  guards: [],
  effects: [],
  effectContexts: [],
  blockOn: null,
  onEffect: null,
};

/** 每個情境開始前清掉紀錄與切換。 */
export function resetLifecycleProbe(): void {
  lifecycleProbe.guards = [];
  lifecycleProbe.effects = [];
  lifecycleProbe.effectContexts = [];
  lifecycleProbe.blockOn = null;
  lifecycleProbe.onEffect = null;
}

const guard: FormGuard = (context) => {
  lifecycleProbe.guards.push({ guard: context.guard, context });
  return lifecycleProbe.blockOn === context.guard
    ? { code: LIFECYCLE_BLOCKED_CODE, message: `blocked by ${context.guard}` }
    : null;
};

const effect: FormEffect = async (context) => {
  lifecycleProbe.effects.push({
    event: context.event,
    submissionId: String(context.submissionId),
    revision: context.revision,
    stepKey: context.stepKey,
    skipped: context.skipped,
  });
  lifecycleProbe.effectContexts.push(context);
  await lifecycleProbe.onEffect?.(context);
};

/** 以專案身分接進 `project/form-lifecycles.ts` 的登記(測試以 `jest.mock` 替換固定入口)。 */
export const LIFECYCLE_FIXTURE_REGISTRATIONS: readonly FormLifecycleRegistration[] =
  [
    registerFormLifecycle({
      moduleKey: WORKFLOW_MODULE,
      formKey: FORM_KEY,
      guards: Object.fromEntries(FORM_GUARD_NAMES.map((name) => [name, guard])),
      effects: Object.fromEntries(
        FORM_EFFECT_NAMES.map((name) => [name, effect]),
      ),
    }),
  ];
