"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { dots, receiptTextSx } from "./receipt58-tokens";
import { moduleDots, qrModules } from "./symbol-modules";

export interface Receipt58QrProps {
  /** QR code 內容:這張單據在後台的連結(掃了直接打開)。 */
  value: string;
  /** QR code 下方的說明(例「掃描開啟單據」)。 */
  caption?: ReactNode;
  /** QR code 最大邊長(點);預設 160,實際取整數模組寬。 */
  size?: number;
}

const DEFAULT_SIZE = 160;
/** QR 規範要求的四個模組安靜區(白邊;紙張本身是白底,只留位置不畫)。 */
const QUIET_ZONE = 4;

/** 單據底部的 QR code(Figma `Draft/Receipt58QR` 80:1517)。 */
export const Receipt58Qr = ({
  value,
  caption,
  size = DEFAULT_SIZE,
}: Receipt58QrProps) => {
  const matrix = useMemo(() => qrModules(value), [value]);
  const count = matrix.length + QUIET_ZONE * 2;
  const unit = moduleDots(count, size);
  const side = count * unit;
  const cells = matrix
    .flatMap((row, y) =>
      row.map((isDark, x) =>
        isDark
          ? `M${String((x + QUIET_ZONE) * unit)} ${String((y + QUIET_ZONE) * unit)}h${String(unit)}v${String(unit)}h-${String(unit)}z`
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
