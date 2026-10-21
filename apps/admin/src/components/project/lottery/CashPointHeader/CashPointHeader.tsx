import type { ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

/** 標題列的一顆按鈕(依狀態與權限由使用處組好,沒有權限就不放進來)。 */
export interface CashPointHeaderAction {
  /** 同一列唯一(React key;測試以按鈕文字找) */
  key: string;
  label: string;
  onClick: () => void;
  /** `primary` = 主要動作(實心,例 [交班結帳] [開班]);`link` = 文字按鈕(例 [最近售出]);預設外框 */
  emphasis?: "primary" | "link";
  disabled?: boolean;
}

/** 標題列右側的一個數字(例「本班已售 42 張 / 8,400」「應有現金 12,350」)。 */
export interface CashPointHeaderStat {
  key: string;
  label: string;
  value: string;
}

export interface CashPointHeaderProps {
  name: string;
  /** 「本機」標籤的字;不是本機收銀點 = null(不顯示) */
  localLabel: string | null;
  /** 狀態標籤(開班中 / 未開班)的字與是否開班中(開班中綠、未開班灰) */
  statusLabel: string;
  isOpen: boolean;
  /** 名稱下方那一行(負責人 · 開班時間;未開班時上一班的資訊);沒有 = null */
  detail: ReactNode;
  /** 點負責人那一行(班次資訊);不給 = 不能點 */
  onDetailClick?: () => void;
  /** 負責人那一行的無障礙名稱(可以點時) */
  detailActionLabel?: string;
  stats: readonly CashPointHeaderStat[];
  /** 按鈕列(依序;同一收銀點的各功能各自追加,Spec #104 第 3 節第 9 批) */
  actions: readonly CashPointHeaderAction[];
}

/**
 * 收銀點標題列(專案規格 6.2;Figma `Draft/CashPointHeader` 64:512):名稱、本機 / 狀態標籤、負責人那一行、
 * 本班已售 / 應有現金、按鈕列。按鈕由使用處依狀態與權限組成 `actions`(之後的功能追加 [兌獎] [拆本]…),
 * 文字一律由使用處傳入;窄螢幕時數字與按鈕換到名稱下方、按鈕可換行。
 */
export const CashPointHeader = ({
  name,
  localLabel,
  statusLabel,
  isOpen,
  detail,
  onDetailClick,
  detailActionLabel,
  stats,
  actions,
}: CashPointHeaderProps) => (
  <Card
    variant="outlined"
    sx={{
      px: 2,
      py: 1.5,
      display: "flex",
      flexDirection: { xs: "column", md: "row" },
      alignItems: { xs: "stretch", md: "center" },
      gap: { xs: 1.5, md: 3 },
    }}
  >
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="h6" component="h3" noWrap>
          {name}
        </Typography>
        {localLabel === null ? null : <Tag tone="primary" label={localLabel} />}
        <Tag tone={isOpen ? "success" : "grey"} label={statusLabel} />
      </Stack>
      {detail === null ? null : (
        <Box
          component={onDetailClick === undefined ? "p" : "button"}
          aria-label={detailActionLabel}
          onClick={onDetailClick}
          sx={{
            display: "block",
            m: 0,
            p: 0,
            border: 0,
            background: "none",
            textAlign: "left",
            typography: "caption",
            color: "text.secondary",
            ...(onDetailClick === undefined
              ? {}
              : {
                  cursor: "pointer",
                  "&:hover": { textDecoration: "underline" },
                }),
          }}
        >
          {detail}
        </Box>
      )}
    </Box>
    {stats.length === 0 ? null : (
      <Stack direction="row" spacing={3}>
        {stats.map((stat) => (
          <Box key={stat.key}>
            <Typography variant="caption" color="text.secondary">
              {stat.label}
            </Typography>
            <Typography variant="h6" sx={{ whiteSpace: "nowrap" }}>
              {stat.value}
            </Typography>
          </Box>
        ))}
      </Stack>
    )}
    {actions.length === 0 ? null : (
      <Stack
        direction="row"
        sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}
      >
        {actions.map((action) => {
          let variant: "contained" | "outlined" | "text" = "outlined";
          if (action.emphasis === "primary") {
            variant = "contained";
          } else if (action.emphasis === "link") {
            variant = "text";
          }
          return (
            <Button
              key={action.key}
              size="small"
              variant={variant}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          );
        })}
      </Stack>
    )}
  </Card>
);
