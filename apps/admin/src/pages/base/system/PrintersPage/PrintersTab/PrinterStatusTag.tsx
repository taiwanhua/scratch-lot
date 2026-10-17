import { useTranslations } from "use-intl";

import { type PrinterFieldsFragment, PrinterStatus } from "@repo/graphql";
import { Tag, type TagTone } from "@repo/ui/tag";
import { Tooltip } from "@repo/ui/tooltip";

/** 畫面上的印表機狀態(停用與代理程式離線優先於代理程式回報的印表機狀態)。 */
type PrinterDisplayStatus =
  "disabled" | "agentOffline" | "unknown" | "ok" | "paperOut" | "offline";

const STATUS_OF: Record<PrinterStatus, PrinterDisplayStatus> = {
  [PrinterStatus.Ok]: "ok",
  [PrinterStatus.PaperOut]: "paperOut",
  [PrinterStatus.Offline]: "offline",
};

const TONE: Record<PrinterDisplayStatus, TagTone> = {
  disabled: "grey",
  agentOffline: "grey",
  unknown: "grey",
  ok: "success",
  paperOut: "warning",
  offline: "error",
};

/**
 * - 印表機停用 → 已停用
 * - 代理程式離線 → 離線(印表機狀態是代理程式回報的,離線時不可信)
 * - 其餘照代理程式最後回報的印表機狀態:正常 / 缺紙 / 連不上;還沒回報過 → 未回報
 */
const displayStatusOf = (
  printer: Pick<PrinterFieldsFragment, "enabled" | "agentOnline" | "status">,
): PrinterDisplayStatus => {
  if (!printer.enabled) {
    return "disabled";
  }
  if (!printer.agentOnline) {
    return "agentOffline";
  }
  return printer.status == null ? "unknown" : STATUS_OF[printer.status];
};

export interface PrinterStatusTagProps {
  printer: Pick<PrinterFieldsFragment, "enabled" | "agentOnline" | "status">;
}

/** 印表機分頁「狀態」欄的標籤(Figma BS-10a:正常 / 離線)。 */
export const PrinterStatusTag = ({ printer }: PrinterStatusTagProps) => {
  const t = useTranslations("admin.printers.printerStatus");
  const status = displayStatusOf(printer);
  return (
    <Tooltip title={status === "agentOffline" ? t("agentOfflineHint") : ""}>
      <Tag tone={TONE[status]} label={t(status)} />
    </Tooltip>
  );
};
