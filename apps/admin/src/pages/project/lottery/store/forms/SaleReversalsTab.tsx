import { useTranslations } from "use-intl";

import {
  type LotteryStoreSaleReversalRowFieldsFragment,
  useLotteryStoreSaleReversalsQuery,
} from "@repo/graphql";
import { Stack } from "@repo/ui/stack";
import type { TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../store-text";
import { StoreFormsHeader } from "./StoreFormsHeader";
import { StoreFormsList } from "./StoreFormsList";
import { SALE_REVERSAL_FORM_KEY } from "./store-forms-keys";
import { useStoreFormsOrg } from "./useStoreFormsOrg";

type Row = LotteryStoreSaleReversalRowFieldsFragment;

/**
 * 「撤銷售出」分頁(規格 6.1、8.5;Figma ST-31a 90:4318):這家店的撤銷售出申請(單號、張數依本分組、原因、
 * 退款、退款班次、狀態);[+ 新增] 開撤銷售出申請的替換新增頁(只有持有 `store.create-sale_reversal` 才顯示)。
 */
export const SaleReversalsTab = () => {
  const t = useTranslations("admin.lotteryStore.storeForms");
  const { session } = useSession();
  const [orgId, setOrgId] = useStoreFormsOrg();
  const query = useLotteryStoreSaleReversalsQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const rows = query.data?.lotteryStoreSaleReversals.items ?? [];
  const ticketsOf = (row: Row) =>
    `${row.ticketGroups.join("、")}${t("saleReversals.ticketCount", { count: row.ticketCount })}`;
  const refundOf = (row: Row) =>
    row.refund ? moneyText(row.refundAmount) : t("none");
  const columns: TableColumn<Row>[] = [
    {
      key: "serialNo",
      header: t("saleReversals.columns.serialNo"),
      width: 110,
      render: (row) => row.serialNo ?? t("none"),
    },
    {
      key: "tickets",
      header: t("saleReversals.columns.tickets"),
      isEmphasized: true,
      render: ticketsOf,
    },
    {
      key: "reason",
      header: t("saleReversals.columns.reason"),
      render: (row) => row.reasonLabel,
    },
    {
      key: "refundAmount",
      header: t("saleReversals.columns.refundAmount"),
      align: "right",
      width: 100,
      render: refundOf,
    },
    {
      key: "refundShift",
      header: t("saleReversals.columns.refundShift"),
      render: (row) => row.refundShiftLabel ?? t("none"),
    },
    {
      key: "status",
      header: t("saleReversals.columns.status"),
      width: 110,
      render: (row) => <SubmissionStatusTag status={row.status} />,
    },
  ];
  return (
    <Stack spacing={2} sx={{ pt: 2 }}>
      <StoreFormsHeader
        title={t("saleReversals.title")}
        formKey={SALE_REVERSAL_FORM_KEY}
        orgId={orgId}
        onOrgChange={setOrgId}
      />
      <StoreFormsList
        ariaLabel={t("saleReversals.listAria")}
        rows={rows}
        isLoading={query.isLoading && orgId !== ""}
        columns={columns}
        cardTitle={(row) => (
          <Stack direction="row" sx={{ alignItems: "center" }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              {row.serialNo ?? t("none")}
            </Typography>
            <SubmissionStatusTag status={row.status} />
          </Stack>
        )}
        cardBody={(row) => (
          <>
            <Typography variant="body2">{ticketsOf(row)}</Typography>
            <Typography variant="body2" color="text.secondary">
              {[row.reasonLabel, refundOf(row), row.refundShiftLabel ?? ""]
                .filter((part) => part !== "")
                .join(" · ")}
            </Typography>
          </>
        )}
      />
    </Stack>
  );
};
