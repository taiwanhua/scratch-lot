"use client";

import MuiTab from "@mui/material/Tab";
import MuiTabs from "@mui/material/Tabs";
import type { SxProps, Theme } from "@mui/material/styles";
import { styled } from "@mui/material/styles";
import { type ReactNode, useRef } from "react";

import { mergeSx } from "../theme/sx";
import { useRevealSelectedTab } from "./useRevealSelectedTab";

/** 一個頁籤。`value` 是呼叫端自己的識別字串(不是索引),切換時原樣回報。 */
export interface TabItem {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  /** 給輔助科技的名稱;`label` 不是純文字時才需要 */
  "aria-label"?: string;
  /** 頁籤元素的 id;呼叫端自己畫內容區(`role="tabpanel"`)時,內容區以 `aria-labelledby` 指回它 */
  id?: string;
  /** 這個頁籤控制的內容區 id(`role="tabpanel"` 那一塊) */
  "aria-controls"?: string;
}

export interface TabsProps {
  /** 受控:目前選中的 `TabItem.value`;不在 `items` 裡時整列都不選中 */
  value: string;
  /** 切到另一個頁籤時回報;切不切得成由呼叫端決定(可能被「放棄未儲存變更」攔下) */
  onChange: (value: string) => void;
  items: readonly TabItem[];
  /** 整列頁籤的無障礙名稱(`role="tablist"` 上);ui 不內建文案(I18N-01) */
  "aria-label"?: string;
  /**
   * 放不下時單列橫向捲動(Figma BS-15b):還有頁籤的那一側顯示漸層淡出 + ‹ / › 按鈕(點了捲一段),
   * 捲到底的那一側兩者都消失;選中的頁籤(含首次渲染)自動捲進可視範圍。窄寬(手機)同一行為。
   * 預設關閉:既有的頁內分頁都只有兩三格,不需要捲動容器。
   */
  scrollable?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * Figma `Draft/Tabs` 252:14:頁籤列**下方一條 1px 分隔線**,選中的那格用主色底線
 * (底線本身是 MUI 的 indicator,`Draft/Tab` 69:655 的 Active 變體)。
 * 字重與 textTransform 已由 theme 的 `MuiTab` 覆寫供給(SemiBold、不轉大寫)。
 */
const StyledTabs = styled(MuiTabs)(({ theme }) => ({
  borderBottom: `1px solid ${theme.palette.divider}`,
  minHeight: "auto",
  "& .MuiTab-root": {
    minHeight: "auto",
    minWidth: "auto",
    paddingInline: theme.spacing(1),
    paddingBlock: theme.spacing(1.25),
  },
  "& .MuiTabs-indicator": { height: 2, borderRadius: 1 },
  // 捲動模式(`scrollable`)的漸層:MUI 在「那一側還有頁籤」時讓該側 ‹ / › 可用,捲到底時加 `Mui-disabled`
  // (scrollButtons="auto" 下整顆透明)。漸層掛在按鈕的 ::after、往捲動區那側伸出去疊在頁籤上,
  // 所以跟著按鈕一起出現 / 消失。顏色取紙面底色(頁籤列放在 Card 裡),深色模式跟著換。
  // 不用 `:has()` 去改捲動區本身:jsdom(nwsapi)解析不了相對選擇器,所有元件測試都會壞
  "& .MuiTabs-scrollButtons": { position: "relative", overflow: "visible" },
  "& .MuiTabs-scrollButtons::after": {
    content: '""',
    position: "absolute",
    top: 0,
    bottom: 0,
    width: theme.spacing(4),
    pointerEvents: "none",
    zIndex: 1,
  },
  "& .MuiTabs-scrollButtons:first-of-type::after": {
    left: "100%",
    background: `linear-gradient(to right, ${(theme.vars ?? theme).palette.background.paper}, transparent)`,
  },
  "& .MuiTabs-scrollButtons:last-of-type::after": {
    right: "100%",
    background: `linear-gradient(to left, ${(theme.vars ?? theme).palette.background.paper}, transparent)`,
  },
}));

/**
 * 頁內分頁(角色管理頁的「權限設定 / 分配使用者」)。
 *
 * **不是殼的 `RouteTabs`** —— 那一列是路由,這個只是同一頁裡的分區。
 * 受控:`value` / `onChange` 由呼叫端持有,切換可以被攔下(未儲存變更);本身不碰網址,
 * admin 要把目前分頁記在網址、依權限藏分頁時用 `components/base/PageTabs`(建在它上面)。
 */
export const Tabs = ({
  value,
  onChange,
  items,
  "aria-label": ariaLabel,
  scrollable = false,
  sx,
}: TabsProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealSelectedTab(rootRef, scrollable);

  return (
    <StyledTabs
      ref={rootRef}
      // 值不在清單裡(載入中、剛換掉資料)時傳 false,MUI 才不會在 console 警告
      value={items.some((item) => item.value === value) ? value : false}
      aria-label={ariaLabel}
      {...(scrollable && {
        variant: "scrollable",
        scrollButtons: "auto",
        // MUI 預設在手機寬藏按鈕;窄寬一樣要看得到 ‹ / ›(BS-15b 規則不分尺寸)
        allowScrollButtonsMobile: true,
      })}
      sx={mergeSx({}, sx)}
      onChange={(_event, next: string) => {
        onChange(next);
      }}
    >
      {items.map((item) => (
        <MuiTab
          key={item.value}
          value={item.value}
          label={item.label}
          disabled={item.disabled}
          aria-label={item["aria-label"]}
          id={item.id}
          aria-controls={item["aria-controls"]}
        />
      ))}
    </StyledTabs>
  );
};
