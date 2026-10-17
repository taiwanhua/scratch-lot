import { HttpResponse } from "msw";

import type { FormDefinition } from "@repo/domain/form";
import {
  type FormVersionQueryVariables,
  FormVersionStatus,
  RoleKind,
  type UsersQueryVariables,
} from "@repo/graphql";

import { rawOf } from "@/lib/base/form-engine/definition";

import { formFragment } from "./form-fixtures";
import { tenantTree } from "./org-fixtures";
import { matrixModules } from "./role-fixtures";
import { api } from "./server";
import { FINANCE_ROLE_ID, HR_ROLE_ID } from "./workflow-audience-fixtures";
import {
  APPLICANT,
  DEMO_GROUP_FORM_KEY,
  HR,
  LEAVE_FORM_KEY,
  MANAGER,
  leaveDefinition,
} from "./workflow-fixtures";

/** 流程設計器 / 改派要借的目錄:表單(檢查用表單、表單欄位來源)、角色、使用者候選。 */
export interface WorkflowCatalogOptions {
  users?: { id: string; name: string; account: string; enabled: boolean }[];
  /** `forms` 回報的總筆數(沒給 = 實際筆數);大於一頁時設計器提示「清單已截斷」 */
  formsTotal?: number;
  /** 檢查用表單目前版本的定義(沒給 = 病假單 `leaveDefinition`) */
  checkFormDefinition?: FormDefinition;
}

export const catalogUsers = [
  { ...MANAGER, account: "manager", enabled: true },
  { ...APPLICANT, account: "ming", enabled: true },
  { ...HR, account: "hr", enabled: true },
  { id: "user-4", name: "副理阿強", account: "deputy", enabled: true },
  { id: "user-5", name: "離職的老王", account: "gone", enabled: false },
];

export const catalogRoles = [
  { id: HR_ROLE_ID, name: "人資" },
  { id: FINANCE_ROLE_ID, name: "財務" },
];

/**
 * 目錄的假 api(借的是表單管理 `forms` / `formVersion`、角色管理 `roles`、使用者管理 `users`、
 * 人員條件要的 `orgTree` / `audiencePermissionOptions`):
 * 只回設計器與改派跳窗要的形狀。mock 模式裡這幾個端點另有正本 world,這份只給流程頁的測試用。
 */
export const workflowCatalogHandlers = (
  options: WorkflowCatalogOptions = {},
) => {
  const users = options.users ?? catalogUsers;
  return [
    api.query("Forms", () => {
      const items = [
        formFragment({
          key: LEAVE_FORM_KEY,
          name: "病假單",
          moduleKey: DEMO_GROUP_FORM_KEY,
          moduleName: "示範表單(群組內)",
          hasDraft: false,
        }),
      ];
      return HttpResponse.json({
        data: {
          forms: {
            items,
            totalCount: options.formsTotal ?? items.length,
            page: 1,
            pageSize: 100,
          },
        },
      });
    }),
    api.query("FormVersion", ({ variables }) => {
      const { formKey } = variables as FormVersionQueryVariables;
      return HttpResponse.json({
        data: {
          formVersion: {
            formVersion: {
              id: `ver-${formKey}-1`,
              formKey,
              version: 1,
              status: FormVersionStatus.Published,
              draftRevision: 1,
              baseVersion: null,
              ...rawOf(options.checkFormDefinition ?? leaveDefinition()),
              changelog: null,
              publishedAt: null,
              publishedBy: null,
              createdAt: "2026-09-20T02:00:00.000Z",
              updatedAt: "2026-09-20T02:00:00.000Z",
            },
            validation: { errors: [], warnings: [] },
          },
        },
      });
    }),
    api.query("Roles", () => {
      const items = catalogRoles.map((role) => ({
        ...role,
        description: null,
        enabled: true,
        kind: RoleKind.Custom,
        abilities: {
          canEdit: true,
          canEditMatrix: true,
          canToggleEnabled: true,
          canDelete: true,
        },
        isSystem: false,
        isTemplateCopy: false,
        userCount: 1,
        ownerOrg: { id: "org-1", name: "平台根組織", tenantTop: null },
      }));
      return HttpResponse.json({
        data: {
          roles: { items, totalCount: items.length, page: 1, pageSize: 100 },
        },
      });
    }),
    // 人員條件(審核者)的摘要與對話框:組織樹、權限樹
    api.query("OrgTree", () =>
      HttpResponse.json({ data: { orgTree: tenantTree } }),
    ),
    api.query("AudiencePermissionOptions", () =>
      HttpResponse.json({
        data: { audiencePermissionOptions: { modules: matrixModules } },
      }),
    ),
    api.query("Users", ({ variables }) => {
      const { input } = variables as UsersQueryVariables;
      const keyword = input.keyword?.trim() ?? "";
      const items = users
        .filter(
          (user) =>
            keyword === "" ||
            user.name.includes(keyword) ||
            user.account.includes(keyword),
        )
        .map((user) => ({
          ...user,
          email: `${user.account}@example.invalid`,
          orgs: [],
          roles: [],
        }));
      return HttpResponse.json({
        data: {
          users: { items, totalCount: items.length, page: 1, pageSize: 50 },
        },
      });
    }),
  ];
};
