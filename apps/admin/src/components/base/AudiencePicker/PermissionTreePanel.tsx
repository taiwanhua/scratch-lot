import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Tree } from "@repo/ui/tree";
import { Typography } from "@repo/ui/typography";

import {
  type PermissionOptionModule,
  filterPermissionOptions,
  permissionModuleKeys,
  toPermissionTreeNodes,
} from "@/lib/base/permission-options";

/** 列尾的 key(同權限矩陣:12px、text.disabled);只影響呈現,不進無障礙名稱。 */
const keySuffix = (key: string) => (
  <Typography variant="caption" color="text.disabled">
    {key}
  </Typography>
);

export interface PermissionTreePanelProps {
  label: string;
  modules: readonly PermissionOptionModule[];
  isLoading: boolean;
  isError: boolean;
  value: readonly string[];
  onChange: (keys: string[]) => void;
  maxHeight?: number;
}

/** 打開後的內容:搜尋框 + 樹(浮動面板與手機全螢幕對話框共用)。 */
export const PermissionTreePanel = ({
  label,
  modules,
  isLoading,
  isError,
  value,
  onChange,
  maxHeight,
}: PermissionTreePanelProps) => {
  const t = useTranslations("admin.audiencePicker");
  const [keyword, setKeyword] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<readonly string[]>([]);

  const wildcard = t("permissionWildcard");
  const visible = useMemo(
    () => filterPermissionOptions(modules, keyword, wildcard),
    [modules, keyword, wildcard],
  );
  const items = useMemo(
    () => toPermissionTreeNodes(visible, wildcard, keySuffix),
    [visible, wildcard],
  );
  const moduleIds = useMemo(() => permissionModuleKeys(modules), [modules]);
  const visibleModuleIds = useMemo(
    () => permissionModuleKeys(visible),
    [visible],
  );

  /** 打開即聚焦搜尋框(同 `OrgTreeSelectPanel`;不用 `autoFocus`,jsx-a11y/no-autofocus) */
  const focusOnMount = useCallback((input: HTMLInputElement | null) => {
    input?.focus();
  }, []);

  /** 模組列不是值:Tree 回來的 id 只留權限 key,順序「依點選先後」(新點的在最後) */
  const handleSelectedIdsChange = (ids: string[]) => {
    const keys = ids.filter((id) => !moduleIds.includes(id));
    onChange([
      ...value.filter((key) => keys.includes(key)),
      ...keys.filter((key) => !value.includes(key)),
    ]);
  };

  return (
    <Stack spacing={1.5} sx={{ minWidth: 320 }}>
      <TextField
        label={t("permissionSearch")}
        size="small"
        fullWidth
        inputRef={focusOnMount}
        value={keyword}
        onChange={(event) => {
          setKeyword(event.target.value);
        }}
      />
      {isError && <Alert severity="error">{t("permissionLoadFailed")}</Alert>}
      {!isError && !isLoading && items.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {t("permissionEmpty")}
        </Typography>
      )}
      {!isError && (isLoading || items.length > 0) && (
        <Tree
          items={items}
          isLoading={isLoading}
          checkboxSelection
          multiSelect
          childrenIndentation={24}
          selectedIds={value}
          disabledCheckIds={moduleIds}
          onSelectedIdsChange={handleSelectedIdsChange}
          expandedIds={visibleModuleIds.filter(
            (id) => !collapsedIds.includes(id),
          )}
          onExpandedIdsChange={(ids) => {
            setCollapsedIds(visibleModuleIds.filter((id) => !ids.includes(id)));
          }}
          sx={
            maxHeight === undefined
              ? undefined
              : { maxHeight, overflow: "auto" }
          }
          aria-label={label}
        />
      )}
    </Stack>
  );
};
