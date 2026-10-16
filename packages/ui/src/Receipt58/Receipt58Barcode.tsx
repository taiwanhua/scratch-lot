"use client";

import Box from "@mui/material/Box";
import { useMemo } from "react";

import {
  RECEIPT58_CONTENT_WIDTH,
  dots,
  receiptTextSx,
} from "./receipt58-tokens";
import { code128Modules, moduleDots } from "./symbol-modules";

export interface Receipt58BarcodeProps {
  /** 條碼內容(Code128):**只接受 ASCII**(英數字與符號);含中文等非 ASCII 字元時拋出錯誤。 */
  value: string;
  /** 條碼高度(點);預設 64。 */
  height?: number;
}

/** 每個模組最寬 2 點:58mm 收據機 203 dpi 下約 0.25mm,掃描器讀得到;太長時自動縮到 1 點。 */
const MAX_MODULE_DOTS = 2;
const DEFAULT_HEIGHT = 64;

/**
 * 一維條碼(Code128;Figma `Draft/Receipt58Barcode` 286:77797):條紋 + 下方印內容。
 * 單據本身用 QR code;一維條碼給測試頁確認機器支援。
 */
export const Receipt58Barcode = ({
  value,
  height = DEFAULT_HEIGHT,
}: Receipt58BarcodeProps) => {
  const modules = useMemo(() => code128Modules(value), [value]);
  const unit = Math.min(
    MAX_MODULE_DOTS,
    moduleDots(modules.length, RECEIPT58_CONTENT_WIDTH),
  );
  const width = modules.length * unit;
  const bars = Array.from(modules, (bit, index) =>
    bit === "1"
      ? `M${String(index * unit)} 0h${String(unit)}v${String(height)}h-${String(unit)}z`
      : "",
  ).join("");
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: dots(4),
      }}
    >
      <svg
        role="img"
        aria-label={value}
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        shapeRendering="crispEdges"
        data-modules={modules.length}
      >
        <path d={bars} fill="currentColor" />
      </svg>
      <Box
        component="p"
        sx={{ ...receiptTextSx("small"), textAlign: "center" }}
      >
        {value}
      </Box>
    </Box>
  );
};
