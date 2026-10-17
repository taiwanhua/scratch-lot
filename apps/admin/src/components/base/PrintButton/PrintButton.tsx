import { type MouseEvent, useState } from "react";
import { useTranslations } from "use-intl";

import {
  useCreatePrintJobMutation,
  useDocumentPrintCountQuery,
  usePrintablePrintersQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Menu, MenuItem } from "@repo/ui/menu";
import { Tooltip } from "@repo/ui/tooltip";

import { useMe } from "@/hooks/base/useMe";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import {
  PRINT_BUTTON_PERMISSIONS,
  blobToBase64,
  printButtonErrorOf,
  resolvePrinterId,
} from "@/lib/base/print-button";

import { PrintStatus } from "./PrintStatus";
import { type ReprintChoice, ReprintDialog } from "./ReprintDialog";
import { usePrintJob } from "./usePrintJob";

/** 補印時交給 `renderImage` 的補印標示資料(`Receipt58ReprintMark` 的四段)。 */
export interface PrintReprintMark {
  /** 第幾次(這張單據已印次數 + 1,與 api 寫進工作的 `printNo` 相同)。 */
  printNo: number;
  /** 補印原因的選項值(`lost` / `damaged` / `other` / 租戶自訂)。 */
  reason: string;
  /** 補印原因的顯示名;原因為「其他」時標示改印 `note`。 */
  reasonLabel: string;
  note: string | null;
  /** 補印時間(ISO 時點);使用處依租戶時區以 `formatTemporal` 顯示。 */
  reprintedAt: string;
  /** 補印人(登入者姓名)。 */
  reprintedBy: string;
}

export interface PrintButtonProps {
  /** 單據所屬分店:印表機選單列這家店可選的印表機。 */
  orgId: string;
  /** 單據類型(列印紀錄與通知用,如 `receipt`)。 */
  documentType: string;
  /** 這張單據(`refType` + `refId`):已印次數、補印次數都以它計。 */
  refType: string;
  refId: string;
  /** 單據顯示名稱(列印失敗通知用);不給時通知顯示「單據類型 + 編號」。 */
  documentName?: string | null;
  /** 使用處提供的預設印表機(專案:收銀點的印表機);沒有或不可選時用分店預設。 */
  defaultPrinterId?: string | null;
  /**
   * 產生要送出的 58mm 黑白 PNG:使用處把預覽中的 `Receipt58` 交給 `renderReceiptToPng`。
   * 補印時帶補印標示資料(第一次列印是 `null`,不印補印標示)。
   */
  renderImage: (reprint: PrintReprintMark | null) => Promise<Blob>;
}

/**
 * 列印按鈕(底座規格第 6 章「列印按鈕元件」「權限」;Figma `Draft/PrintButton` 51:625、BS-11 260:67717)。
 *
 * | 狀態 | 畫面 |
 * | --- | --- |
 * | Default | [列印] |
 * | Sending | [列印](不能按)+「已送到印表機…」 |
 * | Printed / Failed | ✓ 已印出 / ✗ 失敗:<原因>(聽 `print-result`;2 分鐘沒信號主動查一次) |
 * | Reprint | 印過的單據 [補印] +「已印 N 次」;按下開補印對話框 |
 * | Disabled | 分店沒有登記印表機:灰色,提示「本店未設定印表機」;有登記但都停用(或代理程式停用)、清單載入失敗各有一句提示 |
 *
 * - 沒有 `api.printing.print` → 整個不渲染;印過但沒有 `api.printing.reprint` → 不顯示 [補印](進度文字照常)。
 * - 選印表機:可選的只有一台就直接送;多台時按下先選(預設排序不變,預設那台標「預設」並先選中)。
 *   預設 = `defaultPrinterId` → 分店預設 → 第一台。
 * - 送出的回饋就是按鈕旁的進度文字,成功不另跳提示;送不出去(轉圖片失敗、API 錯誤)跳一則失敗提示(DATA-06)。
 */
