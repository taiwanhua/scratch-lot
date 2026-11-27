import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  TICKET_STATUS,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import type { LotteryInventoryBookDetailFieldsFragment } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText, placeText } from "../inventory-config";
import { useInventoryAccess } from "../useInventoryAccess";

type Source = LotteryInventoryBookDetailFieldsFragment["sources"][number];

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
 * 本的詳情的三張小卡(Figma IN-03、IN-03-5):來源(進貨單 / 調貨單、批購甲類;期初建檔的本寫建檔人與時間)、所在(未售的張依分店與收銀點分組)、
 * 成本(要 `inventory.show-cost`;沒有時 api 不回、卡片不顯示)。
 */
export const BookInfoCards = ({
  detail,
}: {
  detail: LotteryInventoryBookDetailFieldsFragment;
}) => {
  const t = useTranslations("admin.lotteryInventory");
  const temporal = useTemporalText();
  const navigate = useNavigate();
  const { wholesaleRoute } = useInventoryAccess();
  const { book } = detail;
  // 期初建檔的本:來源寫「期初建檔 · 建檔人 · 時間」,沒有批購甲類(期初建檔規格 5.3)
  const isOpening = book.source === "opening";
  const sourceText = (source: Source): string => {
    const serial = source.refSerialNo ?? t("stock.none");
    const date = source.at == null ? "" : temporal(source.at, "monthDay");
    switch (source.wholesaleState) {
      case "reviewing": {
        return t("book.wholesaleReviewing", { serial });
      }
      case "voided": {
        return t("book.wholesaleVoided", { serial });
      }
      case "shipped": {
        return source.customerName == null
          ? t("book.wholesaleShipped", { serial, date })
          : t("book.wholesaleShippedTo", {
              serial,
              date,
              customer: source.customerName,
            });
      }
      default: {
        return t("book.sourceValue", { serial, date });
      }
    }
  };
  // 批售單:綁了批售單檢視頁、而且看得到這張單(有單號)才是連結
  const sourceValue = (source: Source): ReactNode =>
    source.wholesaleState != null &&
    source.refId != null &&
    source.refSerialNo != null &&
    wholesaleRoute !== null ? (
      <Button
        variant="text"
        size="small"
        onClick={() => {
          void navigate(`${wholesaleRoute}/${source.refId ?? ""}`);
        }}
      >
        {sourceText(source)}
      </Button>
    ) : (
      sourceText(source)
    );
  const sourceLines = [
    ...(isOpening
      ? [
          {
            key: "opening",
            label: t("book.openingSource"),
            value: t("book.openingSourceValue", {
              name: book.openedBy?.name ?? "",
              time:
                book.openingAt == null
                  ? ""
                  : temporal(book.openingAt, "monthDayTime"),
            }),
          },
        ]
      : []),
    ...detail.sources.map((source, index) => ({
      key: `source-${String(index)}`,
      label: t(`sources.${source.type}`),
      value: sourceValue(source),
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
  // 已批售的張不在任何一家店:寫買方(看不到批售單 → 出貨分店;Figma IN-03-4a)
  const wholesaledNos = detail.tickets
    .filter((ticket) => ticket.status === TICKET_STATUS.wholesaled)
    .map((ticket) => ticket.ticketNo);
  if (wholesaledNos.length > 0) {
    locationLines.push({
      key: "location-wholesaled",
      label: t("book.wholesaledLocation", {
        customer: book.wholesaleCustomerName ?? book.org.name,
      }),
      value: formatTicketRanges(wholesaledNos),
    });
  }
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
              value: t(isOpening ? "book.rateValueOpening" : "book.rateValue", {
                rate: detail.cost.rate,
              }),
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
