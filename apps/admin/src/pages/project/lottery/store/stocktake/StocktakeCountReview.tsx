import { useState } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText } from "../store-text";
import { type GroupCount, emptyGroupCount } from "./stocktake-count-model";
import {
  type ReviewCountLine,
  type SheetCashPoint,
  groupKeyOf,
} from "./stocktake-model";

export interface StocktakeCountReviewProps {
  lines: readonly ReviewCountLine[];
  groups: Partial<Record<string, GroupCount>>;
  cashPoints: readonly SheetCashPoint[];
  storeName: string;
  /** 有 `store.sell` 才有 [算售出] */
  canBackfill: boolean;
  isBackfilling: boolean;
  /** [算售出 N 張](立即生效);`investigate` = 剩下的記成待查(拆開時) */
  onCountSale: (
    line: ReviewCountLine,
    count: number,
    investigate: number,
  ) => void;
  /** [待查] 幾張 / [標記異常] */
  onChoose: (
    key: string,
    choice: Partial<Pick<GroupCount, "investigateCount" | "flagged">>,
  ) => void;
  onRecount: (line: ReviewCountLine) => void;
}

/** 差異核對一組的一列(表格)。 */
interface Row {
  key: string;
  line: ReviewCountLine;
}

/**
 * 張數盤點的差異核對(張數店規格 8.2;Figma CS-09c):每一組一張卡片 —— 少 N 張:[算售出](立即生效,照挑張順序
 * 記已售·未對號,算那個收銀點開著的班;已結帳 → 事後更正)、[待查](核准時挑張),或拆開(例:算售出 1、待查 1);
 * 多出:[標記異常](只做記號,張的狀態不動)。開始數之後被別張盤點處理過的組要 [重數這組](8.5a B6)。
 */
