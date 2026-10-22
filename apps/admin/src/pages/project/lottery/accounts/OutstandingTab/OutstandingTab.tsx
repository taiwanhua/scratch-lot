import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryOutstandingSettlementFieldsFragment,
  type LotterySettlementFieldsFragment,
  useLotteryOutstandingSettlementsQuery,
  useLotterySettlementQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import type { TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";

import { SettlementDialog } from "@/components/project/lottery/SettlementPanel/SettlementDialog";
import { buttonLabelKey } from "@/components/project/lottery/SettlementPanel/settlement-text";
import { useSettlementReceipt } from "@/components/project/lottery/SettlementPanel/useSettlementReceipt";
import { useSession } from "@/hooks/base/useSession";

import { AccountsList } from "../AccountsList/AccountsList";
import { OUTSTANDING_TABLE_MIN_WIDTH, moneyText } from "../accounts-config";

type Row = LotteryOutstandingSettlementFieldsFragment;

/** 差額的標籤色:待付 = 錯誤色、待退 / 待收 = 警告色。 */
const KIND_TONES = {
  to_pay: "error",
  to_refund: "warning",
  to_receive: "warning",
} as const;

const kindOf = (kind: string): keyof typeof KIND_TONES =>
  kind === "to_refund" || kind === "to_receive" ? kind : "to_pay";

/** 開付款視窗前先取那張單據的收付現況(先填的金額、可用的付款方式)。 */
const RowSettleDialog = ({
  row,
  onClose,
  onDone,
  onRecorded,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
  onRecorded: (recordId: string, item: LotterySettlementFieldsFragment) => void;
}) => {
  const { session } = useSession();
  const query = useLotterySettlementQuery(session.client, {
    moduleKey: row.moduleKey,
    refId: row.refId,
  });
  const settlement = query.data?.lotterySettlement.item;
  return settlement === undefined ? null : (
    <SettlementDialog
      settlement={settlement}
      side={row.side}
      button={row.button === "in" ? "in" : "out"}
      onClose={onClose}
      onDone={onDone}
      onRecorded={onRecorded}
    />
  );
};

/**
 * 待結清款項分頁(Figma AC-05 93:1143;規格 9、10.3):進貨與調貨同一頁,一張單據的一邊一列 ——
 * 單據、分店、對象、應付、已付、差額(待付 / 待退 / 待收)、已過天數;每列可直接操作
 * (按鈕權限沿用單據的 settle / pay / receive,api 的 `canSettle`)。
 */
export const OutstandingTab = () => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const query = useLotteryOutstandingSettlementsQuery(session.client);
  const rows = query.data?.lotteryOutstandingSettlements.items ?? [];
  const [settling, setSettling] = useState<Row | null>(null);
  // 收貨店付現金 → 調貨付款收據(付款視窗關掉之後才轉圖,所以掛在分頁上)
  const receipt = useSettlementReceipt();

  const columns: TableColumn<Row>[] = [
    {
      key: "document",
      header: t("outstanding.columns.document"),
      isEmphasized: true,
      render: (row) =>
        t("outstanding.documentLabel", { docNo: row.docNo, label: row.label }),
    },
    {
      key: "branch",
      header: t("outstanding.columns.branch"),
      render: (row) => row.branch.name,
    },
    {
      key: "counterparty",
      header: t("outstanding.columns.counterparty"),
      render: (row) => row.counterparty,
    },
    {
      key: "payable",
      header: t("outstanding.columns.payable"),
      align: "right",
      render: (row) => moneyText(row.payable),
    },
    {
      key: "net",
      header: t("outstanding.columns.net"),
      align: "right",
      render: (row) => moneyText(row.net),
    },
    {
      key: "diff",
      header: t("outstanding.columns.diff"),
      render: (row) => (
        <Tag
          tone={KIND_TONES[kindOf(row.kind)]}
          label={t(`outstanding.kinds.${kindOf(row.kind)}`, {
            amount: moneyText(row.amount),
          })}
        />
      ),
    },
    {
      key: "days",
      header: t("outstanding.columns.days"),
      align: "right",
      render: (row) => row.daysOutstanding,
    },
    {
      key: "actions",
      header: t("outstanding.columns.actions"),
      width: 120,
      render: (row) =>
        row.canSettle ? (
          <Button
            variant="outlined"
            size="small"
            onClick={() => {
              setSettling(row);
            }}
          >
            {t(
              buttonLabelKey(
                row.kind === "to_receive" ||
                  (row.kind === "to_refund" && row.button === "out")
                  ? "payee"
                  : "payer",
                row.button === "in" ? "in" : "out",
              ),
            )}
          </Button>
        ) : null,
    },
  ];

  return (
    <Box sx={{ flex: 1, minHeight: 0 }}>
      <AccountsList
        aria-label={t("outstanding.listAria")}
        card={{ title: ["document"], tag: "diff", actions: "actions" }}
        columns={columns}
        rows={rows}
        getRowKey={(row) => `${row.refId}-${row.side}`}
        isLoading={query.isLoading}
        emptyMessage={t("outstanding.empty")}
        minWidth={OUTSTANDING_TABLE_MIN_WIDTH}
      />
      {settling !== null && (
        <RowSettleDialog
          row={settling}
          onClose={() => {
            setSettling(null);
          }}
          onDone={() => {
            void queryClient.invalidateQueries({
              queryKey: useLotteryOutstandingSettlementsQuery.getKey(),
            });
          }}
          onRecorded={receipt.onRecorded}
        />
      )}
      {receipt.host}
    </Box>
  );
};
