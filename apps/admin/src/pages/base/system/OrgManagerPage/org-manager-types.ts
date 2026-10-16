import type {
  OrgMembersQuery,
  OrgQuery,
  TenantModuleOptionsQuery,
} from "@repo/graphql";

/** 右側資料區的一筆組織(`org(id)` 的完整形狀)。 */
export type OrgDetail = OrgQuery["org"];

/** 開通彈窗的模組勾選選項(`tenantModuleOptions`;`parentId` 指向同清單內的模組 id)。 */
export type TenantModuleOption =
  TenantModuleOptionsQuery["tenantModuleOptions"][number];

/** 成員清單的一列(`orgMembers` 的 item;欄位語意見 `docs/modules/org-manager.md`「api 介面」)。 */
export type OrgMemberRow = OrgMembersQuery["orgMembers"]["items"][number];

/** 成員清單每頁筆數。 */
export const ORG_MEMBERS_PAGE_SIZE = 10;

/** 「加入成員」彈窗的候選清單每頁筆數(彈窗不分頁,只取前 N 筆 + 搜尋收斂)。 */
export const ORG_MEMBER_CANDIDATES_PAGE_SIZE = 20;

/**
 * 頁面上可執行的動作(ADR-0011「頁內判斷」)。
 * 前三個是任何組織都可能有的;租戶作業那三個只有根組織的操作者拿得到(ADR-0009);
 * 成員那兩個是組織管理層自己的(#377),租戶管理員靠 `system.org-manager.*` 取得。
 */
export interface OrgActionAbility {
  canCreateChild: boolean;
  canEdit: boolean;
  canToggleEnabled: boolean;
  canMove: boolean;
  canDelete: boolean;
  canViewMembers: boolean;
  canAddMembers: boolean;
  canProvision: boolean;
  canRevokeProvision: boolean;
  canTransferOwner: boolean;
  canSetVisibility: boolean;
  canSetTimezone: boolean;
}

/** 商標的上傳限制(api 正本 `apps/api/src/storage/storage.service.ts`,ADR-0010)。 */
export const LOGO_ACCEPT = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_SIZE = 2 * 1024 * 1024;

/** 轉移擁有者的候選人清單一次取這麼多(`users` 的 pageSize 上限 100)。 */
export const OWNER_CANDIDATE_PAGE_SIZE = 100;
