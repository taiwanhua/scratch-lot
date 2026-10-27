import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, localDateOf } from "@repo/domain/form";
import {
  type LotteryDealerSigninsQuery,
  LotterySigninState,
  useLotteryDealerSigninsQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";

import { SIGNIN_STATE_LABELS, SIGNIN_STATE_TONES } from "../dealer-labels";
import { SigninDialog } from "./SigninDialog";
import type { DealerDetailTabProps } from "./dealer-detail-tabs";

type SigninRow =
  LotteryDealerSigninsQuery["lotteryDealerSignins"]["items"][number];

/**
 * 見簽紀錄(甲類詳情頁;規格 5.2、Figma DE-04 / DE-06a):某年四季,已過沒登記的季別警告色、
 * 未到的季別灰色(不能登記)。[登記見簽] 要 `dealers.edit`(看 `abilities.canEdit`)。
 */
export const SigninsTab = ({ dealer }: DealerDetailTabProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const temporal = useTemporalText();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  // 今年:進頁時取一次(租戶時區)
  const [thisYear] = useState(() => localDateOf(Date.now(), timezone).year);
  const [year, setYear] = useState(thisYear);
  const [isRegistering, setIsRegistering] = useState(false);
  const query = useLotteryDealerSigninsQuery(session.client, {
    dealerId: dealer.id,
    year,
  });
  const rows = query.data?.lotteryDealerSignins.items ?? [];

  const columns: DataTableColumn<SigninRow>[] = [
    {
      key: "quarter",
      header: t("signins.quarter"),
      width: 90,
      accessor: (row) =>
        t("signins.quarterOption", { quarter: String(row.quarter) }),
    },
    {
      key: "signedAt",
      header: t("signins.signedAt"),
      width: 130,
      accessor: (row) =>
        row.signedAt === null || row.signedAt === undefined
          ? t("common.none")
          : temporal(row.signedAt, "date"),
    },
    {
      key: "note",
      header: t("signins.note"),
      width: 240,
      accessor: (row) => row.note ?? "",
    },
    {
      key: "state",
      header: t("signins.state"),
      width: 110,
      render: ({ row }) => (
        <Tag
          tone={SIGNIN_STATE_TONES[row.state]}
          label={t(SIGNIN_STATE_LABELS[row.state])}
        />
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}
      >
        <Typography variant="subtitle1" component="h2">
          {t("signins.title")}
        </Typography>
        <Button
          size="small"
          variant="text"
          aria-label={t("signins.prevYear")}
          onClick={() => {
            setYear((current) => current - 1);
          }}
        >
          ‹
        </Button>
        <Typography variant="body2" color="textSecondary">
          {t("signins.year", { year: String(year) })}
        </Typography>
        <Button
          size="small"
          variant="text"
          aria-label={t("signins.nextYear")}
          disabled={year >= thisYear}
          onClick={() => {
            setYear((current) => current + 1);
          }}
        >
          ›
        </Button>
        <Stack sx={{ flex: 1 }} />
        {dealer.abilities.canEdit && (
          <Button
            variant="outlined"
            onClick={() => {
              setIsRegistering(true);
            }}
          >
            {t("actions.registerSignin")}
          </Button>
        )}
      </Stack>
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => String(row.quarter)}
        isLoading={query.isLoading}
        emptyMessage={t("common.empty")}
        size="small"
        aria-label={t("signins.title")}
      />
      {isRegistering && (
        <SigninDialog
          dealerId={dealer.id}
          year={year}
          openQuarters={rows
            .filter(
              (row) =>
                row.state === LotterySigninState.Open ||
                row.state === LotterySigninState.Missing,
            )
            .map((row) => row.quarter)}
          onClose={() => {
            setIsRegistering(false);
          }}
        />
      )}
    </Stack>
  );
};
