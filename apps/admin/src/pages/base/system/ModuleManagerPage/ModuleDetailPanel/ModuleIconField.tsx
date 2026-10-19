import { createElement } from "react";
import { useTranslations } from "use-intl";

import {
  type ModuleIconKey,
  isModuleIconKey,
  moduleIconLabelOf,
  moduleIconOf,
} from "@repo/ui/icons";
import { ModuleIconPicker } from "@repo/ui/module-icon-picker";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { ModuleDetailRow } from "./ModuleDetailRow";

/** 選擇器寬度:29 個短詞最長四個字,240 夠且不會佔滿整個右欄。 */
const PICKER_WIDTH = 240;

export interface ModuleIconFieldProps {
  /** 目前的圖示 key(`null` / 認不得的值都畫預設圖示) */
  icon?: string | null;
  /** 依 `system.module-manager.set-icon`:沒有這筆權限時只顯示目前圖示,不給選擇器 */
  canSetIcon: boolean;
  isPending: boolean;
  onChange: (icon: ModuleIconKey) => void;
}

/**
 * 右面板的「圖示」欄位(正本 `docs/modules/module-manager.md`「側欄圖示」)。
 *
 * 可改時用 `@repo/ui/module-icon-picker`,選了就送出 —— 值域由 ui 的白名單登錄表決定,
 * 這一頁不認得任何圖示。29 個短詞的中英文在 `admin.moduleIcons.*`;
 * 訊息檔還沒補上的 key 退回登錄表的預設短詞(`labelOf` 回 `undefined` 即退回),
 * 所以之後登錄表加圖示不會讓這一頁在執行期炸掉。
 */
export const ModuleIconField = ({
  icon,
  canSetIcon,
  isPending,
  onChange,
}: ModuleIconFieldProps) => {
  const t = useTranslations("admin.moduleManager.detail");
  const tIcons = useTranslations("admin.moduleIcons");
  const labelOf = (key: ModuleIconKey) =>
    tIcons.has(key) ? tIcons(key) : undefined;

  if (!canSetIcon) {
    return (
      <ModuleDetailRow label={t("icon")}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {/* `react-hooks/static-components` 不准在 render 內把元件存進變數 */}
          {createElement(moduleIconOf(icon), { fontSize: "small" })}
          <Typography variant="body2">
            {isModuleIconKey(icon)
              ? (labelOf(icon) ?? moduleIconLabelOf(icon))
              : t("iconEmpty")}
          </Typography>
        </Stack>
      </ModuleDetailRow>
    );
  }

  return (
    /* 選擇器自帶浮動標籤,所以不走 `ModuleDetailRow`(左欄標籤會與它重複);
       上方分隔線與內距沿用同一組值,列的節奏不變 */
    <Stack sx={{ py: 1, borderTop: 1, borderColor: "divider" }}>
      <ModuleIconPicker
        value={icon ?? null}
        onChange={onChange}
        label={t("icon")}
        /* MUI 的 Select 把 `aria-labelledby` 指到「標籤 + 目前顯示的值」兩個節點,
           所以不給 `aria-label` 時這顆 combobox 的名稱會變成「圖示 使用者」 ——
           會跟著選到的圖示變。明給一份穩定的名稱 */
        aria-label={t("icon")}
        emptyLabel={t("iconEmpty")}
        labelOf={labelOf}
        disabled={isPending}
        size="small"
        sx={{ width: PICKER_WIDTH }}
      />
    </Stack>
  );
};
