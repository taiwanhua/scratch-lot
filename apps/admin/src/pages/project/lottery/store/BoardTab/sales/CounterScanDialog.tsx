import { useState } from "react";

import {
  type CounterScanProblem,
  STORE_COUNTER_SCAN_PURPOSE,
  displayBookNo,
} from "@repo/domain/project/lottery";
import {
  type LotteryStoreCounterScanQuery,
  useLotteryStoreCounterScanQuery,
  useMoveLotteryTicketsMutation,
  useRecallLotteryTicketsMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useScanner } from "@/hooks/base/useScanner/useScanner";
import { useSession } from "@/hooks/base/useSession";

import { CameraScanDialog } from "./CameraScanDialog";
import { useRefreshSales } from "./sales-queries";
import { COUNTER_PROBLEM_KEYS } from "./sales-text";
import { useSalesText } from "./useSalesText";

type ScanItem =
  LotteryStoreCounterScanQuery["lotteryStoreCounterScan"]["items"][number];

export interface CounterScanDialogProps {
  kind: "recall" | "move";
  orgId: string;
  /** 卡片所在的收銀點(來源台) */
  cashPointId: string;
  cashPointName: string;
  /** 來源台是不是這台裝置的本機收銀點(上方標「本機」) */
  isLocal: boolean;
  /** 這家店的收銀點(移到哪台;只列其他收銀點) */
  cashPoints: readonly { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * [刷條碼移櫃] / [收回](張數店規格 13.1「刷條碼移櫃視窗」、7.6、7.7;Figma CS-05a / CS-05b):上方「從哪台」由卡片帶入;
 * 移櫃選移到哪台(只列其他收銀點)、收回固定「收回到庫存」;刷條碼、相機或手輸張號加進清單(這台的任何遊戲都可以刷)。
 * 每刷一張先問 api(`lotteryStoreCounterScan`):不能移的當下在輸入框下方寫原因、不加進清單;要對號的標「已對號」
 * (系統記在別台、系統預設帶入的張,照 6.3 在來源台對號,不擋)。[移櫃 N 張] / [收回 N 張] 一次送出(`source: scan`)。
 * 開著時宣告掃描用途 `store-counter-move`(優先於看板的銷售)。手機全螢幕。
 */
export const CounterScanDialog = ({
  kind,
  orgId,
  cashPointId,
  cashPointName,
  isLocal,
  cashPoints,
  onClose,
  onDone,
}: CounterScanDialogProps) => {
  const { t, clock, errorText } = useSalesText();
  const { session } = useSession();
  const refresh = useRefreshSales();
  const isMobile = useBreakpointDown("sm");
  const isMove = kind === "move";
  const targets = cashPoints.filter((point) => point.id !== cashPointId);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [items, setItems] = useState<ScanItem[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isCamera, setIsCamera] = useState(false);
  const action = isMove
    ? t("counterScan.moveAction")
    : t("counterScan.recallAction");
  const targetName = targets.find((point) => point.id === to)?.name ?? "";

  const problemText = (item: ScanItem, reason: CounterScanProblem): string =>
    t(COUNTER_PROBLEM_KEYS[reason], {
      ticketNo: item.ticketNo,
      cashPoint: item.cashPoint?.name ?? "",
      time: item.soldAt == null ? "" : clock(item.soldAt),
      source: cashPointName,
      target: targetName,
      action,
    });

  const add = async (code: string) => {
    const trimmed = code.trim();
    if (trimmed === "" || (isMove && to === "")) {
      return;
    }
    setIsChecking(true);
    try {
      const data = await useLotteryStoreCounterScanQuery.fetcher(
        session.client,
        {
          input: {
            orgId,
            fromCashPointId: cashPointId,
            code: trimmed,
            ...(isMove && { toCashPointId: to }),
          },
        },
      )();
      // 本號對到兩款以上遊戲:取能移的那一張(都不能 → 第一張的原因)
      const found = data.lotteryStoreCounterScan.items;
      const item = found.find((one) => one.problem == null) ?? found.at(0);
      if (item === undefined) {
        setProblem(t("counterScan.notFound", { code: trimmed }));
        return;
      }
      if (items.some((one) => one.ticketId === item.ticketId)) {
        setProblem(t("counterScan.duplicate", { ticketNo: item.ticketNo }));
        return;
      }
      if (item.problem != null) {
        setProblem(problemText(item, item.problem as CounterScanProblem));
        return;
      }
      setItems((current) => [...current, item]);
      setProblem(null);
      setText("");
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setIsChecking(false);
    }
  };
  useScanner(STORE_COUNTER_SCAN_PURPOSE, ({ code }) => {
    setText(code);
    void add(code);
  });

  const feedback = {
    error: errorText,
    onSuccess: () => {
      refresh();
      onDone();
    },
  };
  const move = useMoveLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      ...feedback,
      success: t("move.success", { count: items.length }),
    }),
  );
  const recall = useRecallLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      ...feedback,
      success: t("recall.success", { count: items.length }),
    }),
  );
  const busy = move.isPending || recall.isPending;
  const remove = (ticketId: string) => {
    setItems((current) => current.filter((one) => one.ticketId !== ticketId));
  };
  const submit = () => {
    const input = {
      orgId,
      tickets: items.map((item) => ({
        ticketId: item.ticketId,
        version: item.version,
      })),
      source: "scan",
      fromCashPointId: cashPointId,
    };
    if (isMove) {
      move.mutate({ input: { ...input, toCashPointId: to } });
    } else {
      recall.mutate({ input });
    }
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        fullWidth
        fullScreen={isMobile}
        maxWidth="xs"
        title={
          isMove ? t("counterScan.moveTitle") : t("counterScan.recallTitle")
        }
        actions={
          <>
            <Button variant="text" onClick={onClose}>
              {t("sale.cancel")}
            </Button>
            <Button
              disabled={busy || items.length === 0 || (isMove && to === "")}
              onClick={submit}
            >
              {isMove
                ? t("counterScan.moveSubmit", { count: items.length })
                : t("counterScan.recallSubmit", { count: items.length })}
            </Button>
          </>
        }
      >
        <Stack spacing={1.75}>
          <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
            <Stack direction="row" sx={{ justifyContent: "space-between" }}>
              <Typography variant="subtitle1" color="textPrimary">
                {cashPointName}
              </Typography>
              {isLocal ? (
                <Typography variant="body2" color="textSecondary">
                  {t("counterScan.local")}
                </Typography>
              ) : null}
            </Stack>
            <Typography variant="body2" color="textSecondary">
              {isMove
                ? t("counterScan.moveFrom", { cashPoint: cashPointName })
                : t("counterScan.recallFrom", { cashPoint: cashPointName })}
            </Typography>
          </Box>
          {isMove ? (
            <SelectField
              label={t("counterScan.to")}
              value={to}
              fullWidth
              options={targets.map((point) => ({
                value: point.id,
                label: point.name,
              }))}
              onChange={(value: string) => {
                setTo(value);
              }}
            />
          ) : (
            <Stack direction="row" sx={{ justifyContent: "space-between" }}>
              <Typography variant="body2" color="textSecondary">
                {t("counterScan.recallTo")}
              </Typography>
              <Typography variant="body1" color="textPrimary">
                {t("counterScan.stock")}
              </Typography>
            </Stack>
          )}
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
            <TextField
              label={t("counterScan.input")}
              slotProps={{
                htmlInput: { "data-scanner-field": STORE_COUNTER_SCAN_PURPOSE },
              }}
              size="small"
              value={text}
              error={problem !== null}
              helperText={problem ?? undefined}
              disabled={isChecking}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void add(text);
                }
              }}
              sx={{ flex: 1 }}
            />
            <Button
              variant="outlined"
              disabled={isChecking || text.trim() === ""}
              onClick={() => {
                void add(text);
              }}
            >
              {t("counterScan.add")}
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setIsCamera(true);
              }}
            >
              {t("counterScan.camera")}
            </Button>
          </Stack>
          <Typography variant="body2" color="textSecondary">
            {t("counterScan.scanned", { count: items.length })}
          </Typography>
          <Stack
            component="ul"
            spacing={1}
            sx={{ m: 0, p: 0, listStyle: "none" }}
          >
            {items.map((item) => (
              <Stack
                key={item.ticketId}
                component="li"
                direction="row"
                spacing={1}
                sx={{ alignItems: "center" }}
              >
                <Typography variant="body2" color="textSecondary">
                  {t("counterScan.row", {
                    code: item.gameCode,
                    name: item.gameName,
                    bookNo: displayBookNo(item.bookNo),
                    ticketNo: item.ticketNo,
                  })}
                </Typography>
                {item.match ? (
                  <Tag tone="success" label={t("counterScan.matched")} />
                ) : null}
                <Box sx={{ flex: 1 }} />
                <Button
                  variant="text"
                  size="small"
                  aria-label={t("counterScan.removeLabel", {
                    ticketNo: item.ticketNo,
                  })}
                  onClick={() => {
                    remove(item.ticketId);
                  }}
                >
                  {t("counterScan.remove")}
                </Button>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Dialog>
      {isCamera ? (
        <CameraScanDialog
          onClose={() => {
            setIsCamera(false);
          }}
        />
      ) : null}
    </>
  );
};
