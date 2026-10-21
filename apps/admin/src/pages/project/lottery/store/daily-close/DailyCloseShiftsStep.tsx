import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import { useLotteryCheckoutQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Drawer } from "@repo/ui/drawer";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag, type TagTone } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { ExpectedCashList } from "../checkout/ExpectedCashList";
import { signedMoneyText } from "../checkout/checkout-text";
import { moneyText } from "../store-text";
import { STORE_DAILY_CLOSE_WIZARD_QUERY_KEY } from "./daily-close-keys";
import type {
  DailyCloseWizard,
  DailyCloseWizardData,
} from "./useDailyCloseWizard";

type ShiftRow = DailyCloseWizardData["shifts"][number];

const STATE_TONE: Record<string, TagTone> = {
  approved: "success",
  pending: "warning",
  returned: "error",
};

export interface DailyCloseShiftsStepProps {
  wizard: DailyCloseWizardData;
  flow: DailyCloseWizard;
}

/**
 * 側邊打開結帳單審核(規格 6.10;Figma ST-22):結帳單摘要(盤點、應有逐項、實點、差額與原因、留給下一班)+ 審核區塊
 * (核准 / 退回;不離開精靈)。關閉時重抓精靈資料(各班狀態另由 `board:<分店>` 即時更新)。
 */
