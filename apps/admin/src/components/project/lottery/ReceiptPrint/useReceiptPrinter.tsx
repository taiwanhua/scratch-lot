import { type ReactNode, useCallback, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { REPRINT_REASON_OTHER } from "@repo/domain/printing";
import { Box } from "@repo/ui/box";
import type { Receipt58ReprintMarkProps } from "@repo/ui/receipt58";

import { useAutoPrint } from "@/components/base/AutoPrint/useAutoPrint";
import type { PrintReprintMark } from "@/components/base/PrintButton/PrintButton";
import { useMe } from "@/hooks/base/useMe";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import {
  RECEIPT_ALL_COPIES,
  type ReceiptKind,
  type ReceiptPayloads,
  receiptKindOf,
  receiptLayoutsOf,
  receiptPrintRefOf,
} from "@/lib/project/lottery/receipts/receipt-kinds";
import type {
  ReceiptLayout,
  ReceiptTranslator,
} from "@/lib/project/lottery/receipts/receipt-layout";

import { PendingReceipt, type PendingRender } from "./PendingReceipt";

/** 補印標示的文案(`admin.lotteryPurchasing.receipts.reprint.*`)。 */
const REPRINT_I18N = "admin.lotteryPurchasing.receipts.reprint";
/** 單據太長沒印出的提示(`admin.lotteryPurchasing.receipts.tooLong`)。 */
const RECEIPTS_I18N = "admin.lotteryPurchasing.receipts";

export interface ReceiptPrinter {
  /** 有 `api.printing.print`(沒有就什麼都不印;呼叫端可據此省掉為列印而查的資料) */
  canPrint: boolean;
  /**
   * 交易成功之後自動列印(專案規格第 12 章的「自動」):呼叫端在寫入成功之後才呼叫,寫入失敗就不叫。
   * 沒有 `api.printing.print` → 不印;分店沒有可用的印表機 → 不印。
   * 印表機 = 單據的預設(收銀點的印表機)→ 分店預設 → 第一台。
   * 送出、等結果與失敗處理走底座的自動列印(`useAutoPrint`:任何失敗只記 log,不拋錯、不跳提示);
   * 唯一的例外:接成一張的圖超過高度 / 大小上限(多聯加總、明細很長)→ 不送,跳一則提示請按 [列印](沒印過)或 [補印](印過)分聯印。
   */
  printReceiptAfterCommit: <Kind extends ReceiptKind>(
    kind: Kind,
    payload: ReceiptPayloads[Kind],
  ) => Promise<void>;
  /**
   * 把一張單據轉成 PNG(列印按鈕的 `renderImage`):多聯的單據印全部的聯(接成一張圖、中間切紙);
   * 補印時帶補印標示;選了其中一聯(`variant`:第一次列印的「列印哪一聯」、補印的「補印哪一聯」)就只印那一聯。
   */
  renderReceipt: <Kind extends ReceiptKind>(
    kind: Kind,
    payload: ReceiptPayloads[Kind],
    reprint: PrintReprintMark | null,
    variant?: string | null,
  ) => Promise<Blob>;
  /** 轉圖用的畫面外節點:呼叫端要把它放進畫面(轉圖要真的排版) */
  host: ReactNode;
}

/**
 * 58mm 單據的列印(專案規格第 12 章;底座 B8 列印流程見 `docs/modules/printers.md`):
 * 單據由 `lib/project/lottery/receipts/` 排版、`ReceiptDocument` 組成版面零件,掛在畫面外轉成 384 點黑白 PNG,
 * 交給底座的自動列印(`useAutoPrint`)送出。補印走底座的列印按鈕與補印對話框(`ReceiptPrintButton`)。
 */
export const useReceiptPrinter = (): ReceiptPrinter => {
  const tRoot = useTranslations();
  const tReprint = useTranslations(REPRINT_I18N);
  const tReceipts = useTranslations(RECEIPTS_I18N);
  const tPrintButton = useTranslations("admin.printButton");
  const showSnackbar = useSnackbar();
  const temporalText = useTemporalText();
  const tenantName = useMe().data?.me.currentOrg?.tenantName ?? "";
  const autoPrint = useAutoPrint();
  const { canPrint, printAfterCommit } = autoPrint;
  const [pending, setPending] = useState<PendingRender[]>([]);
  const nextId = useRef(0);

  const translatorOf = useCallback(
    (namespace: string): ReceiptTranslator =>
      (key, values) =>
        tRoot(`${namespace}.${key}`, values),
    [tRoot],
  );

  const renderLayouts = useCallback(
    (layouts: readonly ReceiptLayout[], reprint: PrintReprintMark | null) =>
      new Promise<Blob>((resolve, reject) => {
        nextId.current += 1;
        const id = nextId.current;
        setPending((current) => [
          ...current,
          { id, layouts, reprint, resolve, reject },
        ]);
      }),
    [],
  );

  const renderReceipt = useCallback(
    <Kind extends ReceiptKind>(
      kind: Kind,
      payload: ReceiptPayloads[Kind],
      reprint: PrintReprintMark | null,
      variant: string | null = null,
    ) => {
      const definition = receiptKindOf(kind);
      return renderLayouts(
        receiptLayoutsOf(
          kind,
          payload,
          translatorOf(definition.i18n),
          new Date().toISOString(),
          variant ?? reprint?.variant ?? RECEIPT_ALL_COPIES,
        ),
        reprint,
      );
    },
    [renderLayouts, translatorOf],
  );

  const printReceiptAfterCommit = useCallback(
    async <Kind extends ReceiptKind>(
      kind: Kind,
      payload: ReceiptPayloads[Kind],
    ): Promise<void> => {
      if (!canPrint) {
        return;
      }
      const definition = receiptKindOf(kind);
      const t = translatorOf(definition.i18n);
      const {
        orgId,
        defaultPrinterId: preferredPrinterId,
        ...document
      } = receiptPrintRefOf(kind, payload, t);
      await printAfterCommit({
        orgId,
        preferredPrinterId,
        document,
        // 一次列印 = 一個工作:多聯的單據各聯接成一張圖、中間切紙(已印次數算 1 次)
        renderImage: () =>
          renderLayouts(
            receiptLayoutsOf(kind, payload, t, new Date().toISOString()),
            null,
          ),
        // 照按鈕現在的樣子寫:沒印過是 [列印]、印過是 [補印](兩邊都能選聯別)
        onTooLarge: (printed) => {
          showSnackbar(
            "warning",
            tReceipts("tooLong", {
              button: tPrintButton(printed > 0 ? "reprint" : "print"),
            }),
          );
        },
        logDetail: { kind },
      });
    },
    [
      canPrint,
      printAfterCommit,
      renderLayouts,
      showSnackbar,
      tPrintButton,
      tReceipts,
      translatorOf,
    ],
  );

  const onDone = useCallback((id: number) => {
    setPending((current) => current.filter((item) => item.id !== id));
  }, []);

  const reprintMarkOf = (
    reprint: PrintReprintMark,
  ): Receipt58ReprintMarkProps => ({
    heading: tReprint("heading", { printNo: reprint.printNo }),
    time: temporalText(reprint.reprintedAt, "datetime"),
    // 原因為「其他」時改印說明(底座 `PrintReprintMark`)
    reason: tReprint("reason", {
      reason:
        reprint.reason === REPRINT_REASON_OTHER && reprint.note !== null
          ? reprint.note
          : reprint.reasonLabel,
    }),
    reprintedBy: tReprint("reprintedBy", { name: reprint.reprintedBy }),
  });

  const host = (
    <Box
      aria-hidden
      // 畫面外:轉圖要真的排版(不能 display: none),但不佔版面、念不到
      sx={{ position: "fixed", top: 0, left: "-200vw", pointerEvents: "none" }}
    >
      {pending.map((item) => (
        <PendingReceipt
          key={item.id}
          item={item}
          tenantName={tenantName}
          timeTextOf={(time) => temporalText(time, "datetime")}
          reprint={
            item.reprint === null ? undefined : reprintMarkOf(item.reprint)
          }
          onDone={onDone}
        />
      ))}
      {autoPrint.host}
    </Box>
  );

  return { canPrint, printReceiptAfterCommit, renderReceipt, host };
};
