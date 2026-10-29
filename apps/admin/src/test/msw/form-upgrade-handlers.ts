import { HttpResponse } from "msw";

import type {
  FormUpgradePlanQuery,
  FormUpgradePlanQueryVariables,
  UpgradeFormSubmissionsMutation,
  UpgradeFormSubmissionsMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "./auth-handlers";
import type { FormFailure } from "./form-runtime-handlers";
import { api } from "./server";

export interface FormUpgradeWorldOptions {
  /** `formUpgradePlan` 的回應(沒給 = v1 兩筆、沒有補值欄位) */
  plan?: FormUpgradePlanQuery["formUpgradePlan"];
  /** `upgradeFormSubmissions` 的回應(沒給 = 計畫裡的筆數全部升級、沒有跳過) */
  result?: UpgradeFormSubmissionsMutation["upgradeFormSubmissions"];
  /** 查計畫就失敗(例:`CONFLICT` + `FORM_HAS_WORKFLOW`) */
  planFailure?: FormFailure;
}

export interface FormUpgradeWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  inputs: {
    formUpgradePlan: FormUpgradePlanQueryVariables[];
    upgradeFormSubmissions: UpgradeFormSubmissionsMutationVariables["input"][];
  };
}

const DEFAULT_PLAN: FormUpgradePlanQuery["formUpgradePlan"] = {
  groups: [{ fromVersion: 1, count: 2 }],
  fillTargets: [],
};

/**
 * 舊版資料升級到新版的假 api(docs/modules/forms.md「舊版資料升級」):計畫與結果照給,
 * 記下送出的 input(補值、clientRequestId)。搬值 / 重算 / 冪等的正確性在 api 測試。
 */
export const formUpgradeWorld = (
  options: FormUpgradeWorldOptions = {},
): FormUpgradeWorld => {
  const plan = options.plan ?? DEFAULT_PLAN;
  const inputs: FormUpgradeWorld["inputs"] = {
    formUpgradePlan: [],
    upgradeFormSubmissions: [],
  };
  const handlers = [
    api.query("FormUpgradePlan", ({ variables }) => {
      inputs.formUpgradePlan.push(variables as FormUpgradePlanQueryVariables);
      const failure = options.planFailure;
      if (failure !== undefined) {
        return graphqlError(
          failure.code,
          failure.code,
          failure.extensions ?? {},
        );
      }
      return HttpResponse.json({ data: { formUpgradePlan: plan } });
    }),
    api.mutation("UpgradeFormSubmissions", ({ variables }) => {
      const { input } = variables as UpgradeFormSubmissionsMutationVariables;
      inputs.upgradeFormSubmissions.push(input);
      return HttpResponse.json({
        data: {
          upgradeFormSubmissions: options.result ?? {
            upgraded: plan.groups,
            skipped: [],
          },
        },
      });
    }),
  ];
  return { handlers, inputs };
};
