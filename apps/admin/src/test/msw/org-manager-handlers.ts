import { HttpResponse, http } from "msw";

import type {
  AddOrgMembersMutationVariables,
  CreateChildOrgMutationVariables,
  CreateUploadUrlMutationVariables,
  DeleteOrgMutationVariables,
  MoveOrgMutationVariables,
  OrgMemberCandidatesQueryVariables,
  OrgMembersQuery,
  OrgMembersQueryVariables,
  OrgQuery,
  OrgQueryVariables,
  OrgTreeQuery,
  ProvisionTenantMutationVariables,
  RevokeTenantProvisionMutationVariables,
  SetOrgEnabledMutationVariables,
  SetOrgManagersMutationVariables,
  SetOrgTimezoneMutationVariables,
  SetOrgVisibilityMutationVariables,
  TenantModuleOptionsQuery,
  TransferOrgOwnerMutationVariables,
  UpdateOrgMutationVariables,
  UsersQuery,
  UsersQueryVariables,
} from "@repo/graphql";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import {
  type TestUserSummary,
  orgManagersWorld,
} from "./org-managers-handlers";
import { orgTenantTopWorld } from "./org-tenant-top-handlers";
import { api } from "./server";

export type TestOrgNode = OrgTreeQuery["orgTree"][number];
export type TestOrg = OrgQuery["org"];
export type TestModuleOption =
  TenantModuleOptionsQuery["tenantModuleOptions"][number];
export type TestOrgUser = UsersQuery["users"]["items"][number];
export type TestOrgMember = OrgMembersQuery["orgMembers"]["items"][number];

/** 簽名上傳網址的假位址;`uploadedFiles` 記錄真的被 PUT 上去的東西。 */
export const TEST_UPLOAD_ORIGIN = "https://storage.test";

/** 會被指定失敗的操作(值是 `errors[0].extensions.code`)。 */
export type OrgOperation =
  | "CreateChildOrg"
  | "UpdateOrg"
  | "SetOrgEnabled"
  | "MoveOrg"
  | "DeleteOrg"
  | "ProvisionTenant"
  | "RevokeTenantProvision"
  | "TransferOrgOwner"
  | "SetOrgVisibility"
  | "SetOrgTimezone"
  | "AddOrgMembers"
  | "SetOrgManagers"
  | "CreateUploadUrl";

export interface OrgFailure {
  code: string;
  /** 附加在 `extensions` 上的欄位(如 `ORG_NOT_DELETABLE` 的 `reasons`) */
  extensions?: Record<string, unknown>;
}

export interface OrgWorldOptions {
  orgTree?: TestOrgNode[];
  /** `org(id)` 的來源;查不到的 id 回 NOT_FOUND */
  orgs?: TestOrg[];
  /** `users` 的來源(擁有者姓名與轉移候選人) */
  users?: TestOrgUser[];
  /** `orgMembers` 的來源:orgId → 該組織**自己**的成員(不含下層,#377);加入成員後即時變動 */
  members?: Record<string, TestOrgMember[]>;
  /** 管理範圍內的全部使用者;`orgMemberCandidates` = 這些人扣掉該組織的既有成員 */
  memberCandidates?: TestOrgMember[];
  moduleOptions?: TestModuleOption[];
  /** `org(id).managers` 的來源:orgId → 主管(設定順序);`setOrgManagers` 整組取代這份狀態 */
  managers?: Record<string, TestUserSummary[]>;
  /** 本租戶啟用中的使用者;`orgManagerCandidates` 依關鍵字過濾它 */
  managerCandidates?: TestUserSummary[];
  failures?: Partial<Record<OrgOperation, OrgFailure>>;
}

export interface OrgWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  /** 各操作收到的輸入(依序),用來斷言「送出去的是什麼」 */
  inputs: {
    createChildOrg: CreateChildOrgMutationVariables["input"][];
    updateOrg: UpdateOrgMutationVariables["input"][];
    setOrgEnabled: SetOrgEnabledMutationVariables["input"][];
    moveOrg: MoveOrgMutationVariables["input"][];
    deleteOrg: DeleteOrgMutationVariables["input"][];
    provisionTenant: ProvisionTenantMutationVariables["input"][];
    revokeTenantProvision: RevokeTenantProvisionMutationVariables["input"][];
    transferOrgOwner: TransferOrgOwnerMutationVariables["input"][];
    setOrgVisibility: SetOrgVisibilityMutationVariables["input"][];
    setOrgTimezone: SetOrgTimezoneMutationVariables["input"][];
    addOrgMembers: AddOrgMembersMutationVariables["input"][];
    setOrgManagers: SetOrgManagersMutationVariables["input"][];
    createUploadUrl: CreateUploadUrlMutationVariables["input"][];
  };
  /** 直傳到簽名網址的檔案(ADR-0010 第 2 步) */
  uploadedFiles: { url: string; contentType: string | null; size: number }[];
}

