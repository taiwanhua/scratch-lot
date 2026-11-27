import { useTranslations } from "use-intl";

import {
  type WholesaleLineValue,
  wholesaleReceivedProblemOf,
} from "@repo/domain/project/lottery";
import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
  type LotteryWholesaleDetailQuery,
  useLotterySettlementQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { SettlementPanel } from "@/components/project/lottery/SettlementPanel/SettlementPanel";
import { useSession } from "@/hooks/base/useSession";

import {
  WHOLESALE_MODULE_KEY,
  WHOLESALE_PAYMENT_MODE,
  formatMoney,
} from "../wholesale-keys";

type WholesaleDetail = LotteryWholesaleDetailQuery["lotteryWholesaleDetail"];

export interface WholesaleSettlementSectionProps {
  submission: FormSubmissionFieldsFragment;
  detail: WholesaleDetail;
}

/** 還沒核准(核准時才自動入帳)的狀態。 */
const BEFORE_APPROVAL: ReadonlySet<FormSubmissionStatus> = new Set([
  FormSubmissionStatus.Reviewing,
  FormSubmissionStatus.Returned,
  FormSubmissionStatus.Withdrawn,
]);

/**
 * 批售單的結算區塊(規格 21.3、21.4;檢視頁與申請中心詳情頁共用):出貨店的收付(`SettlementPanel`,參與收付才有;
 * 草稿、駁回、作廢與核准前的從帳戶入帳 api 回錯 → 不顯示)。
 * - 收到錢再核准、審核中、已收 ≠ 批售金額 → 提示「還差 N 元沒收」/「多收 N 元,請先記退款」(api 的核准前檢查同一個算法)
 * - 從帳戶入帳、核准前 → 批售金額 / 已收與「核准時自動入帳」的說明(Figma WS-03c)
 */
export const WholesaleSettlementSection = ({
  submission,
  detail,
}: WholesaleSettlementSectionProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.view");
  const tSettlement = useTranslations("admin.lotteryAccounts.settlement");
  const { session } = useSession();
  const settlement = useLotterySettlementQuery(
    session.client,
    { moduleKey: WHOLESALE_MODULE_KEY, refId: submission.id },
    {
      enabled: submission.status !== FormSubmissionStatus.Draft,
      retry: false,
    },
  );
  const item = settlement.data?.lotterySettlement.item ?? null;

  if (item !== null) {
    const shipper = item.sides.at(0);
    const problem =
      submission.status === FormSubmissionStatus.Reviewing &&
      detail.paymentMode === WHOLESALE_PAYMENT_MODE.collectFirst
        ? wholesaleReceivedProblemOf(item.payable, {
            out: shipper?.totalOut ?? 0,
            in: shipper?.totalIn ?? 0,
          })
        : null;
    return (
      <>
        <SettlementPanel
          moduleKey={WHOLESALE_MODULE_KEY}
          refId={submission.id}
        />
        {problem !== null && (
          <Alert severity="warning">
            {t(`problems.${problem.kind}`, {
              amount: formatMoney(problem.amount),
            })}
          </Alert>
        )}
      </>
    );
  }
  if (
    detail.paymentMode !== WHOLESALE_PAYMENT_MODE.autoBank ||
    !BEFORE_APPROVAL.has(submission.status)
  ) {
    return null;
  }
  const amounts: { label: string; value: WholesaleLineValue["amount"] }[] = [
    { label: tSettlement("wholesaleAmount"), value: detail.amount },
    { label: tSettlement("receivedAmount"), value: detail.received },
  ];
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">{tSettlement("title")}</Typography>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 3 }}>
          {amounts.map((amount) => (
            <Stack key={amount.label} spacing={0.25}>
              <Typography variant="caption" color="textSecondary">
                {amount.label}
              </Typography>
              <Typography variant="h6">{formatMoney(amount.value)}</Typography>
            </Stack>
          ))}
        </Stack>
        <Alert severity="info">
          {t("autoBankHint", {
            amount: formatMoney(detail.amount),
            account: detail.accountLabel ?? "—",
          })}
        </Alert>
      </Stack>
    </Card>
  );
};
