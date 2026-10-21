import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  ACCOUNTS_MODULE_KEYS,
  ACCOUNTS_TABS,
} from "@repo/domain/project/lottery-accounts";
import type { LotteryCheckoutCashItemFieldsFragment } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Collapse } from "@repo/ui/collapse";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText } from "../store-text";
import { signedMoneyText } from "./checkout-text";

export type ExpectedCashItem = LotteryCheckoutCashItemFieldsFragment;
type ExpectedCashEntry = ExpectedCashItem["entries"][number];

export interface ExpectedCashListProps {
  items: readonly ExpectedCashItem[];
  expected: number;
  /** 點兌獎那一筆 → 兌獎紀錄詳情;不給 = 不能點 */
  onOpenRedemption?: (id: string) => void;
  /** 底部說明;不給 = 不顯示 */
  hint?: string | null;
  /** 某一項的標籤改寫(例:日結的小金庫期初「期初(10/13 日結清點)」);回 null / 不給 = 照項目名稱 */
  labelOf?: (item: ExpectedCashItem) => string | null;
  /** 合計那一列的標籤;不給 = 「應有現金」 */
  totalLabel?: string;
}

/** 一項裡的一筆紀錄(時間、單號 / 張編號、金額、[點開單據])。 */
const EntryRow = ({
  entry,
  onOpen,
}: {
  entry: ExpectedCashEntry;
  onOpen: (entry: ExpectedCashEntry) => void;
}) => {
  const t = useTranslations("admin.lotteryStore.checkout.drawer");
  const temporal = useTemporalText();
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Typography variant="caption" color="text.secondary">
        {temporal(entry.occurredAt, "monthDayTime")}
      </Typography>
      <Typography variant="body2" sx={{ flex: 1 }}>
        {entry.label}
      </Typography>
      <Typography variant="body2">{signedMoneyText(entry.amount)}</Typography>
      <Button
        variant="text"
        size="small"
        onClick={() => {
          onOpen(entry);
        }}
      >
        {t("openEntry")}
      </Button>
    </Stack>
  );
};

/** 一項(標籤 + 筆數 + 金額);有明細時可點開。 */
const ItemRow = ({
  item,
  customLabel,
  expanded,
  onToggle,
  onOpenEntry,
}: {
  item: ExpectedCashItem;
  customLabel: string | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenEntry: (entry: ExpectedCashEntry) => void;
}) => {
  const t = useTranslations("admin.lotteryStore.checkout");
  const label = customLabel ?? t(`items.${item.kind}`);
  const expandable = item.entries.length > 0;
  let countText = "";
  if (item.kind !== "opening" && item.count > 0) {
    countText =
      item.kind === "sales"
        ? t("itemCount.sales", { count: item.count })
        : t("itemCount.other", { count: item.count });
  }
  const interactive = expandable
    ? {
        role: "button",
        tabIndex: 0,
        "aria-label": t("drawer.toggleAria", { item: label }),
        "aria-expanded": expanded,
        onClick: () => {
          onToggle();
        },
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        },
      }
    : {};
  return (
    <Box>
      <Box
        {...interactive}
        sx={{
          display: "flex",
          alignItems: "baseline",
          gap: 1,
          py: 0.5,
          cursor: expandable ? "pointer" : "default",
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {label}
          {countText}
        </Typography>
        <Typography variant="body1">
          {item.kind === "opening"
            ? moneyText(item.amount)
            : signedMoneyText(item.amount)}
        </Typography>
      </Box>
      {expandable ? (
        <Collapse in={expanded}>
          <Stack spacing={0.5} sx={{ pl: 2, pb: 1 }}>
            {item.entries.map((entry) => (
              <EntryRow key={entry.refId} entry={entry} onOpen={onOpenEntry} />
            ))}
          </Stack>
        </Collapse>
      ) : null}
    </Box>
  );
};

/**
 * 應有現金逐項(規格 6.9 公式;Figma ST-18 左欄、ST-28a):每一項可點開看明細,每筆可點回單據
 * (兌獎紀錄詳情;現金流水 → 即時現金帳那一筆)。期初與銷售沒有明細(銷售只有張數與金額)。
 */
export const ExpectedCashList = ({
  items,
  expected,
  onOpenRedemption,
  hint = null,
  labelOf,
  totalLabel,
}: ExpectedCashListProps) => {
  const t = useTranslations("admin.lotteryStore.checkout.drawer");
  const navigate = useNavigate();
  const routeOf = useModuleRoutes();
  const [open, setOpen] = useState<string | null>(null);
  const accountsRoute = routeOf(ACCOUNTS_MODULE_KEYS.list);
  const openEntry = (entry: ExpectedCashEntry) => {
    if (entry.refType === "redemption") {
      onOpenRedemption?.(entry.refId);
    } else if (entry.refType === "movement" && accountsRoute !== null) {
      void navigate(
        `${accountsRoute}?tab=${ACCOUNTS_TABS.cash}&movementId=${entry.refId}`,
      );
    }
  };
  return (
    <Stack spacing={0.5}>
      {items.map((item) => (
        <ItemRow
          key={item.kind}
          item={item}
          customLabel={labelOf?.(item) ?? null}
          expanded={open === item.kind}
          onToggle={() => {
            setOpen((before) => (before === item.kind ? null : item.kind));
          }}
          onOpenEntry={openEntry}
        />
      ))}
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          borderTop: 1,
          borderColor: "divider",
          pt: 1,
        }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          {totalLabel ?? t("expectedTitle")}
        </Typography>
        <Typography variant="subtitle1">{moneyText(expected)}</Typography>
      </Stack>
      {hint === null ? null : (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Stack>
  );
};
