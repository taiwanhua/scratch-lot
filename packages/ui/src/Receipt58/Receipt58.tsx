"use client";

import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode, Ref } from "react";

import { mergeSx } from "../theme/sx";
import {
  RECEIPT58_DOTS,
  RECEIPT58_GAP,
  RECEIPT58_INK,
  RECEIPT58_PADDING_X,
  RECEIPT58_PADDING_Y,
  dots,
} from "./receipt58-tokens";

export interface Receipt58Props {
  /** 由版面零件組成的內容(`Receipt58Header`、`Receipt58Row`…);各單據由使用的模組自己組。 */
  children: ReactNode;
  /** 交給 `renderReceiptToPng` 轉圖片時取節點用。 */
  ref?: Ref<HTMLDivElement>;
  /** 只能疊加外觀(例:預覽時加陰影);寬度與邊界是列印幾何,不要覆蓋(STYLE-10)。 */
  sx?: SxProps<Theme>;
}

/**
 * 58mm 單據的紙張:固定寬 384 點、白底黑字,與裝置尺寸及深色模式無關。
 * 螢幕預覽與列印用同一個元件 —— 先渲染預覽,再把同一個節點交給 `renderReceiptToPng`。
 * Figma `Draft/Receipt58` 只是用零件組成的示範,不是固定版面。
 */
export const Receipt58 = ({ children, ref, sx }: Receipt58Props) => (
  <Box
    ref={ref}
    data-receipt58=""
    sx={mergeSx(
      {
        boxSizing: "border-box",
        width: dots(RECEIPT58_DOTS),
        minWidth: dots(RECEIPT58_DOTS),
        maxWidth: dots(RECEIPT58_DOTS),
        px: dots(RECEIPT58_PADDING_X),
        py: dots(RECEIPT58_PADDING_Y),
        display: "flex",
        flexDirection: "column",
        gap: dots(RECEIPT58_GAP),
        bgcolor: "common.white",
        color: RECEIPT58_INK,
        fontFamily: "fontFamily",
      },
      sx,
    )}
  >
    {children}
  </Box>
);
