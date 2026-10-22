import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { REPRINT_REASON_OTHER } from "@repo/domain/printing";
import {
  useCreatePrintJobMutation,
  usePrintablePrintersQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import type { Receipt58ReprintMarkProps } from "@repo/ui/receipt58";

import type { PrintReprintMark } from "@/components/base/PrintButton/PrintButton";
import { useMe } from "@/hooks/base/useMe";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import {
  PRINT_BUTTON_PERMISSIONS,
  blobToBase64,
  resolvePrinterId,
} from "@/lib/base/print-button";
import {
  type ReceiptKind,
  type ReceiptPayloads,
  receiptKindOf,
  receiptPrintRefOf,
} from "@/lib/project/lottery/receipts/receipt-kinds";
import type {
  ReceiptLayout,
  ReceiptTranslator,
} from "@/lib/project/lottery/receipts/receipt-layout";
import { logReceiptPrintFailure } from "@/lib/project/lottery/receipts/receipt-log";

import { PendingReceipt, type PendingRender } from "./PendingReceipt";

/** 補印標示的文案(`admin.lotteryPurchasing.receipts.reprint.*`)。 */
const REPRINT_I18N = "admin.lotteryPurchasing.receipts.reprint";

export interface ReceiptPrinter {
  /** 有 `api.printing.print`(沒有就什麼都不印;呼叫端可據此省掉為列印而查的資料) */
  canPrint: boolean;
  /**
   * 交易成功之後自動列印(專案規格第 12 章的「自動」):呼叫端在寫入成功之後才呼叫,寫入失敗就不叫。
   * 沒有 `api.printing.print` → 不印;分店沒有可用的印表機 → 不印。
   * 印表機 = 單據的預設(收銀點的印表機)→ 分店預設 → 第一台。
   * 任何失敗(查印表機、轉圖、建立工作)只記 log,不拋錯、不跳提示,呼叫端照常往下做。
   */
  printReceiptAfterCommit: <Kind extends ReceiptKind>(
    kind: Kind,
    payload: ReceiptPayloads[Kind],
  ) => Promise<void>;
  /** 把一張單據轉成 PNG(列印按鈕的 `renderImage`;補印時帶補印標示) */
  renderReceipt: <Kind extends ReceiptKind>(
    kind: Kind,
    payload: ReceiptPayloads[Kind],
    reprint: PrintReprintMark | null,
  ) => Promise<Blob>;
  /** 轉圖用的畫面外節點:呼叫端要把它放進畫面(轉圖要真的排版) */
  host: ReactNode;
}

/**
 * 58mm 單據的列印(專案規格第 12 章;底座 B8 列印流程見 `docs/modules/printers.md`):
 * 單據由 `lib/project/lottery/receipts/` 排版、`ReceiptDocument` 組成版面零件,掛在畫面外轉成 384 點黑白 PNG,
 * 送 `createPrintJob`。補印走底座的列印按鈕與補印對話框(`ReceiptPrintButton`)。
 */
export const useReceiptPrinter = (): ReceiptPrinter => {
  const tRoot = useTranslations();
  const tReprint = useTranslations(REPRINT_I18N);
  const temporalText = useTemporalText();
  const tenantName = useMe().data?.me.currentOrg?.tenantName ?? "";
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canPrint = hasPermission(PRINT_BUTTON_PERMISSIONS.print);
  // 自動列印的回饋只有 log(失敗由底座的列印失敗通知告訴要求人),不跳提示
  const createJob = useCreatePrintJobMutation(
    session.client,
    useMutationFeedback({ success: null, error: () => null }),
  );
  const { mutateAsync: createPrintJob } = createJob;
  const [pending, setPending] = useState<PendingRender[]>([]);
  const nextId = useRef(0);

  const translatorOf = useCallback(
    (namespace: string): ReceiptTranslator =>
      (key, values) =>
        tRoot(`${namespace}.${key}`, values),
    [tRoot],
  );

  const renderLayout = useCallback(
    (layout: ReceiptLayout, reprint: PrintReprintMark | null) =>
      new Promise<Blob>((resolve, reject) => {
        nextId.current += 1;
        const id = nextId.current;
        setPending((current) => [
          ...current,
          { id, layout, reprint, resolve, reject },
        ]);
      }),
    [],
  );

  const renderReceipt = useCallback(
    <Kind extends ReceiptKind>(
      kind: Kind,
      payload: ReceiptPayloads[Kind],
      reprint: PrintReprintMark | null,
    ) => {
      const definition = receiptKindOf(kind);
      return renderLayout(
        definition.layoutOf(
          payload,
          translatorOf(definition.i18n),
          new Date().toISOString(),
        ),
        reprint,
      );
    },
    [renderLayout, translatorOf],
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
        defaultPrinterId: preferredId,
        ...document
      } = receiptPrintRefOf(kind, payload, t);
      try {
        const printers = await queryClient.fetchQuery({
          queryKey: usePrintablePrintersQuery.getKey({ orgId }),
          queryFn: usePrintablePrintersQuery.fetcher(session.client, {
            orgId,
          }),
        });
        const { items, defaultPrinterId } = printers.printablePrinters;
        const printerId = resolvePrinterId(
          items,
          preferredId,
          defaultPrinterId,
        );
        if (printerId === null) {
          logReceiptPrintFailure("no printer", { kind, orgId });
          return;
        }
        // 一張一張送(進貨點收單的兩張依序:店鋪留存、送貨人留存)
        for (const layout of definition.copiesOf(
          payload,
          t,
          new Date().toISOString(),
        )) {
          const image = await blobToBase64(await renderLayout(layout, null));
          await createPrintJob({ input: { printerId, ...document, image } });
        }
      } catch (error) {
        logReceiptPrintFailure("print failed", { kind, orgId, error });
      }
    },
    [
      canPrint,
      createPrintJob,
      queryClient,
      renderLayout,
      session.client,
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
          timeText={temporalText(item.layout.time, "datetime")}
          reprint={
            item.reprint === null ? undefined : reprintMarkOf(item.reprint)
          }
          onDone={onDone}
        />
      ))}
    </Box>
  );

  return { canPrint, printReceiptAfterCommit, renderReceipt, host };
};
