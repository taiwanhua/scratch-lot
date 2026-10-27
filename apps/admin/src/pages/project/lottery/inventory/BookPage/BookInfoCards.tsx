import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { formatTicketRanges } from "@repo/domain/project/lottery";
import type { LotteryInventoryBookDetailFieldsFragment } from "@repo/graphql";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText, placeText } from "../inventory-config";

/** 一張小卡:標題 + 「名稱 …… 值」的列。 */
const InfoCard = ({
  title,
  lines,
}: {
  title: string;
  lines: readonly { key: string; label: string; value: ReactNode }[];
}) => (
  <Card sx={{ p: 2, flex: 1, minWidth: 0 }}>
    <Typography variant="subtitle2" color="textPrimary">
      {title}
    </Typography>
    <Stack spacing={0.75} sx={{ mt: 1 }}>
      {lines.map((line) => (
        <Stack
          key={line.key}
          direction="row"
          sx={{ justifyContent: "space-between", gap: 2 }}
        >
          <Typography variant="body2">{line.label}</Typography>
          <Typography variant="body2" color="textPrimary">
            {line.value}
          </Typography>
        </Stack>
      ))}
    </Stack>
  </Card>
);

/**
 * 本的詳情的三張小卡(Figma IN-03):來源(進貨單 / 調貨單、批購甲類)、所在(未售的張依分店與收銀點分組)、
 * 成本(要 `inventory.show-cost`;沒有時 api 不回、卡片不顯示)。
 */
export const BookInfoCards = ({
  detail,
}: {
  detail: LotteryInventoryBookDetailFieldsFragment;
}) => {
  const t = useTranslations("admin.lotteryInventory");
  const temporal = useTemporalText();
  const { book } = detail;
  const sourceLines = [
    ...detail.sources.map((source, index) => ({
      key: `source-${String(index)}`,
      label: t(`sources.${source.type}`),
      value: t("book.sourceValue", {
        serial: source.refSerialNo ?? t("stock.none"),
        date: temporal(source.at, "monthDay"),
      }),
    })),
    ...(book.purchaseDealer
      ? [
          {
            key: "dealer",
            label: t("book.dealer"),
            // 甲類沒有共用給讀者的分店時 api 回空名稱
            value: book.purchaseDealer.name || t("stock.hiddenName"),
          },
        ]
      : []),
  ];
  const locationLines = detail.locations.map((location, index) => ({
    key: `location-${String(index)}`,
    label: placeText(location.place, (kind) => t(`locations.${kind}`)),
    value: formatTicketRanges(location.ticketNos),
  }));
  return (
    <Stack direction={{ xs: "column", md: "row" }} sx={{ gap: 2 }}>
      <InfoCard title={t("book.sources")} lines={sourceLines} />
      {locationLines.length === 0 ? null : (
        <InfoCard title={t("book.locations")} lines={locationLines} />
      )}
      {detail.cost == null ? null : (
        <InfoCard
          title={t("book.cost")}
          lines={[
            {
              key: "rate",
              label: t("book.rate"),
              value: t("book.rateValue", { rate: detail.cost.rate }),
            },
            {
              key: "cost",
              label: t("book.costValueLabel"),
              value: `${moneyText(detail.cost.cost)} / ${moneyText(Math.round(detail.cost.unitCost))}`,
            },
          ]}
        />
      )}
    </Stack>
  );
};
