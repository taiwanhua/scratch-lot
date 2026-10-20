import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { useOrgTreeQuery, useTenantOrgTreeQuery } from "@repo/graphql";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Tag } from "@repo/ui/tag";

import {
  TreeSelectField,
  type TreeSelectFieldItem,
} from "@/components/base/TreeSelect/TreeSelectField";
import { TreeSelectPopup } from "@/components/base/TreeSelect/TreeSelectPopup";
import { useSession } from "@/hooks/base/useSession";
import {
  type OrgNodeLike,
  flattenOrgs,
  tenantTreeToOrgNodes,
} from "@/lib/base/org-tree";

import { OrgTreeSelectPanel } from "./OrgTreeSelectPanel";

/**
 * 選組織的模式(用法表正本:`docs/concepts/frontend-architecture.md`「組織選擇器」):
 * - `managed`(預設):**管理範圍**(`orgTree`,要組織管理 / 使用者管理的檢視權限)—— 底座治理用途
 *   (人員條件 / `AudiencePicker` 的所屬組織、資料範圍的套用對象、流程的跳過組織),行為維持原樣。
 * - `visible`:**可見範圍** —— 業務頁選分店(收銀點、報表、行事曆、規則…)。樹列**整棵租戶樹**
 *   (`tenantOrgTree`),只有可見範圍內的能選,其他反灰並註明「不在你的可見範圍內」。
 * - `tenant`:**整個租戶**都能選(之後的資料共用用途);同樣列整棵租戶樹。
 */
export type OrgTreeSelectScope = "managed" | "visible" | "tenant";

export interface OrgTreeSelectProps {
  /** 選組織的模式;預設 `managed`(見 `OrgTreeSelectScope` 與用法表) */
  scope?: OrgTreeSelectScope;
  /** 浮動標籤,同時是欄位與面板的無障礙名稱 */
  label: string;
  /** 受控的已選組織 id;單選傳 0 或 1 個 */
  value: readonly string[];
  /** 單選回傳 1 個;多選回傳整個陣列 */
  onChange: (ids: string[]) => void;
  /** 多選:節點左側勾選框、面板不因選取而關閉、欄位以標籤列出;預設單選 */
  isMultiSelect?: boolean;
  /** 多選的數量上限:到了之後其餘未勾的節點停用,面板底部顯示「最多選 N 個」 */
  maxCount?: number;
  /** 停用 + 原因(透傳 `OrgTreePicker`):節點看得到、選不了,右側顯示原因 */
  disabledReasons?: Readonly<Partial<Record<string, string>>>;
  helperText?: ReactNode;
  error?: boolean;
  required?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
}

/** 樹的捲動上限(浮動面板);手機全螢幕對話框由對話框自己捲動 */
const PANEL_TREE_MAX_HEIGHT = 320;
const EMPTY_REASONS: Readonly<Partial<Record<string, string>>> = {};

/**
 * 組織欄位(Figma `Draft/OrgTreeSelect`):輸入框顯示已選組織,
 * 點開是「搜尋 + 組織樹」;單選 / 多選、多選可設上限。
 *
 * - **候選依模式(`scope`)**:`managed` 查 `orgTree`(只回管理範圍);`visible` / `tenant` 查
 *   `tenantOrgTree`(整棵租戶樹 + 可見 / 可管理旗標),`visible` 把可見範圍外的反灰並註明原因。
 *   呼叫端不必、也不能另給一份清單;呼叫端的 `disabledReasons` 照舊疊加在上面(呼叫端的原因優先)。
 * - **組織本身停用(`enabled: false`)照常可選**,樹上帶「已停用」標籤提示。
 * - **已選但樹上沒有的組織**(範圍外,api 不回):欄位顯示「不在你的管理範圍內」(`visible` / `tenant` 是「不在你的可見範圍內」),可以取消,計入上限。
 * - **停用有兩種來源**:範圍外(`visible` 模式下可見範圍外的節點;`managed` 的 api 只回範圍內、恆為 false)與呼叫端的
 *   `disabledReasons`(例:專案的一對一對應把已占用的分店停用並註明「已由 王小明 對應」)。
 *   已選的組織之後變成停用時,欄位上的標籤仍在、可以取消,但在樹上勾不回來。
 * - **版面**:欄位與外殼共用 `components/base/TreeSelect/`(`TreeSelectField` / `TreeSelectPopup`):
 *   sm 以上是欄位下方的浮動面板(寬度跟著欄位);< sm 改開全螢幕對話框
 *   (標題 + 搜尋 + 樹 + [確定])。兩者的選取都是即時生效,[確定] 只負責關閉。
 * - 內部沿用 `OrgTreePicker` 與 `lib/base/org-tree.ts`(STRUCT-13)。底座用在人員條件
 *   (`AudiencePicker` 的所屬組織,資料範圍的套用對象,`managed`);專案的業務頁面(收銀點的分店、
 *   報表的分店多選等)用 `scope="visible"`。
 */
