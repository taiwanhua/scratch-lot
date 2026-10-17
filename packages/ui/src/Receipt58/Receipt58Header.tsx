"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import {
  Receipt58ReprintMark,
  type Receipt58ReprintMarkProps,
} from "./Receipt58ReprintMark";
import { dots, receiptTextSx } from "./receipt58-tokens";

export interface Receipt58HeaderProps {
  /** 租戶名稱(最上層組織名稱);不印平台名稱 —— 由使用處傳入。 */
  tenantName: ReactNode;
  /** 單據名稱(例:收據、測試頁)。 */
  title: ReactNode;
  /** 單號(左下);測試頁放印表機名稱與 IP。 */
  documentNo?: ReactNode;
  /** 時間(右下):使用處依租戶時區格式化後傳入。 */
  time?: ReactNode;
  /** 補印時傳入,印在單據名稱下方;第一次列印不傳。 */
  reprint?: Receipt58ReprintMarkProps;
}

/** 表頭(Figma `Draft/Receipt58Header` 80:1491):租戶名稱、單據名稱、補印標示、單號與時間。 */
export const Receipt58Header = ({
  tenantName,
  title,
  documentNo,
  time,
  reprint,
}: Receipt58HeaderProps) => (
  <Box
    component="header"
    sx={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: dots(4),
    }}
  >
    <Box
      component="p"
      sx={{ ...receiptTextSx("title", true), textAlign: "center" }}
    >
      {tenantName}
    </Box>
    <Box
      component="p"
      sx={{ ...receiptTextSx("normal", true), textAlign: "center" }}
    >
      {title}
    </Box>
    {reprint === undefined ? null : <Receipt58ReprintMark {...reprint} />}
    {documentNo === undefined && time === undefined ? null : (
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: dots(8),
          alignSelf: "stretch",
        }}
      >
        <Box
          component="span"
          sx={{ ...receiptTextSx("normal"), flex: 1, minWidth: 0 }}
        >
          {documentNo}
        </Box>
        <Box
          component="span"
          sx={{ ...receiptTextSx("normal"), flexShrink: 0, textAlign: "right" }}
        >
          {time}
        </Box>
      </Box>
    )}
  </Box>
);