/**
 * 組織管理頁的假 api(#134 組織 + #135 租戶作業 + #137 上傳票 + #136 的 `users`)。
 *
 * 商標上傳是三方的:`CreateUploadUrl` 發一張指向 `TEST_UPLOAD_ORIGIN` 的票、
 * 瀏覽器 `PUT` 上去(由 `http.put` 接住並記錄)、`objectPath` 再回到 `updateOrg` /
 * `provisionTenant` 的 `logoPath` — 三步都要攔,少一步測試會撞 `onUnhandledRequest: "error"`。
 */
export const orgWorld = (options: OrgWorldOptions = {}): OrgWorld => {
  const {
    orgTree = [],
    orgs = [],
    users = [],
    members = {},
    memberCandidates = [],
    moduleOptions = [],
    managers = {},
    managerCandidates = [],
    failures = {},
  } = options;

  /** 加入成員會真的改到這份狀態(TEST-08:有連動語意就實作進 handler) */
  const membersByOrg = new Map(
    Object.entries(members).map(([orgId, rows]) => [orgId, [...rows]]),
  );

  const fail = (operation: OrgOperation) => {
    const failure = failures[operation];
    return failure === undefined
      ? null
      : graphqlError(
          failure.code as AuthErrorCode,
          failure.code,
          failure.extensions ?? {},
        );
  };

  const tenantTopWorld = orgTenantTopWorld({ failure: fail });

  const inputs: OrgWorld["inputs"] = {
    createChildOrg: [],
    updateOrg: [],
    setOrgEnabled: [],
    moveOrg: [],
    deleteOrg: [],
    provisionTenant: [],
    revokeTenantProvision: [],
    transferOrgOwner: [],
    ...tenantTopWorld.inputs,
    addOrgMembers: [],
    setOrgManagers: [],
    createUploadUrl: [],
  };
  const uploadedFiles: OrgWorld["uploadedFiles"] = [];

  const orgOf = (id: string) => {
    const found = orgs.find((org) => org.id === id);
    return found === undefined ? found : tenantTopWorld.withTimezone(found);
  };

  const managersWorld = orgManagersWorld({
    managers,
    managerCandidates,
    failure: () => fail("SetOrgManagers"),
  });
  inputs.setOrgManagers = managersWorld.inputs;

  const handlers = [
    api.query("OrgTree", () => HttpResponse.json({ data: { orgTree } })),
    api.query("Org", ({ variables }) => {
      const { id } = variables as OrgQueryVariables;
      const org = orgOf(id);
      return org === undefined
        ? graphqlError("FORBIDDEN", "NOT_FOUND")
        : HttpResponse.json({ data: { org } });
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
    ...managersWorld.handlers,
    ...tenantTopWorld.handlers,
    api.query("TenantModuleOptions", () =>
      HttpResponse.json({ data: { tenantModuleOptions: moduleOptions } }),
    ),
    // 成員頁籤(#377):清單只回這個組織自己的成員,候選是「管理範圍內扣掉既有成員」,
    // 加入成員真的改到 `membersByOrg` —— 連動語意實作進 handler(TEST-08)
    api.query("OrgMembers", ({ variables }) => {
      const { orgId, input } = variables as OrgMembersQueryVariables;
      const rows = membersByOrg.get(orgId) ?? [];
      return HttpResponse.json({
        data: {
          orgMembers: {
            totalCount: rows.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 10,
            items: rows,
          },
        },
      });
    }),
    api.query("OrgMemberCandidates", ({ variables }) => {
      const { orgId, input } = variables as OrgMemberCandidatesQueryVariables;
      const taken = new Set(
        (membersByOrg.get(orgId) ?? []).map((row) => row.id),
      );
      const keyword = input.keyword?.trim().toLowerCase() ?? "";
      const rows = memberCandidates
        .filter((row) => !taken.has(row.id))
        .filter(
          (row) =>
            keyword === "" ||
            row.name.toLowerCase().includes(keyword) ||
            row.account.toLowerCase().includes(keyword),
        );
      return HttpResponse.json({
        data: {
          orgMemberCandidates: {
            totalCount: rows.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 20,
            items: rows,
          },
        },
      });
    }),
    api.mutation("AddOrgMembers", ({ variables }) => {
      const { input } = variables as AddOrgMembersMutationVariables;
      inputs.addOrgMembers.push(input);
      const failure = fail("AddOrgMembers");
      if (failure !== null) {
        return failure;
      }
      const current = membersByOrg.get(input.orgId) ?? [];
      const taken = new Set(current.map((row) => row.id));
      const added = input.userIds.filter((userId) => !taken.has(userId));
      membersByOrg.set(input.orgId, [
        ...current,
        ...added.flatMap((userId) => {
          const row = memberCandidates.find((one) => one.id === userId);
          return row === undefined ? [] : [row];
        }),
      ]);
      return HttpResponse.json({
        data: {
          addOrgMembers: {
            addedUserIds: added,
            skippedUserIds: input.userIds.filter((userId) => taken.has(userId)),
          },
        },
      });
    }),
    api.mutation("CreateChildOrg", ({ variables }) => {
      const { input } = variables as CreateChildOrgMutationVariables;
      inputs.createChildOrg.push(input);
      return (
        fail("CreateChildOrg") ??
        HttpResponse.json({
          data: {
            createChildOrg: {
              org: {
                id: "org-new",
                name: input.name,
                description: input.description ?? null,
                parentId: input.parentId,
                enabled: true,
              },
            },
          },
        })
      );
    }),
    api.mutation("UpdateOrg", ({ variables }) => {
      const { input } = variables as UpdateOrgMutationVariables;
      inputs.updateOrg.push(input);
      const current = orgOf(input.id);
      return (
        fail("UpdateOrg") ??
        HttpResponse.json({
          data: {
            updateOrg: {
              org: {
                id: input.id,
                name: input.name ?? current?.name ?? "",
                description: input.description ?? null,
                logoUrl: current?.logoUrl ?? null,
              },
            },
          },
        })
      );
    }),
    api.mutation("SetOrgEnabled", ({ variables }) => {
      const { input } = variables as SetOrgEnabledMutationVariables;
      inputs.setOrgEnabled.push(input);
      return (
        fail("SetOrgEnabled") ??
        HttpResponse.json({
          data: {
            setOrgEnabled: { org: { id: input.id, enabled: input.enabled } },
          },
        })
      );
    }),
    api.mutation("MoveOrg", ({ variables }) => {
      const { input } = variables as MoveOrgMutationVariables;
      inputs.moveOrg.push(input);
      return (
        fail("MoveOrg") ??
        HttpResponse.json({
          data: {
            moveOrg: { org: { id: input.id, parentId: input.newParentId } },
          },
        })
      );
    }),
    api.mutation("DeleteOrg", ({ variables }) => {
      const { input } = variables as DeleteOrgMutationVariables;
      inputs.deleteOrg.push(input);
      return (
        fail("DeleteOrg") ??
        HttpResponse.json({
          data: { deleteOrg: { success: true, deletedId: input.id } },
        })
      );
    }),
    api.mutation("ProvisionTenant", ({ variables }) => {
      const { input } = variables as ProvisionTenantMutationVariables;
      inputs.provisionTenant.push(input);
      return (
        fail("ProvisionTenant") ??
        HttpResponse.json({
          data: {
            provisionTenant: {
              org: {
                id: "org-tenant-new",
                name: input.name,
                parentId: "org-root",
                enabled: true,
                ownerUserId: "user-new-admin",
                visibility: "OWN",
                slug: input.slug,
                logoUrl: null,
              },
              ownerUserId: "user-new-admin",
              roleId: "role-copy",
              moduleKeys: input.moduleKeys,
              activationMailSent: true,
            },
          },
        })
      );
    }),
    api.mutation("RevokeTenantProvision", ({ variables }) => {
      const { input } = variables as RevokeTenantProvisionMutationVariables;
      inputs.revokeTenantProvision.push(input);
      const org = orgOf(input.orgId);
      return (
        fail("RevokeTenantProvision") ??
        HttpResponse.json({
          data: {
            revokeTenantProvision: {
              success: true,
              revokedOrgId: input.orgId,
              revokedOwnerUserId: org?.ownerUserId ?? null,
              revokedRoleId: "role-copy",
            },
          },
        })
      );
    }),
    api.mutation("TransferOrgOwner", ({ variables }) => {
      const { input } = variables as TransferOrgOwnerMutationVariables;
      inputs.transferOrgOwner.push(input);
      return (
        fail("TransferOrgOwner") ??
        HttpResponse.json({
          data: {
            transferOrgOwner: {
              org: { id: input.orgId, ownerUserId: input.newOwnerUserId },
            },
          },
        })
      );
    }),
    api.mutation("CreateUploadUrl", ({ variables }) => {
      const { input } = variables as CreateUploadUrlMutationVariables;
      inputs.createUploadUrl.push(input);
      const serial = String(inputs.createUploadUrl.length);
      return (
        fail("CreateUploadUrl") ??
        HttpResponse.json({
          data: {
            createUploadUrl: {
              uploadUrl: `${TEST_UPLOAD_ORIGIN}/signed/${serial}`,
              objectPath: `org-logos/${serial}.png`,
              expiresAt: "2026-09-19T00:10:00.000Z",
            },
          },
        })
      );
    }),
    http.put(`${TEST_UPLOAD_ORIGIN}/signed/*`, async ({ request }) => {
      const body = await request.arrayBuffer();
      uploadedFiles.push({
        url: request.url,
        contentType: request.headers.get("content-type"),
        size: body.byteLength,
      });
      return new HttpResponse(null, { status: 200 });
    }),
  ];

  return { handlers: handlers as OrgWorld["handlers"], inputs, uploadedFiles };
};
