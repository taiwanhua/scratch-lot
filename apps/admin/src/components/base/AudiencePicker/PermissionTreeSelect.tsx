import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Popover } from "@repo/ui/popover";

import { OrgTreeSelectField } from "@/components/base/OrgTreeSelect/OrgTreeSelectField";
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
 * 收合時是欄位 + 已選標籤(與 `OrgTreeSelect` 同一個欄位外觀),點開是「搜尋 + 模組 / 權限樹」。
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
    isOutOfScope: !labels.has(key),
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
        <OrgTreeSelectField
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
      {isOpen && isMobile && (
        <Dialog
          open
          fullScreen
          onClose={close}
          title={label}
          actions={<Button onClick={close}>{t("permissionConfirm")}</Button>}
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
