import { useTranslations } from "use-intl";

import type { LotteryStocktakeQuery } from "@repo/graphql";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../store-text";

type Detail = LotteryStocktakeQuery["lotteryStocktake"];
type CountLine = Detail["countLines"][number];

export interface StocktakeCountLinesCardProps {
  detail: Pick<Detail, "countLines" | "uncountedGroups">;
}

/**
 * 檢視頁的張數盤點(張數店規格 8.1、8.2、13.1):每一組的系統 / 實際(含 [重數] 前的每次輸入,例「第一次數 11、改成 12」,
 * 店長看得到)、算售出 / 待查 / 標記異常;送出時還沒數的組。編號盤點沒有組 → 不顯示。
 */
export const StocktakeCountLinesCard = ({
  detail,
}: StocktakeCountLinesCardProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.view.count");
  if (detail.countLines.length === 0 && detail.uncountedGroups.length === 0) {
    return null;
  }
  const presentText = (line: CountLine): string => {
    if (line.recounts.length === 0) {
      return String(line.presentCount);
    }
    const [first, ...rest] = [...line.recounts, line.presentCount];
    return t("recounted", { first, rest: rest.join("、") });
  };
  const handledText = (line: CountLine): string => {
    const parts: string[] = [];
    if (line.saleCount > 0) {
      parts.push(
        t("sale", {
          count: line.saleCount,
          amount: moneyText(line.saleAmount),
        }),
      );
    }
    if (line.investigateCount > 0) {
      parts.push(t("investigate", { count: line.investigateCount }));
    }
    if (line.flaggedCount > 0) {
      parts.push(t("flag", { count: line.flaggedCount }));
    }
    return parts.length === 0 ? t("none") : parts.join(";");
  };
  const columns: TableColumn<CountLine>[] = [
    {
      key: "group",
      header: t("columns.group"),
      render: (line) =>
        `${line.cashPointName} · ${line.gameCode} ${line.gameName}`,
    },
    {
      key: "system",
      header: t("columns.system"),
      render: (line) => String(line.systemCount),
    },
    { key: "present", header: t("columns.present"), render: presentText },
    { key: "handled", header: t("columns.handled"), render: handledText },
  ];
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2, flexShrink: 0 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">{t("title")}</Typography>
        <Table
          columns={columns}
          rows={detail.countLines}
          getRowKey={(line) => `${line.cashPointId}:${line.gameCode}`}
          size="small"
          minWidth={640}
          emptyMessage={t("empty")}
          containerSx={{ height: "auto" }}
        />
        {detail.uncountedGroups.map((group) => (
          <Typography
            key={`${group.cashPointId}:${group.gameCode}`}
            variant="body2"
            sx={{ color: "warning.dark" }}
          >
            {t("uncounted", {
              group: `${group.cashPointName} · ${group.gameCode} ${group.gameName}`,
            })}
          </Typography>
        ))}
      </Stack>
    </Card>
  );
};