export const StocktakeCountReview = ({
  lines,
  groups,
  cashPoints,
  storeName,
  canBackfill,
  isBackfilling,
  onCountSale,
  onChoose,
  onRecount,
}: StocktakeCountReviewProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.countReview");
  const temporal = useTemporalText();
  const [splitKey, setSplitKey] = useState<string | null>(null);
  const [splitSale, setSplitSale] = useState("");
  const pointOf = (id: string) => cashPoints.find((point) => point.id === id);
  const groupOf = (line: ReviewCountLine): GroupCount =>
    groups[groupKeyOf(line.cashPointId, line.gameId)] ?? emptyGroupCount("");
  const timeOf = (iso: string) =>
    temporal(iso, "monthDayTime").split(" ").at(-1) ?? "";

  /** 卡片標題旁:單價 · 那個收銀點開著的班 / 已結帳。 */
  const shiftNoteOf = (line: ReviewCountLine): string => {
    const point = pointOf(line.cashPointId);
    if (point?.shift != null) {
      return t("shiftOpen", {
        cashPoint: line.cashPointName,
        name: point.shift.ownerName,
        time: timeOf(point.shift.openedAt),
      });
    }
    return point?.lastShift == null
      ? t("noShift")
      : t("shiftClosed", { time: timeOf(point.lastShift.openedAt) });
  };

  const resultOf = (line: ReviewCountLine): string => {
    const group = groupOf(line);
    if (line.kind === "match") {
      return t("result.match");
    }
    if (line.kind === "over") {
      return group.flagged ? t("result.flag") : t("result.none");
    }
    const parts: string[] = [];
    if (group.saleCount > 0) {
      const amount = `+${moneyText(group.saleCount * line.unitPrice)}`;
      const point = pointOf(line.cashPointId);
      parts.push(
        point?.shift == null
          ? t("result.saleClosed", {
              count: group.saleCount,
              cashPoint: line.cashPointName,
              time:
                point?.lastShift == null
                  ? ""
                  : timeOf(point.lastShift.openedAt),
              amount,
            })
          : t("result.saleOpen", {
              count: group.saleCount,
              cashPoint: line.cashPointName,
              amount,
            }),
      );
    }
    if (group.investigateCount > 0) {
      parts.push(
        t("result.investigate", {
          count: group.investigateCount,
          store: storeName,
        }),
      );
    }
    return parts.length === 0 ? t("result.none") : parts.join(";");
  };

  const actionsOf = (row: Row) => {
    const { line } = row;
    const group = groupOf(line);
    if (line.stale) {
      return null;
    }
    if (line.kind === "over") {
      return (
        <Button
          size="small"
          variant={group.flagged ? "contained" : "outlined"}
          onClick={() => {
            onChoose(row.key, { flagged: !group.flagged });
          }}
        >
          {t("actions.flag")}
        </Button>
      );
    }
    if (line.kind !== "short") {
      return null;
    }
    const remaining = line.diffCount - group.saleCount;
    const allSold = remaining === 0;
    const allInvestigated =
      remaining > 0 && group.investigateCount === remaining;
    return (
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          {canBackfill ? (
            <Button
              size="small"
              variant={allSold ? "contained" : "outlined"}
              disabled={allSold || isBackfilling}
              onClick={() => {
                onCountSale(line, remaining, 0);
              }}
            >
              {t("actions.sale")}
            </Button>
          ) : null}
          <Button
            size="small"
            variant={allInvestigated ? "contained" : "outlined"}
            disabled={remaining === 0}
            onClick={() => {
              onChoose(row.key, { investigateCount: remaining });
            }}
          >
            {t("actions.investigate")}
          </Button>
          {canBackfill && remaining > 1 ? (
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setSplitKey(row.key);
                setSplitSale("");
              }}
            >
              {t("actions.split")}
            </Button>
          ) : null}
        </Stack>
        {splitKey === row.key ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <TextField
              size="small"
              label={t("splitSale", { max: remaining - 1 })}
              value={splitSale}
              onChange={(event) => {
                setSplitSale(event.target.value);
              }}
              slotProps={{ htmlInput: { inputMode: "numeric" } }}
              sx={{ width: 160 }}
            />
            <Button
              size="small"
              variant="contained"
              disabled={
                !/^\d+$/.test(splitSale) ||
                Number(splitSale) < 1 ||
                Number(splitSale) >= remaining ||
                isBackfilling
              }
              onClick={() => {
                const sale = Number(splitSale);
                onCountSale(line, sale, remaining - sale);
                setSplitKey(null);
              }}
            >
              {t("splitApply")}
            </Button>
          </Stack>
        ) : null}
      </Stack>
    );
  };

  const kindText = (line: ReviewCountLine): string => {
    if (line.kind === "short") {
      return t("kind.short", { count: line.diffCount });
    }
    return line.kind === "over"
      ? t("kind.over", { count: line.diffCount })
      : t("kind.match");
  };
  const columns: TableColumn<Row>[] = [
    {
      key: "kind",
      header: t("columns.kind"),
      render: (row) => kindText(row.line),
    },
    {
      key: "system",
      header: t("columns.system"),
      render: (row) => String(row.line.systemCount),
    },
    {
      key: "actual",
      header: t("columns.actual"),
      render: (row) => String(row.line.presentCount),
    },
    { key: "action", header: t("columns.action"), render: actionsOf },
    {
      key: "result",
      header: t("columns.result"),
      render: (row) => resultOf(row.line),
    },
  ];

  return (
    <Stack spacing={2}>
      {lines
        .filter((line) => line.kind !== "match" || line.stale)
        .map((line) => {
          const key = groupKeyOf(line.cashPointId, line.gameId);
          return (
            <Card key={key} sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ alignItems: { sm: "baseline" } }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t("title", {
                      cashPoint: line.cashPointName,
                      game: `${line.gameCode} ${line.gameName}`,
                    })}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ flex: 1 }}
                  >
                    {`${moneyText(line.unitPrice)} · ${shiftNoteOf(line)}`}
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => {
                      onRecount(line);
                    }}
                  >
                    {t("recount")}
                  </Button>
                </Stack>
                {line.stale ? (
                  <Alert severity="warning">
                    {t("stale", {
                      game: `${line.gameCode} ${line.gameName}`,
                      cashPoint: line.cashPointName,
                    })}
                  </Alert>
                ) : (
                  <Table
                    columns={columns}
                    rows={[{ key, line }]}
                    getRowKey={(row) => row.key}
                    size="small"
                    minWidth={720}
                    containerSx={{ height: "auto" }}
                  />
                )}
                {line.kind === "over" && !line.stale ? (
                  <Typography variant="caption" color="textSecondary">
                    {t("overHint")}
                  </Typography>
                ) : null}
              </Stack>
            </Card>
          );
        })}
    </Stack>
  );
};