export const PrintButton = ({
  orgId,
  documentType,
  refType,
  refId,
  documentName = null,
  defaultPrinterId = null,
  renderImage,
}: PrintButtonProps) => {
  const t = useTranslations("admin.printButton");
  const { session } = useSession();
  const me = useMe().data?.me;
  const { hasPermission } = usePermissions();
  const canPrint = hasPermission(PRINT_BUTTON_PERMISSIONS.print);
  const canReprint = hasPermission(PRINT_BUTTON_PERMISSIONS.reprint);

  const printers = usePrintablePrintersQuery(
    session.client,
    { orgId },
    { enabled: canPrint },
  );
  const count = useDocumentPrintCountQuery(
    session.client,
    { input: { refType, refId } },
    { enabled: canPrint },
  );
  const createJob = useCreatePrintJobMutation(session.client);
  const feedback = useMutationFeedback({
    // 送出的結果顯示在按鈕旁(已送到印表機 → 已印出 / 失敗),成功不另跳提示
    success: null,
    error: (error) => t(`errors.${printButtonErrorOf(error).code}`),
  });
  const job = usePrintJob(refType, refId);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [reprintPrinterId, setReprintPrinterId] = useState<string | null>(null);

  if (!canPrint) {
    return null;
  }

  const payload = printers.data?.printablePrinters;
  const available = (payload?.items ?? []).filter((item) => item.available);
  const preferredId = resolvePrinterId(
    available,
    defaultPrinterId,
    payload?.defaultPrinterId,
  );
  const printedCount = count.data?.documentPrintCount.printedCount ?? 0;
  const isReprint = printedCount > 0;
  const isSending = job.phase.kind === "sending";
  // 灰掉的原因都要說得出來:沒登記印表機、登記了但都不能用(停用 / 代理程式停用)、清單載入失敗
  const disabledHint = ((): string => {
    if (printers.isError) {
      return t("printersLoadFailed");
    }
    if (!printers.isSuccess || preferredId !== null) {
      return "";
    }
    return (payload?.items.length ?? 0) === 0
      ? t("noPrinter")
      : t("noAvailablePrinter");
  })();
  // 已印次數查不到(請求失敗)當作沒印過:按鈕照常可按,建立工作時 api 自己算第幾次
  const isDisabled =
    isSending || disabledHint !== "" || !printers.isSuccess || count.isPending;

  const send = async (printerId: string, choice: ReprintChoice | null) => {
    job.start();
    try {
      const reprint =
        choice === null
          ? null
          : {
              ...choice,
              printNo: printedCount + 1,
              reprintedAt: new Date().toISOString(),
              reprintedBy: me?.name ?? "",
            };
      const image = await blobToBase64(await renderImage(reprint));
      const created = await createJob.mutateAsync({
        input: {
          printerId,
          documentType,
          refType,
          refId,
          documentName,
          image,
          isReprint: reprint !== null,
          reprintReason: reprint?.reason ?? null,
          reprintNote: reprint?.note ?? null,
        },
      });
      job.watch(created.createPrintJob.job);
    } catch (error) {
      job.reset();
      feedback.onError(error);
    }
  };

  const choosePrinter = (printerId: string) => {
    setMenuAnchor(null);
    if (isReprint) {
      setReprintPrinterId(printerId);
      return;
    }
    void send(printerId, null);
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (available.length > 1) {
      setMenuAnchor(event.currentTarget);
      return;
    }
    if (preferredId !== null) {
      choosePrinter(preferredId);
    }
  };

  const isButtonShown = !isReprint || canReprint;

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
      {isButtonShown ? (
        <Tooltip title={disabledHint}>
          <Button
            variant="outlined"
            size="small"
            disabled={isDisabled}
            aria-haspopup={available.length > 1 ? "menu" : undefined}
            onClick={handleClick}
          >
            {isReprint ? t("reprint") : t("print")}
          </Button>
        </Tooltip>
      ) : null}
      <PrintStatus phase={job.phase} printedCount={printedCount} />
      <Menu
        open={menuAnchor !== null}
        anchorEl={menuAnchor}
        onClose={() => {
          setMenuAnchor(null);
        }}
        slotProps={{ list: { "aria-label": t("choosePrinter") } }}
      >
        {available.map((printer) => (
          <MenuItem
            key={printer.id}
            selected={printer.id === preferredId}
            onClick={() => {
              choosePrinter(printer.id);
            }}
          >
            {printer.id === preferredId
              ? t("defaultPrinter", { name: printer.name })
              : printer.name}
          </MenuItem>
        ))}
      </Menu>
      {reprintPrinterId === null ? null : (
        <ReprintDialog
          onCancel={() => {
            setReprintPrinterId(null);
          }}
          onSubmit={(choice) => {
            setReprintPrinterId(null);
            void send(reprintPrinterId, choice);
          }}
        />
      )}
    </Box>
  );
};
