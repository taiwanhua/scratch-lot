"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { useMemo } from "react";

import {
  RECEIPT58_CONTENT_WIDTH,
  RECEIPT58_QR_QUIET_ZONE,
  dots,
  receiptTextSx,
} from "./receipt58-tokens";
import { moduleDots, qrModules } from "./symbol-modules";

export interface Receipt58QrProps {
  /** QR code 內容:這張單據在後台的連結(掃了直接打開)。 */
  value: string;
  /** QR code 下方的說明(例「掃描開啟單據」)。 */
  caption?: ReactNode;
}

/**
 * 每個模組 6 點:58mm 收據機 203 dpi 下約 0.75mm,熱感暈開後白縫仍在,手機掃得到;
 * 內容太長、6 點放不進可用寬時才縮小(仍是整數點)。
 */
const MAX_MODULE_DOTS = 6;

/**
 * 單據底部的 QR code(Figma `Draft/Receipt58QR`):每模組整數點,含四個模組的安靜區(白邊)。
 * 轉 PNG 時 `renderReceiptToPng` 以 `data-receipt58-qr` 找到它,依同一個模組矩陣直接寫進 384 點點陣
 * (不經截圖縮放),所以螢幕縮放、截圖寬度都不會讓模組變得不均。
 */
export const Receipt58Qr = ({ value, caption }: Receipt58QrProps) => {
  const matrix = useMemo(() => qrModules(value), [value]);
  const count = matrix.length + RECEIPT58_QR_QUIET_ZONE * 2;
  const unit = Math.min(
    MAX_MODULE_DOTS,
    moduleDots(count, RECEIPT58_CONTENT_WIDTH),
  );
  const side = count * unit;
  const cells = matrix
    .flatMap((row, y) =>
      row.map((isDark, x) =>
        isDark
          ? `M${String((x + RECEIPT58_QR_QUIET_ZONE) * unit)} ${String((y + RECEIPT58_QR_QUIET_ZONE) * unit)}h${String(unit)}v${String(unit)}h-${String(unit)}z`
          : "",
      ),
    )
    .join("");
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
        width={side}
        height={side}
        viewBox={`0 0 ${String(side)} ${String(side)}`}
        shapeRendering="crispEdges"
        data-modules={matrix.length}
        data-receipt58-qr={value}
        data-module-dots={unit}
      >
        <path d={cells} fill="currentColor" />
      </svg>
      {caption === undefined ? null : (
        <Box
          component="p"
          sx={{ ...receiptTextSx("small"), textAlign: "center" }}
        >
          {caption}
        </Box>
      )}
    </Box>
  );
};
