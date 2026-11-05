import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { STORE_RETURN_SCAN_PURPOSE } from "@repo/domain/project/lottery";
import {
  type LotteryStoreScanQuery,
  useLotteryStoreScanQuery,
  useUndoLotteryTicketSaleMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useScanner } from "@/hooks/base/useScanner/useScanner";
import { useSession } from "@/hooks/base/useSession";

import { SendReversalButton } from "../../forms/SendReversalButton";
import { moneyText } from "../../store-text";
import { useRefreshSales } from "./sales-queries";
import type { ScanItem } from "./scan-place";
import { useSalesText } from "./useSalesText";

export interface ReturnScanFieldProps {
  /** 看板的分店 */
  orgId: string;
  /** 這台裝置的本機收銀點(對號找這台最近一筆依張數售出) */
  localCashPointId: string;
}

/**
 * [最近售出] 的「刷退的票」(張數店規格 7.3 第 1 點):客人帶票回來退,刷或手輸那張票 → 確認視窗 → 撤銷。
 * 看板的刷條碼是銷售,系統記未售的票一刷就賣出,所以退票在這裡刷;開著時掃描用途優先於看板的銷售。
 * 這張不是確定張號的已售時,api 先和這台最近一筆依張數售出對號再撤;不符條件 → [送撤銷售出申請]。
 */
export const ReturnScanField = ({
  orgId,
  localCashPointId,
}: ReturnScanFieldProps) => {
  const { t, clock, errorText } = useSalesText();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const show = useSnackbar();
  const refresh = useRefreshSales();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  /** 刷到的張(同本號對到兩款遊戲時兩筆,先選遊戲) */
  const [items, setItems] = useState<readonly ScanItem[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const close = () => {
    setItems([]);
    setFailure(null);
  };

  const undo = useUndoLotteryTicketSaleMutation(session.client, {
    onSuccess: (data) => {
      const sale = data.undoLotteryTicketSale.item;
      refresh();
      close();
      setText("");
      show(
        "success",
        sale.matched
          ? t("returnScan.matched", { time: clock(sale.soldAt) })
          : t("undo.success"),
      );
    },
    onError: (error) => {
      refresh();
      setFailure(errorText(error));
    },
  });

  const check = async (code: string) => {
    const value = code.trim();
    if (value === "" || isChecking) {
      return;
    }
    setIsChecking(true);
    setProblem(null);
    const variables = { input: { orgId, code: value, localCashPointId } };
    try {
      const data = await queryClient.fetchQuery<LotteryStoreScanQuery>({
        queryKey: useLotteryStoreScanQuery.getKey(variables),
        queryFn: useLotteryStoreScanQuery.fetcher(session.client, variables),
        staleTime: 0,
      });
      const found = data.lotteryStoreScan.items;
      if (found.length === 0) {
        setProblem(t("scan.notFound"));
        return;
      }
      setItems(found);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setIsChecking(false);
    }
  };
  useScanner(STORE_RETURN_SCAN_PURPOSE, ({ code }) => {
    setText(code);
    void check(code);
  });

  const item = items.length === 1 ? items[0] : undefined;
  const lineOf = (row: ScanItem): string =>
    t("returnScan.line", {
      code: row.gameCode,
      name: row.gameName,
      ticketNo: row.ticketNo,
      amount: moneyText(row.unitPrice),
    });

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <TextField
          label={t("returnScan.input")}
          slotProps={{
            htmlInput: { "data-scanner-field": STORE_RETURN_SCAN_PURPOSE },
          }}
          size="small"
          value={text}
          error={problem !== null}
          helperText={problem ?? t("returnScan.help")}
          disabled={isChecking}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void check(text);
            }
          }}
          sx={{ flex: 1 }}
        />
        <Button
          variant="outlined"
          disabled={isChecking || text.trim() === ""}
          onClick={() => {
            void check(text);
          }}
        >
          {t("returnScan.add")}
        </Button>
      </Stack>
      {items.length === 0 ? null : (
        <Dialog
          open
          onClose={close}
          fullWidth
          maxWidth="xs"
          title={t("undo.title")}
          actions={
            <>
              <Button variant="text" onClick={close}>
                {t("sale.cancel")}
              </Button>
              {item !== undefined && failure === null ? (
                <Button
                  color="error"
                  disabled={undo.isPending}
                  onClick={() => {
                    undo.mutate({
                      input: {
                        ticketId: item.ticketId,
                        version: item.version,
                        orgId,
                        localCashPointId,
                      },
                    });
                  }}
                >
                  {t("undo.submit")}
                </Button>
              ) : null}
              {item !== undefined && failure !== null ? (
                <SendReversalButton ticketId={item.ticketId} orgId={orgId} />
              ) : null}
            </>
          }
        >
          {item === undefined ? (
            <Stack spacing={1}>
              {items.map((row) => (
                <Button
                  key={row.ticketId}
                  variant="outlined"
                  onClick={() => {
                    setItems([row]);
                  }}
                >
                  {lineOf(row)}
                </Button>
              ))}
            </Stack>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body1">{lineOf(item)}</Typography>
              {failure === null ? (
                <Typography variant="body2" color="textSecondary">
                  {t("returnScan.hint", {
                    amount: moneyText(item.unitPrice),
                  })}
                </Typography>
              ) : (
                <Alert severity="warning">{failure}</Alert>
              )}
            </Stack>
          )}
        </Dialog>
      )}
    </>
  );
};
