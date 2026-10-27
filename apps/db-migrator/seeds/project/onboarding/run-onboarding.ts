/**
 * 開通腳本本體(專案規格第 2 章、2.2;正本 `docs/modules/project/lottery-onboarding.md`)。
 *
 * 以**租戶管理員**登入的 client 依序跑 `ONBOARDING_STEPS`,全部走既有的 GraphQL:權限照常檢查、
 * 操作紀錄照常記在這位管理員名下;不連資料庫。每一步冪等(已經有的沿用,不改回去)。
 * 某一步失敗(例:沒有權限)→ 照 api 回的錯誤停在那一步並列出,已完成的步驟保留;
 * 補好之後重跑,前面的步驟會回報「已存在」,從缺的開始補。
 *
 * 開通 skill(`onboard` 指令)與示範指令(`seeds/project/demo/`)都呼叫這一支。
 */
import { GraphqlRequestError } from "../../../src/demo/graphql-client";
import {
  type OnboardingContext,
  type OnboardingStep,
  type UserActivation,
  emptyState,
} from "./context";
import type { OnboardingPlan } from "./plan";
import { ONBOARDING_STEPS } from "./steps";

/** 停在某一步(訊息已含步驟與 api 的錯誤;已完成的步驟保留)。 */
export class OnboardingStoppedError extends Error {
  constructor(
    message: string,
    readonly stepKey: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "OnboardingStoppedError";
  }
}

export interface RunOnboardingInput {
  client: OnboardingContext["client"];
  plan: OnboardingPlan;
  activation: UserActivation;
  /** 要開通的租戶短碼(登入者所屬的租戶要是它)。 */
  tenantSlug: string;
  print: (line: string) => void;
  /** 預設 `ONBOARDING_STEPS`;測試可換。 */
  steps?: readonly OnboardingStep[];
}

function describeError(error: unknown): {
  message: string;
  code: string | null;
} {
  if (error instanceof GraphqlRequestError) {
    const fields =
      error.fields.length > 0 ? `,欄位:${error.fields.join("、")}` : "";
    return {
      message: `${error.message}(${error.code ?? "沒有錯誤碼"}${fields})`,
      code: error.code,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    code: null,
  };
}

export async function runOnboarding({
  client,
  plan,
  activation,
  tenantSlug,
  print,
  steps = ONBOARDING_STEPS,
}: RunOnboardingInput): Promise<void> {
  const context: OnboardingContext = {
    client,
    plan,
    activation,
    tenantSlug,
    state: emptyState(),
  };
  const total = String(steps.length);
  for (const [index, step] of steps.entries()) {
    const label = `[${String(index + 1)}/${total}] ${step.title}`;
    let lines: string[];
    try {
      lines = await step.run(context);
    } catch (error) {
      const { message, code } = describeError(error);
      const rest = steps.slice(index + 1).map((next) => next.title);
      print(`✗ ${label}:${message}`);
      if (rest.length > 0) {
        print(`  未執行:${rest.join("、")}`);
      }
      throw new OnboardingStoppedError(
        `開通停在第 ${String(index + 1)} 步「${step.title}」:${message}。已完成的步驟保留;補好之後重跑,會從缺的開始補`,
        step.key,
        code,
      );
    }
    print(`✓ ${label}`);
    for (const line of lines) {
      print(`  ${line}`);
    }
  }
  print(
    "開通腳本完成;人工步驟見開通清單(docs/modules/project/lottery-onboarding.md)",
  );
}
