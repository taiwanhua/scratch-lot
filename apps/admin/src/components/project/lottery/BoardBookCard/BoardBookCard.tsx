import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

export interface BoardBookCardProps {
  /** 標題(例「5164 發大財」) */
  title: string;
  /** 面額(例「200 元」) */
  priceText: string;
  /** 第二行(例「本號 056527 · 今日售出 12」) */
  metaText: string;
  /** 剩餘那一行(例「剩 35 / 100」) */
  remainingText: string;
  remaining: number;
  total: number;
  /** 剩很少的提示字;不需要提示 = null */
  lowStockLabel: string | null;
  /** 左側色條(遊戲設定的顏色;沒設 = 灰) */
  stripeColor: string;
  /** 點卡片(展開由之後的功能接上;不給 = 不能點) */
  onClick?: () => void;
  /** 展開中(主色框;規格 6.2) */
  expanded?: boolean;
}

/**
 * 看板卡片 = 某本 × 某收銀點的檯面(專案規格 6.2;Figma `Draft/BoardBookCard` 64:558):左側色條用遊戲顏色、
 * 遊戲與面額、本號與今日售出、剩餘進度條與「剩 N / 總數」、剩很少的提示。文字一律由使用處傳入。
 */
export const BoardBookCard = ({
  title,
  priceText,
  metaText,
  remainingText,
  remaining,
  total,
  lowStockLabel,
  stripeColor,
  onClick,
  expanded = false,
}: BoardBookCardProps) => {
  const ratio = total > 0 ? Math.min(1, remaining / total) : 0;
  return (
    <Card
      variant="outlined"
      component={onClick === undefined ? "div" : "button"}
      onClick={onClick}
      aria-expanded={onClick === undefined ? undefined : expanded}
      sx={{
        position: "relative",
        ...(expanded && { borderColor: "primary.main", borderWidth: 2 }),
        p: 2,
        pl: 2.5,
        textAlign: "left",
        width: "100%",
        cursor: onClick === undefined ? "default" : "pointer",
        font: "inherit",
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          bgcolor: stripeColor,
        },
      }}
    >
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 1 }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
          {title}
        </Typography>
        <Typography variant="body2" color="textSecondary" noWrap>
          {priceText}
        </Typography>
      </Stack>
      <Typography variant="body2" color="textSecondary" noWrap>
        {metaText}
      </Typography>
      <Box
        role="presentation"
        sx={{
          mt: 1,
          height: 6,
          borderRadius: 3,
          bgcolor: "grey.200",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            height: "100%",
            width: `${String(Math.round(ratio * 100))}%`,
            bgcolor: lowStockLabel === null ? "primary.main" : "error.main",
          }}
        />
      </Box>
      <Stack
        direction="row"
        sx={{ mt: 1, justifyContent: "space-between", alignItems: "center" }}
      >
        <Typography variant="body1">{remainingText}</Typography>
        {lowStockLabel === null ? null : (
          <Tag tone="error" label={lowStockLabel} />
        )}
      </Stack>
    </Card>
  );
};
