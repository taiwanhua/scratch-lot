import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { useBreakpointDown } from "@repo/ui/media-query";

import { TreeSelectField } from "@/components/base/TreeSelect/TreeSelectField";
import { TreeSelectPopup } from "@/components/base/TreeSelect/TreeSelectPopup";
import {
  type PermissionOptionModule,
  permissionLabels,
} from "@/lib/base/permission-options";

import { PermissionTreePanel } from "./PermissionTreePanel";

export interface PermissionTreeSelectProps {
  label: string;
  /** 受控的已選權限 key */
  value: readonly string[];
  onChange: (keys: string[]) => void;
  modules: readonly PermissionOptionModule[];
  isLoading: boolean;
  isError: boolean;
  error?: boolean;
  disabled?: boolean;
}

/** 樹的捲動上限(浮動面板);手機全螢幕對話框由對話框自己捲動 */
const PANEL_TREE_MAX_HEIGHT = 320;

/**
 * 人員條件「權限」的值(Figma `Draft/AudiencePicker` 的「示範模組 · 編輯」標籤):
 * 收合時是欄位 + 已選標籤(與 `OrgTreeSelect` 共用 `TreeSelectField` / `TreeSelectPopup`),點開是「搜尋 + 模組 / 權限樹」。
 * 樹沿用權限矩陣的顯示樹(`audiencePermissionOptions`);**只有權限列可勾**,模組列只是分組。
 * 搜尋關鍵字只活在這一輪打開期間 —— 面板關閉即卸載(REACT-08)。
 */
export const PermissionTreeSelect = ({
  label,
  value,
  onChange,
  modules,
  isLoading,
  isError,
  error,
  disabled,
}: PermissionTreeSelectProps) => {
  const t = useTranslations("admin.audiencePicker");
  const isMobile = useBreakpointDown("sm");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const isOpen = anchorEl !== null;

  const labels = useMemo(
    () => permissionLabels(modules, t("permissionWildcard")),
    [modules, t],
  );
  /** 樹上找不到的 key(已不在操作者持有的權限裡)照原字串顯示,仍可取消 */
  const selected = value.map((key) => ({
    id: key,
    name: labels.get(key) ?? key,
  }));

  const close = () => {
    setAnchorEl(null);
  };

  const panel = (
    <PermissionTreePanel
      label={label}
      modules={modules}
      isLoading={isLoading}
      isError={isError}
      value={value}
      onChange={onChange}
      maxHeight={isMobile ? undefined : PANEL_TREE_MAX_HEIGHT}
    />
  );

  return (
    <>
      <Box sx={{ width: 300 }}>
        <TreeSelectField
          label={label}
          selected={selected}
          isMultiSelect
          isOpen={isOpen}
          error={error}
          disabled={disabled}
          fullWidth
          size="small"
          onOpen={setAnchorEl}
          onRemove={(key) => {
            onChange(value.filter((item) => item !== key));
          }}
        />
      </Box>
      <TreeSelectPopup
        label={label}
        anchorEl={anchorEl}
        isMobile={isMobile}
        confirmLabel={t("permissionConfirm")}
        onClose={close}
      >
        {panel}
      </TreeSelectPopup>
    </>
  );
};
