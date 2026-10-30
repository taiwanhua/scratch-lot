import { HttpResponse } from "msw";

import type {
  DataScopeRuleQuery,
  DataScopeRuleQueryVariables,
  DataScopeTargetsQuery,
  RolesQuery,
  RolesQueryVariables,
  SaveDataScopeRuleMutationVariables,
  UsersQueryVariables,
} from "@repo/graphql";

import { type GraphqlErrorCode, graphqlError } from "./auth-handlers";
import type { TestOrgNode, TestOrgUser } from "./org-manager-handlers";
import type { TestMatrixModule } from "./role-fixtures";
import { api } from "./server";

export type TestDataScopeTarget =
  DataScopeTargetsQuery["dataScopeTargets"]["targets"][number];
export type TestDataScopeRule = NonNullable<
  DataScopeRuleQuery["dataScopeRule"]["rule"]
>;
export type TestRole = RolesQuery["roles"]["items"][number];

/** 會被指定失敗的操作(值是 `errors[0].extensions.code` 與附加的 `extensions`)。 */
export interface DataScopeFailure {
  code: GraphqlErrorCode;
  /** `RULE_INVALID` 的 `path` / `reason` 就放這裡 */
  extensions?: Record<string, unknown>;
}

export interface DataScopeWorldOptions {
  targets?: TestDataScopeTarget[];
  /** 已存在的規則;沒列到的目標一律回 `rule: null`(尚無規則) */
  rules?: TestDataScopeRule[];
  roles?: TestRole[];
  users?: TestOrgUser[];
  orgTree?: TestOrgNode[];
  /** `audiencePermissionOptions` 回的權限樹(套用對象「權限」的選項;= 權限矩陣的顯示樹) */
  permissionModules?: TestMatrixModule[];
  failures?: { SaveDataScopeRule?: DataScopeFailure };
}

export interface DataScopeWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  /** `saveDataScopeRule` 收到的輸入(依序),用來斷言送出去的 payload 形狀 */
  inputs: { saveDataScopeRule: SaveDataScopeRuleMutationVariables["input"][] };
}

const TIMESTAMP = "2026-09-20T03:00:00.000Z";

/** 業務錯誤碼(GQL-04:`errors[0].extensions.code`)。 */
const fail = (
  code: GraphqlErrorCode,
  extensions: Record<string, unknown> = {},
) => graphqlError(code, code, extensions);

/**
 * 資料範圍頁的假 api(三個端點 + 選擇器要用的 `roles` / `users` / `orgTree`
 * / `audiencePermissionOptions`)。
 *
 * `saveDataScopeRule` 是**整份覆蓋**:成功時把送進來的那份存進記憶體並原樣回傳,
 * 所以儲存後重新查詢會拿到新的規則(左清單的「已設規則」也才會亮)。
 */
export const dataScopeWorld = (
  options: DataScopeWorldOptions = {},
): DataScopeWorld => {
  const {
    targets = [],
    rules = [],
    roles = [],
    users = [],
    orgTree = [],
    permissionModules = [],
    failures = {},
  } = options;

  const inputs: DataScopeWorld["inputs"] = { saveDataScopeRule: [] };
  const stored = new Map(rules.map((rule) => [rule.targetId, rule]));

  const handlers = [
    api.query("DataScopeTargets", () =>
      // `hasRule` 由目前存著的規則算出來(有規則文件且 rules 非空才算),
      // 不是夾具寫死的 —— 儲存後重查才會亮,與 api 同一條判準(TEST-08 的有狀態假伺服器)
      HttpResponse.json({
        data: {
          dataScopeTargets: {
            targets: targets.map((target) => ({
              ...target,
              hasRule: (stored.get(target.id)?.rules ?? []).length > 0,
            })),
          },
        },
      }),
    ),
    api.query("DataScopeRule", ({ variables }) => {
      const { targetId } = variables as DataScopeRuleQueryVariables;
      if (!targets.some((target) => target.id === targetId)) {
        return fail("NOT_FOUND");
      }
      return HttpResponse.json({
        data: { dataScopeRule: { rule: stored.get(targetId) ?? null } },
      });
    }),
    api.mutation("SaveDataScopeRule", ({ variables }) => {
      const { input } = variables as SaveDataScopeRuleMutationVariables;
      inputs.saveDataScopeRule.push(input);
      const failure = failures.SaveDataScopeRule;
      if (failure !== undefined) {
        return fail(failure.code, failure.extensions ?? {});
      }
      const target = targets.find((item) => item.id === input.targetId);
      if (target === undefined) {
        return fail("NOT_FOUND");
      }
      const saved = {
        targetId: target.id,
        collection: target.collection,
        moduleKey: target.moduleKey,
        combineOp: input.combineOp ?? "OR",
        updatedAt: TIMESTAMP,
        rules: input.rules,
      } as TestDataScopeRule;
      stored.set(target.id, saved);
      return HttpResponse.json({
        data: { saveDataScopeRule: { rule: saved } },
      });
    }),
    api.query("Roles", ({ variables }) => {
      const { input } = variables as RolesQueryVariables;
      return HttpResponse.json({
        data: {
          roles: {
            totalCount: roles.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 100,
            items: roles,
          },
        },
      });
    }),
    api.query("Users", ({ variables }) => {
      const { input } = variables as UsersQueryVariables;
      return HttpResponse.json({
        data: {
          users: {
            totalCount: users.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 100,
            items: users,
          },
        },
      });
    }),
    api.query("OrgTree", () => HttpResponse.json({ data: { orgTree } })),
    api.query("AudiencePermissionOptions", () =>
      HttpResponse.json({
        data: { audiencePermissionOptions: { modules: permissionModules } },
      }),
    ),
  ];

  return { handlers, inputs };
};
