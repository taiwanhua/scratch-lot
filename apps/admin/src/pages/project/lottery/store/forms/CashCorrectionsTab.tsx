import { useTranslations } from "use-intl";

import {
  type LotteryStoreCashCorrectionRowFieldsFragment,
  useLotteryStoreCashCorrectionsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import type { TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../store-text";
import { StoreFormsHeader } from "./StoreFormsHeader";
import { StoreFormsList } from "./StoreFormsList";
import { CASH_CORRECTION_FORM_KEY } from "./store-forms-keys";
import { useStoreFormsOrg } from "./useStoreFormsOrg";

type Row = LotteryStoreCashCorrectionRowFieldsFragment;

/**
 * 「現金更正」分頁(規格 6.1、8.8;Figma ST-32a 90:5066):這家店的現金更正單(單號、方向、金額、位置、
 * 歸屬班次、原因、狀態);[+ 新增] 開表單引擎的新增頁(不替換頁面;只有持有 `store.create-cash_correction` 才顯示)。
 */
export const CashCorrectionsTab = () => {
  const t = useTranslations("admin.lotteryStore.storeForms");
  const { session } = useSession();
  const [orgId, setOrgId] = useStoreFormsOrg();
  const query = useLotteryStoreCashCorrectionsQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const rows = query.data?.lotteryStoreCashCorrections.items ?? [];
  const directionOf = (row: Row) =>
    row.direction === "decrease"
      ? t("cashCorrections.directions.decrease")
      : t("cashCorrections.directions.increase");
  const placeOf = (row: Row) =>
    row.place === "vault"
      ? t("cashCorrections.vault")
      : (row.placeShiftLabel ?? t("none"));
  const columns: TableColumn<Row>[] = [
    {
      key: "serialNo",
      header: t("cashCorrections.columns.serialNo"),
      width: 110,
      render: (row) => row.serialNo ?? t("none"),
    },
    {
      key: "direction",
      header: t("cashCorrections.columns.direction"),
      width: 110,
      render: directionOf,
    },
    {
      key: "amount",
      header: t("cashCorrections.columns.amount"),
      align: "right",
      width: 100,
      render: (row) => moneyText(row.amount),
    },
    {
      key: "place",
      header: t("cashCorrections.columns.place"),
      isEmphasized: true,
      render: placeOf,
    },
    {
      key: "attributedShift",
      header: t("cashCorrections.columns.attributedShift"),
      render: (row) => row.attributedShiftLabel ?? t("none"),
    },
    {
      key: "reason",
      header: t("cashCorrections.columns.reason"),
      render: (row) => row.reasonLabel,
    },
    {
      key: "status",
      header: t("cashCorrections.columns.status"),
      width: 110,
      render: (row) => <SubmissionStatusTag status={row.status} />,
    },
  ];
  return (
    // 列表分頁(STYLE-08):平板以上分頁殼釘高,清單那一層吃掉剩下的高度並自己捲(表頭固定);手機寬整頁捲
    <Stack spacing={2} sx={{ pt: 2, flex: 1, minHeight: 0 }}>
      <StoreFormsHeader
        title={t("cashCorrections.title")}
        createLabel={t("cashCorrections.create")}
        formKey={CASH_CORRECTION_FORM_KEY}
        orgId={orgId}
        onOrgChange={setOrgId}
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <StoreFormsList
          ariaLabel={t("cashCorrections.listAria")}
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
              <Typography variant="body2">
                {`${directionOf(row)} ${moneyText(row.amount)} · ${placeOf(row)}`}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {[row.reasonLabel, row.attributedShiftLabel ?? ""]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </Typography>
            </>
          )}
        />
      </Box>
    </Stack>
  );
};