export const OrgTreeSelect = ({
  scope = "managed",
  label,
  value,
  onChange,
  isMultiSelect = false,
  maxCount,
  disabledReasons = EMPTY_REASONS,
  helperText,
  error,
  required,
  disabled,
  fullWidth,
  size,
}: OrgTreeSelectProps) => {
  const t = useTranslations("admin.orgTreeSelect");
  const { session } = useSession();
  // 兩支 hook 都呼叫(hooks 規則),只有選到的模式真的發請求
  const usesTenantTree = scope !== "managed";
  const managedTree = useOrgTreeQuery(session.client, undefined, {
    enabled: !usesTenantTree,
  });
  const tenantTree = useTenantOrgTreeQuery(session.client, undefined, {
    enabled: usesTenantTree,
  });
  const orgTree = usesTenantTree
    ? {
        data: tenantTree.data && {
          orgTree: tenantTreeToOrgNodes(
            tenantTree.data.tenantOrgTree,
            scope === "visible",
          ),
        },
        isPending: tenantTree.isPending,
        isLoading: tenantTree.isLoading,
        isError: tenantTree.isError,
      }
    : managedTree;
  const outOfScopeText =
    scope === "managed" ? t("outOfScope") : t("outOfVisibleScope");
  const isMobile = useBreakpointDown("sm");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const isOpen = anchorEl !== null;

  const nodes = useMemo(() => orgTree.data?.orgTree ?? [], [orgTree.data]);
  const orgs = useMemo(() => flattenOrgs(nodes), [nodes]);
  /** 範圍外的節點也要有原因可以滑過看;呼叫端給的原因優先 */
  const reasons = useMemo(
    () => ({
      ...Object.fromEntries(
        orgs
          .filter((org) => org.outOfScope)
          .map((org) => [org.id, outOfScopeText]),
      ),
      ...disabledReasons,
    }),
    [orgs, disabledReasons, outOfScopeText],
  );
  /**
   * 欄位上的已選組織。樹上找不到的 id(管理範圍外,api 根本不回)顯示成「不在你的管理範圍內」,
   * 仍可取消,數量與上限計數一致;`orgTree` 還在載入時先不顯示,免得每個都閃一下範圍外。
   */
  const selected = useMemo(
    (): TreeSelectFieldItem[] =>
      orgTree.isPending
        ? []
        : value.map((id) => {
            const org = orgs.find((item) => item.id === id);
            return org === undefined
              ? { id, name: outOfScopeText }
              : { id, name: org.name };
          }),
    [orgTree.isPending, orgs, value, outOfScopeText],
  );
  /** 停用的組織照常可選,只在樹上帶「已停用」標籤(同組織管理頁) */
  const labelSuffixOf = useCallback(
    (node: OrgNodeLike) =>
      node.enabled ? undefined : <Tag tone="error" label={t("disabledOrg")} />,
    [t],
  );

  const close = () => {
    setAnchorEl(null);
  };

  const panel = (
    <OrgTreeSelectPanel
      label={label}
      nodes={nodes}
      isLoading={orgTree.isLoading}
      isError={orgTree.isError}
      labelSuffixOf={labelSuffixOf}
      value={value}
      isMultiSelect={isMultiSelect}
      maxCount={maxCount}
      disabledReasons={reasons}
      onChange={onChange}
      onClose={close}
      maxHeight={isMobile ? undefined : PANEL_TREE_MAX_HEIGHT}
    />
  );

  return (
    <>
      <TreeSelectField
        label={label}
        selected={selected}
        isMultiSelect={isMultiSelect}
        isOpen={isOpen}
        helperText={helperText}
        error={error}
        required={required}
        disabled={disabled}
        fullWidth={fullWidth}
        size={size}
        onOpen={setAnchorEl}
        onRemove={(id) => {
          onChange(value.filter((item) => item !== id));
        }}
      />
      <TreeSelectPopup
        label={label}
        anchorEl={anchorEl}
        isMobile={isMobile}
        confirmLabel={t("confirm")}
        onClose={close}
      >
        {panel}
      </TreeSelectPopup>
    </>
  );
};
