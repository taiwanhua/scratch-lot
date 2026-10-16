import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { OrgTreePicker } from "@/components/base/OrgTreePicker/OrgTreePicker";
import {
  type OrgNodeLike,
  allOrgIds,
  filterOrgTree,
} from "@/lib/base/org-tree";

export interface OrgTreeSelectPanelProps {
  /** 面板 / 對話框的無障礙名稱(= 欄位標籤) */
  label: string;
  nodes: readonly OrgNodeLike[];
  isLoading: boolean;
  value: readonly string[];
  isMultiSelect: boolean;
  maxCount?: number;
  disabledReasons: Readonly<Partial<Record<string, string>>>;
  onChange: (ids: string[]) => void;
  /** 單選選定後關閉面板 */
  onClose: () => void;
  /** 樹的捲動上限;手機全螢幕對話框不設(由對話框捲動) */
  maxHeight?: number;
}

/**
 * `OrgTreeSelect` 打開後的內容:搜尋框 + 組織樹 + 底部的數量提示(浮動面板與手機全螢幕對話框共用)。
 * 搜尋關鍵字只活在這一輪打開期間 —— 面板關閉即卸載(REACT-08),重開是空的。
 */
export const OrgTreeSelectPanel = ({
  label,
  nodes,
  isLoading,
  value,
  isMultiSelect,
  maxCount,
  disabledReasons,
  onChange,
  onClose,
  maxHeight,
}: OrgTreeSelectPanelProps) => {
  const t = useTranslations("admin.orgTreeSelect");
  const [keyword, setKeyword] = useState("");

  const isAtLimit =
    isMultiSelect && maxCount !== undefined && value.length >= maxCount;
  /** 到上限:其餘未勾的節點勾選框停用(已勾的照常可取消) */
  const lockedIds = useMemo(
    () =>
      isAtLimit ? allOrgIds(nodes).filter((id) => !value.includes(id)) : [],
    [isAtLimit, nodes, value],
  );
  const hasMatch = useMemo(
    () => filterOrgTree(nodes, keyword).length > 0,
    [nodes, keyword],
  );

  /**
   * 打開即聚焦搜尋框(規格 10.2「點欄位 → 搜尋框取得焦點」)。用穩定的 callback ref 只在掛上時聚焦一次,
   * 不用 `autoFocus`(jsx-a11y/no-autofocus);之後重繪不會把焦點從樹上搶回來。
   */
  const focusOnMount = useCallback((input: HTMLInputElement | null) => {
    input?.focus();
  }, []);

  const handleSelectedIdsChange = (ids: string[]) => {
    if (!isMultiSelect) {
      const picked = ids.at(0);
      if (picked !== undefined) {
        onChange([picked]);
        onClose();
      }
      return;
    }
    // 鍵盤或連點繞過停用勾選框時,超過上限的新增一律不收
    const isAdding = ids.length > value.length;
    if (isAdding && maxCount !== undefined && ids.length > maxCount) {
      return;
    }
    // MUI 回傳的順序是新選的在前;改成「依點選先後」(新點的在最後),標籤順序才穩定(同 SelectField)
    onChange([
      ...value.filter((id) => ids.includes(id)),
      ...ids.filter((id) => !value.includes(id)),
    ]);
  };

  const emptyText = nodes.length === 0 ? t("empty") : t("noMatch");

  return (
    <Stack spacing={1.5}>
      <TextField
        label={t("search")}
        size="small"
        fullWidth
        inputRef={focusOnMount}
        value={keyword}
        onChange={(event) => {
          setKeyword(event.target.value);
        }}
      />
      {!isLoading && !hasMatch ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {emptyText}
        </Typography>
      ) : (
        <OrgTreePicker
          nodes={nodes}
          isLoading={isLoading}
          isMultiSelect={isMultiSelect}
          keyword={keyword}
          selectedIds={value}
          onSelectedIdsChange={handleSelectedIdsChange}
          lockedIds={lockedIds}
          disabledReasons={disabledReasons}
          maxHeight={maxHeight}
          aria-label={label}
        />
      )}
      {isMultiSelect && maxCount !== undefined && (
        <Typography variant="caption" color="text.secondary" role="status">
          {isAtLimit
            ? t("limitReached", { max: maxCount })
            : t("limitCount", { count: value.length, max: maxCount })}
        </Typography>
      )}
    </Stack>
  );
};
