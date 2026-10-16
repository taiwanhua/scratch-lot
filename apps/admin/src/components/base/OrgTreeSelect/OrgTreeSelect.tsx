import { type ReactNode, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { useOrgTreeQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Popover } from "@repo/ui/popover";

import { useSession } from "@/hooks/base/useSession";
import { type OrgOption, flattenOrgs } from "@/lib/base/org-tree";

import { OrgTreeSelectField } from "./OrgTreeSelectField";
import { OrgTreeSelectPanel } from "./OrgTreeSelectPanel";

export interface OrgTreeSelectProps {
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
 * 組織欄位(底座規格 10.2;Figma `Draft/OrgTreeSelect` 47:409):輸入框顯示已選組織,
 * 點開是「搜尋 + 組織樹」;單選 / 多選、多選可設上限。
 *
 * - **候選 = 操作者的管理範圍**:自己查 `orgTree`(api 只回管理範圍內的組織,#187),
 *   呼叫端不必、也不能另給一份清單。
 * - **停用有兩種來源**:範圍外(`outOfScope`,現況 api 不回、恆為 false,留著相容)與呼叫端的
 *   `disabledReasons`(例:專案的一對一對應把已占用的分店停用並註明「已由 王小明 對應」)。
 *   已選的組織之後變成停用時,欄位上的標籤仍在、可以取消,但在樹上勾不回來。
 * - **版面**:sm 以上是欄位下方的浮動面板(寬度跟著欄位);< sm 改開全螢幕對話框
 *   (標題 + 搜尋 + 樹 + [確定])。兩者的選取都是即時生效,[確定] 只負責關閉。
 * - 內部沿用 `OrgTreePicker` 與 `lib/base/org-tree.ts`(STRUCT-13);沒有頁面在底座使用,
 *   由專案頁面(報表的分店多選等)引用。
 */
export const OrgTreeSelect = ({
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
  const orgTree = useOrgTreeQuery(session.client);
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
          .map((org) => [org.id, t("outOfScope")]),
      ),
      ...disabledReasons,
    }),
    [orgs, disabledReasons, t],
  );
  const selected = useMemo(
    () =>
      value.flatMap((id): OrgOption[] => {
        const org = orgs.find((item) => item.id === id);
        return org === undefined ? [] : [org];
      }),
    [orgs, value],
  );

  const close = () => {
    setAnchorEl(null);
  };

  const panel = (
    <OrgTreeSelectPanel
      label={label}
      nodes={nodes}
      isLoading={orgTree.isLoading}
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
      <OrgTreeSelectField
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
      {isOpen && isMobile && (
        <Dialog
          open
          fullScreen
          onClose={close}
          title={label}
          actions={<Button onClick={close}>{t("confirm")}</Button>}
        >
          {panel}
        </Dialog>
      )}
      {isOpen && !isMobile && (
        <Popover
          open
          anchorEl={anchorEl}
          onClose={close}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          slotProps={{
            paper: {
              "aria-label": label,
              // 寬度跟著欄位(Figma:面板與欄位同寬);窄欄位時至少照內容撐開
              sx: { minWidth: anchorEl.offsetWidth, mt: 0.5 },
            },
          }}
        >
          <Box sx={{ px: 1, py: 1.5 }}>{panel}</Box>
        </Popover>
      )}
    </>
  );
};
