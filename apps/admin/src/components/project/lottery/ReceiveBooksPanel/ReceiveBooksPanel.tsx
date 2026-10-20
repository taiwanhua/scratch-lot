import { type KeyboardEvent, useState } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useScanner } from "@/hooks/project/useScanner/useScanner";

/** 點收區塊的一本。 */
export interface ReceiveBookRow {
  rowId: string;
  /** 顯示用本號(開頭 0 去掉) */
  bookNo: string;
  lastTicketNo: number;
  tickets: number;
  bookPrice: number;
  rate: number;
  amount: number;
  received: boolean;
}

/** 點收區塊的一組(同一個遊戲)。 */
export interface ReceiveBookGroup {
  key: string;
  /** 組標題(例「5164 發大財 · 200 元」) */
  title: string;
  /** 從叫貨單帶入時叫了幾本;沒有 = null(不顯示「叫貨 N,已刷 M」) */
  requestedBooks: number | null;
  receivedBooks: number;
  rows: ReceiveBookRow[];
}

export interface ReceiveBooksPanelProps {
  groups: readonly ReceiveBookGroup[];
  /** 操作者現在能不能點收(單據在點收關卡、任務在他手上);不能時只顯示進度 */
  canReceive: boolean;
  /** 刷到一個碼(條碼槍或手動輸入後按 Enter);失敗由呼叫端提示 */
  onScan: (code: string) => Promise<void>;
  /** 「這一次」已點收幾本(上次 [完成這次點收] 之後) */
  thisTimeCount: number;
  /** [完成這次點收](結束這一次;列印由呼叫端接) */
  onComplete: () => void;
  isPending: boolean;
  /** 刷條碼的錯誤文案 */
  error: string | null;
}

/** 掃描用途(B10 全域掃描監聽;頁面宣告後,條碼槍讀到的碼交給這裡)。 */
export const RECEIVE_BOOKS_SCAN_PURPOSE = "receive-books";

const money = (value: number): string => value.toLocaleString("en-US");

/**
 * 點收區塊(專案規格 8.2「點收一本」、8.4;Figma PU-06 電腦 69:651、平板 127:26619、手機 127:26898):
 * 逐本刷條碼(刷這本的最後一張),依遊戲分組列出每本點收了沒;[完成這次點收] 在「這一次」還沒刷任何一本時停用。
 * 進貨單與調貨單共用(調貨單只呼叫、不改)。資料與寫入由呼叫端給。
 */
export const ReceiveBooksPanel = ({
  groups,
  canReceive,
  onScan,
  thisTimeCount,
  onComplete,
  isPending,
  error,
}: ReceiveBooksPanelProps) => {
  const t = useTranslations("admin.lotteryPurchasing.receive");
  const isMobile = useBreakpointDown("sm");
  const [code, setCode] = useState("");

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!canReceive || trimmed === "" || isPending) {
      return;
    }
    void onScan(trimmed).then(() => {
      setCode("");
    });
  };
  useScanner(RECEIVE_BOOKS_SCAN_PURPOSE, ({ code: scanned }) => {
    submit(scanned);
  });

  const columns: TableColumn<ReceiveBookRow>[] = [
    {
      key: "bookNo",
      header: t("columns.bookNo"),
      render: (row) => row.bookNo,
      isEmphasized: true,
    },
    {
      key: "lastTicketNo",
      header: t("columns.lastTicketNo"),
      render: (row) => String(row.lastTicketNo).padStart(3, "0"),
    },
    {
      key: "tickets",
      header: t("columns.tickets"),
      align: "right",
      render: (row) => money(row.tickets),
    },
    {
      key: "bookPrice",
      header: t("columns.bookPrice"),
      align: "right",
      render: (row) => money(row.bookPrice),
    },
    {
      key: "rate",
      header: t("columns.rate"),
      align: "right",
      render: (row) => `${String(row.rate)}%`,
    },
    {
      key: "amount",
      header: t("columns.amount"),
      align: "right",
      render: (row) => money(row.amount),
    },
    {
      key: "received",
      header: t("columns.received"),
      render: (row) => (
        <Tag
          tone={row.received ? "success" : "grey"}
          label={row.received ? t("received") : t("notReceived")}
        />
      ),
    },
  ];

  const titleOf = (group: ReceiveBookGroup): string =>
    group.requestedBooks === null
      ? group.title
      : t("groupWithRequested", {
          title: group.title,
          requested: group.requestedBooks,
          scanned: group.receivedBooks,
        });

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit(code);
    }
  };

  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ alignItems: { sm: "center" } }}
        >
          <Typography variant="subtitle1" component="h2" sx={{ flex: 1 }}>
            {t("title")}
          </Typography>
          {canReceive && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <TextField
                label={t("scan")}
                size="small"
                value={code}
                disabled={isPending}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
                onKeyDown={handleKey}
                sx={{ width: { xs: "100%", sm: 280 } }}
                slotProps={{
                  htmlInput: {
                    "data-scanner-field": RECEIVE_BOOKS_SCAN_PURPOSE,
                  },
                }}
              />
              <Button
                variant="outlined"
                disabled={thisTimeCount === 0 || isPending}
                onClick={onComplete}
                sx={{ flexShrink: 0 }}
              >
                {t("complete", { count: thisTimeCount })}
              </Button>
            </Stack>
          )}
        </Stack>
        {error !== null && <Alert severity="error">{error}</Alert>}
        {groups.map((group) => (
          <Stack key={group.key} spacing={1}>
            <Typography variant="subtitle2" component="h3">
              {titleOf(group)}
            </Typography>
            {isMobile ? (
              <Stack spacing={1}>
                {group.rows.map((row) => (
                  <Card key={row.rowId} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center" }}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {row.bookNo}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t("cardFacts", {
                            lastTicketNo: String(row.lastTicketNo).padStart(
                              3,
                              "0",
                            ),
                            rate: row.rate,
                            amount: money(row.amount),
                          })}
                        </Typography>
                      </Box>
                      <Tag
                        tone={row.received ? "success" : "grey"}
                        label={row.received ? t("received") : t("notReceived")}
                      />
                    </Stack>
                  </Card>
                ))}
              </Stack>
            ) : (
              <Table
                aria-label={titleOf(group)}
                size="small"
                columns={columns}
                rows={group.rows}
                getRowKey={(row) => row.rowId}
                minWidth={720}
                containerSx={{ height: "auto" }}
              />
            )}
          </Stack>
        ))}
      </Stack>
    </Card>
  );
};
