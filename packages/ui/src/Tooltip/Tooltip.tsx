"use client";

import MuiTooltip, {
  type TooltipProps as MuiTooltipProps,
} from "@mui/material/Tooltip";
import type { ReactElement, ReactNode } from "react";

import { Box } from "../Box/Box";

export interface TooltipProps {
  /**
   * 提示內容。空字串 / `undefined` 表示這次不提示 —— 呼叫端常寫
   * `title={isLocked ? hint : ""}`,不必為了不提示而拆掉整個元素。
   */
  title?: ReactNode;
  /** 被提示的元素(一個);disabled 時由本元件包 `span` 才收得到 hover */
  children: ReactElement;
  /** 提示出現的方位;預設貼在上方 */
  placement?: NonNullable<MuiTooltipProps["placement"]>;
  /** 加上指向元素的小三角 */
  arrow?: boolean;
  /** 滑鼠移到提示本身時不保持開啟(預設保持,方便選取提示裡的文字) */
  disableInteractive?: boolean;
  /**
   * 提示與元素的無障礙關係。預設 `true` =「**補充說明**」(`aria-describedby`):
   * 元素本來就有名字(「停用」按鈕、`aria-label` 的圖示鈕),提示只是講為什麼不能按。
   * 改 `false` 才是「**就是它的名字**」(`aria-label`),用在完全沒有文字的元素上 ——
   * 那會**蓋掉元素原本的無障礙名稱**,所以不當預設。
   */
  describeChild?: boolean;
}

/**
 * 文字提示(hover / focus 時出現)。外觀走 theme 的 `MuiTooltip` 覆寫
 * (`src/theme/create-theme.ts`:grey.800 底、`shape.borderRadius`);
 * Figma 目前沒有 Tooltip 稿,幾何照 MUI 預設。
 *
 * **disabled 的元素收不到滑鼠事件**(瀏覽器行為,不是 MUI 的問題),
 * 所以提示要掛在外層的 `span` 上。這件事以前在每個呼叫端各包一次
 * `<Box component="span" title={…}>`(OrgActionBar、模組與權限頁、HelpButton),
 * 現在收進這裡:child 帶 `disabled` 時自動包,沒帶就直接掛在 child 上
 * —— 可用的元素維持 `aria-describedby` 指到它自己,無障礙關聯不會被那層 span 拆掉。
 */
export const Tooltip = ({
  title,
  children,
  placement = "top",
  arrow,
  disableInteractive,
  describeChild = true,
}: TooltipProps) => {
  const isDisabled =
    (children.props as { disabled?: boolean } | null)?.disabled === true;

  return (
    <MuiTooltip
      title={title ?? ""}
      placement={placement}
      arrow={arrow}
      disableInteractive={disableInteractive}
      describeChild={describeChild}
    >
      {isDisabled ? (
        // inline-flex:span 只是事件的載體,不該改變原本的行內排版
        <Box component="span" sx={{ display: "inline-flex" }}>
          {children}
        </Box>
      ) : (
        children
      )}
    </MuiTooltip>
  );
};
