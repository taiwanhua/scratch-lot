import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronDoubleLeftIcon, ChevronDoubleRightIcon } from "@repo/ui/icons";

export interface SideNavToggleProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

/**
 * 側欄底部的收合開關(Figma `Draft/AdminSideNavCollapsed` 246:97)。
 * 同一顆按鈕兩種對齊:**展開態靠右、雙左箭頭**(Figma `Draft/AdminSideNav` 30:52 底部),
 * **收合態置中、雙右箭頭**。
 *
 * 圖示由 `@repo/ui/icons` 的 `ChevronDoubleLeft/Right` 供給(在此之前是文字字符
 * 「«」「»」),外框與 40×40 由 `IconButton` 的 `variant="outlined"` 供給 ——
 * 這兩件事一起讓 STYLE-10 記錄在案的那一處例外(呼叫端用 `sx` 畫幾何)退場。
 */
export const SideNavToggle = ({
  isCollapsed,
  onToggle,
}: SideNavToggleProps) => {
  const t = useTranslations("admin.shell");

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: isCollapsed ? "center" : "flex-end",
        pt: 1,
      }}
    >
      <IconButton
        variant="outlined"
        aria-label={t(isCollapsed ? "expandNav" : "collapseNav")}
        onClick={onToggle}
      >
        {isCollapsed ? (
          <ChevronDoubleRightIcon fontSize="small" />
        ) : (
          <ChevronDoubleLeftIcon fontSize="small" />
        )}
      </IconButton>
    </Box>
  );
};