const ShiftReviewDrawer = ({
  row,
  onClose,
}: {
  row: ShiftRow;
  onClose: () => void;
}) => {
  const t = useTranslations("admin.lotteryStore");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const detail = useLotteryCheckoutQuery(
    session.client,
    { submissionId: row.submissionId },
    { retry: false },
  );
  const item = detail.data?.lotteryCheckout ?? null;
  const facts: [string, string, boolean][] =
    item === null
      ? []
      : [
          [t("checkout.view.counted"), moneyText(item.counted), false],
          [
            t("checkout.view.difference"),
            item.difference === 0
              ? "0"
              : `${signedMoneyText(item.difference)} · ${item.diffReason ?? ""}`,
            item.difference !== 0,
          ],
          [
            t("checkout.view.handover"),
            `${moneyText(item.leftForNext)} / ${item.successor?.name ?? t("checkout.view.noSuccessor")}`,
            false,
          ],
        ];
  return (
    <Drawer
      open
      anchor={isMobile ? "bottom" : "right"}
      title={t("dailyClose.shifts.reviewTitle", {
        serialNo: row.serialNo ?? "",
        cashPoint: row.cashPoint.name,
        name: row.submittedBy?.name ?? "",
      })}
      closeLabel={t("dailyClose.shifts.closeReview")}
      onClose={onClose}
    >
      <Stack spacing={2}>
        {detail.isError ? (
          <Alert severity="error">{t("checkout.view.loadFailed")}</Alert>
        ) : null}
        {item === null ? null : (
          <>
            <ExpectedCashList
              items={item.expectedItems}
              expected={item.expected}
            />
            <Stack spacing={0.5}>
              {facts.map(([label, value, warn]) => (
                <Stack
                  key={label}
                  direction="row"
                  sx={{ justifyContent: "space-between", gap: 2 }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography
                    variant="body1"
                    color={warn ? "error.main" : "text.primary"}
                    sx={{ textAlign: "right" }}
                  >
                    {value}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </>
        )}
        {row.instanceId == null ? null : (
          <ApprovalSection instanceId={row.instanceId} submission={null} />
        )}
      </Stack>
    </Drawer>
  );
};

/**
 * 日結第 ① 步 各班結帳(規格 6.10;Figma ST-21):涵蓋計算期間的每一班(收銀點、交班人、送出、應有、實點、差額、
 * 審核者、狀態)。審核者是自己的列有 [審核](側邊打開結帳單,ST-22);別人審的列顯示「等某某核准」;退回的列顯示
 * 「待某某更正」。全部核准後 [下一步] 才能按。
 */
export const DailyCloseShiftsStep = ({
  wizard,
  flow,
}: DailyCloseShiftsStepProps) => {
  const t = useTranslations("admin.lotteryStore.dailyClose.shifts");
  const temporal = useTemporalText();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const [reviewing, setReviewing] = useState<ShiftRow | null>(null);
  const time = (value: string) =>
    temporal(value, "monthDayTime").split(" ").at(-1) ?? "";
  const reviewerText = (row: ShiftRow): string => {
    if (row.state === "approved") {
      return "—";
    }
    if (row.isMine) {
      return t("you");
    }
    return row.waitingFor.join("、");
  };
  const stateCell = (row: ShiftRow) => (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Tag
        tone={STATE_TONE[row.state] ?? "grey"}
        label={t(`states.${row.state}`)}
      />
      {row.isMine ? (
        <Button
          size="small"
          variant="outlined"
          onClick={(event) => {
            event.stopPropagation();
            setReviewing(row);
          }}
        >
          {t("review")}
        </Button>
      ) : null}
      {!row.isMine && row.state === "pending" && row.waitingFor.length > 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("waitingApprove", { names: row.waitingFor.join("、") })}
        </Typography>
      ) : null}
      {row.state === "returned" ? (
        <Typography variant="body2" color="text.secondary">
          {t("waitingFix", { names: row.waitingFor.join("、") })}
        </Typography>
      ) : null}
    </Stack>
  );
  const columns: TableColumn<ShiftRow>[] = [
    {
      key: "cashPoint",
      header: t("columns.cashPoint"),
      render: (row) => row.cashPoint.name,
    },
    {
      key: "submittedBy",
      header: t("columns.submittedBy"),
      render: (row) => row.submittedBy?.name ?? "",
    },
    {
      key: "submittedAt",
      header: t("columns.submittedAt"),
      render: (row) => time(row.submittedAt),
    },
    {
      key: "expected",
      header: t("columns.expected"),
      align: "right",
      render: (row) => moneyText(row.expected),
    },
    {
      key: "counted",
      header: t("columns.counted"),
      align: "right",
      render: (row) => moneyText(row.counted),
    },
    {
      key: "difference",
      header: t("columns.difference"),
      align: "right",
      render: (row) => (
        <Typography
          variant="body2"
          color={row.difference === 0 ? "text.primary" : "error.main"}
        >
          {signedMoneyText(row.difference)}
        </Typography>
      ),
    },
    { key: "reviewer", header: t("columns.reviewer"), render: reviewerText },
    { key: "state", header: t("columns.state"), render: stateCell },
  ];
  let approvalAlert: ReactNode = null;
  if (!flow.allApproved) {
    approvalAlert = (
      <Alert severity="warning">
        {t("notApproved", { count: flow.unapproved })}
      </Alert>
    );
  } else if (wizard.shifts.length > 0) {
    approvalAlert = <Alert severity="success">{t("allApproved")}</Alert>;
  }
  return (
    <Stack spacing={2}>
      {wizard.openShifts.length > 0 ? (
        <Alert severity="error">
          {t("openShifts", {
            names: wizard.openShifts
              .map((shift) => shift.cashPointName)
              .join("、"),
          })}
        </Alert>
      ) : null}
      {wizard.pending == null ? null : (
        <Alert severity="error">
          {t("pendingDaily", { serialNo: wizard.pending.serialNo ?? "" })}
        </Alert>
      )}
      {isMobile ? (
        <Stack spacing={1}>
          {wizard.shifts.length === 0 ? (
            <Typography color="text.secondary">{t("empty")}</Typography>
          ) : null}
          {wizard.shifts.map((row) => (
            <Card key={row.shiftId} variant="outlined" sx={{ px: 2, py: 1.5 }}>
              <Stack spacing={0.75}>
                <Typography variant="subtitle2">
                  {[
                    row.cashPoint.name,
                    row.submittedBy?.name ?? "",
                    time(row.submittedAt),
                  ]
                    .filter((part) => part !== "")
                    .join(" · ")}
                </Typography>
                <Typography variant="body2">
                  {t("cardFacts", {
                    expected: moneyText(row.expected),
                    counted: moneyText(row.counted),
                    difference: signedMoneyText(row.difference),
                  })}
                </Typography>
                {stateCell(row)}
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : (
        <Table
          columns={columns}
          rows={wizard.shifts}
          getRowKey={(row) => row.shiftId}
          emptyMessage={t("empty")}
          containerSx={{ height: "auto" }}
          minWidth={760}
        />
      )}
      {approvalAlert}
      {reviewing === null ? null : (
        <ShiftReviewDrawer
          row={reviewing}
          onClose={() => {
            setReviewing(null);
            void queryClient.invalidateQueries({
              queryKey: STORE_DAILY_CLOSE_WIZARD_QUERY_KEY,
            });
          }}
        />
      )}
    </Stack>
  );
};
