import { createElement } from "react";
import { Link } from "react-router";

import { Badge } from "@repo/ui/badge";
import { moduleIconOf } from "@repo/ui/icons";
import { ListItemButton } from "@repo/ui/list";
import { Tooltip } from "@repo/ui/tooltip";

import { useNavLinkHref } from "../useNavLinkHref";
import { railItemSx } from "./nav-rail-styles";

export interface NavRailLinkItemProps {
  to: string;
  label: string;
  /** `me.modules[].icon`(白名單 key);認不得或沒設定時 `moduleIconOf` 退回預設圖示 */
  icon?: string | null;
  isSelected: boolean;
  /** 待辦數;收合態放不下數字,大於 0 時在圖示右上畫小圓點 */
  badge?: number;
}

/**
 * 收合態的模組列(Figma `Draft/NavRailItem` 246:63 的 Default / Selected):只畫圖示,名稱靠 Tooltip。
 *
 * 這裡是 REACT-10 講的那個例外 —— 元素**沒有任何可見文字**,提示就是它的名字,
 * 所以明示 `describeChild={false}`(掛 `aria-label`);用預設的 `aria-describedby` 會讓
 * 輔助科技只讀得到「連結」。
 */
export const NavRailLinkItem = ({
  to,
  label,
  icon,
  isSelected,
  badge,
}: NavRailLinkItemProps) => {
  const href = useNavLinkHref(to);
  return (
    <Tooltip title={label} placement="right" describeChild={false}>
      <ListItemButton<typeof Link>
        component={Link}
        to={href}
        selected={isSelected}
        aria-current={isSelected ? "page" : undefined}
        sx={railItemSx}
      >
        {/* `react-hooks/static-components` 不准在 render 內把元件存進變數(每次 render 都是新身分),
          所以用 `createElement` 直接畫 —— 圖示是資料選出來的,無法寫成模組層常數 */}
        <Badge
          variant="dot"
          color="primary"
          invisible={badge === undefined || badge <= 0}
        >
          {createElement(moduleIconOf(icon), { fontSize: "small" })}
        </Badge>
      </ListItemButton>
    </Tooltip>
  );
};
