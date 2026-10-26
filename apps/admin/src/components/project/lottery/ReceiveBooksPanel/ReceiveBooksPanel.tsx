import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";

import {
  BookGroupList,
  type BookListColumn,
  type BookListLabels,
  type BookListRow,
} from "../BookGroupList/BookGroupList";
import { BookScanBar } from "../BookScanBar/BookScanBar";

/** 點收區塊的一組(同一個遊戲);每本的 `status` 由呼叫端給(已點收 / 未點收 / 在途)。 */
export interface ReceiveBookGroup {
  key: string;
  /** 組標題(例「5164 發大財 · 200 元」) */
  title: string;
  rows: BookListRow[];
}

/**
 * 刷一個碼的結果:成功;失敗(提示由呼叫端給;null = 呼叫端另外處理,例 送錯分店的彈窗);
 * 正面的碼對到好幾款遊戲同本號(`gameIds` = 要選的遊戲)。
 */
export type ReceiveScanOutcome =
  | { kind: "received" }
  | { kind: "failed"; message: string | null }
  | { kind: "ambiguous_game"; gameIds: string[]; message: string };

export interface ReceiveBooksPanelProps {
  groups: readonly ReceiveBookGroup[];
  /** 操作者現在能不能點收(單據在點收關卡、任務在他手上);不能時只顯示進度(檢視模式,沒有刷條碼列) */
  canReceive: boolean;
  /** 刷到一個碼(條碼槍或手動輸入後按 Enter);`gameId` = 同本號多款遊戲時選的遊戲 */
  onScan: (code: string, gameId: string | null) => Promise<ReceiveScanOutcome>;
  /** 遊戲 id → 選單上的文字(同本號多款遊戲時列出) */
  gameLabelOf: (gameId: string) => string;
  /** 「這一次」已點收幾本(上次 [完成這次點收] 之後) */
  thisTimeCount: number;
  /** [完成這次點收](結束這一次;列印由呼叫端接) */
  onComplete: () => void;
  isPending: boolean;
  /**
   * 覆寫欄名(使用處的詞;例 調貨單:「最後張號」→「張號」、「整本金額」→「金額」)。
   * 手機卡片的說明也用同一組欄名。不給 = 進貨單的欄名。
   */
  columnLabels?: Partial<Record<BookListColumn, string>>;
}

/** 掃描用途(B10 全域掃描監聽;頁面宣告後,條碼槍讀到的碼交給這裡)。 */
export const RECEIVE_BOOKS_SCAN_PURPOSE = "receive-books";

const money = (value: number): string => value.toLocaleString("en-US");

/**
 * 點收區塊(專案規格 8.2「點收一本」、8.4;Figma PU-06 電腦 69:651、平板 127:26619、手機 127:26898):
 * 依遊戲分組的本清單(`BookGroupList` 的點收 / 檢視模式;組標題「已點收 X / N」)+ 刷條碼列(`BookScanBar`,
 * 逐本刷條碼點收)+ [完成這次點收](「這一次」還沒刷任何一本時停用)。
 * 「正面條碼的遊戲」平常不顯示;正面的碼對到單上好幾款遊戲同本號時才出現,選了遊戲就照所選的遊戲再確認一次,
 * 刷成功就收起來。進貨單與調貨單共用;資料與寫入由呼叫端給。
 */
export const ReceiveBooksPanel = ({
  groups,
  canReceive,
  onScan,
  gameLabelOf,
  thisTimeCount,
  onComplete,
  isPending,
  columnLabels,
}: ReceiveBooksPanelProps) => {
  const t = useTranslations("admin.lotteryPurchasing.receive");
  const header = (column: BookListColumn): string =>
    columnLabels?.[column] ?? t(`columns.${column}`);
  const [message, setMessage] = useState<string | null>(null);
  // 同本號多款遊戲:要選的遊戲、選了哪一款、上一次刷的碼(選了之後照所選的遊戲再確認)
  const [choices, setChoices] = useState<readonly string[] | null>(null);
  const [pickedGameId, setPickedGameId] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  // 選遊戲後再確認成功:換 key 清空刷條碼列的輸入欄
  const [barKey, setBarKey] = useState(0);

  const scan = async (
    code: string,
    gameId: string | null,
  ): Promise<boolean> => {
    setMessage(null);
    // 選的遊戲只用在同一個碼上;刷到別的碼就清掉選擇與選單(不把舊遊戲套到不相干的本)
    const isSameCode = code === lastCode;
    if (!isSameCode) {
      setChoices(null);
      setPickedGameId(null);
    }
    setLastCode(code);
    const outcome = await onScan(code, isSameCode ? gameId : null);
    if (outcome.kind === "received") {
      setChoices(null);
      setPickedGameId(null);
      return true;
    }
    setMessage(outcome.message);
    if (outcome.kind === "ambiguous_game") {
      setChoices(outcome.gameIds);
      setPickedGameId(null);
    }
    return false;
  };

  const labels: BookListLabels = {
    columns: {
      bookNo: header("bookNo"),
      ticket: header("ticket"),
      tickets: header("tickets"),
      bookPrice: header("bookPrice"),
      rate: header("rate"),
      amount: header("amount"),
      status: header("status"),
    },
    status: {
      received: t("received"),
      notReceived: t("notReceived"),
      inTransit: t("inTransit"),
    },
    remove: "",
    rateOf: () => "",
    cardFacts: (row) =>
      t("cardFacts", {
        ticketLabel: header("ticket"),
        lastTicketNo: row.ticketText,
        rate: row.rate,
        amount: money(row.amount),
      }),
  };

  return (
    <BookGroupList
      mode={canReceive ? "receive" : "view"}
      title={t("title")}
      labels={labels}
      groups={groups.map((group) => ({
        key: group.key,
        title: group.title,
        caption: t("receivedOf", {
          received: group.rows.filter((row) => row.status === "received")
            .length,
          total: group.rows.length,
        }),
        rows: group.rows,
      }))}
      scanBar={
        canReceive ? (
          <BookScanBar
            key={barKey}
            purpose={RECEIVE_BOOKS_SCAN_PURPOSE}
            label={t("scan")}
            disabled={isPending}
            onScan={(code) => scan(code, pickedGameId)}
            gamePicker={
              choices === null
                ? null
                : {
                    label: t("pickGame"),
                    noneLabel: t("pickGameNone"),
                    options: choices.map((gameId) => ({
                      value: gameId,
                      label: gameLabelOf(gameId),
                    })),
                    value: pickedGameId,
                    onChange: (gameId) => {
                      setPickedGameId(gameId);
                      if (gameId !== null && lastCode !== null) {
                        void scan(lastCode, gameId).then((ok) => {
                          if (ok) {
                            setBarKey((current) => current + 1);
                          }
                        });
                      }
                    },
                  }
            }
            message={
              message === null ? null : { severity: "error", text: message }
            }
            action={
              <Button
                variant="outlined"
                disabled={thisTimeCount === 0 || isPending}
                onClick={onComplete}
                sx={{ flexShrink: 0 }}
              >
                {t("complete", { count: thisTimeCount })}
              </Button>
            }
          />
        ) : null
      }
    />
  );
};
