import { type Ref, useState } from "react";
import { useTranslations } from "use-intl";

import type { PrinterFieldsFragment } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { PrinterTestPage } from "@repo/ui/receipt58";

import { useMe } from "@/hooks/base/useMe";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { PRINTERS_MODULE_KEY } from "../printers-permissions";

export interface TestPageReceiptProps {
  printer: Pick<PrinterFieldsFragment, "name" | "host">;
  /** 交給 `testPageImageOf` 轉圖的節點 */
  receiptRef: Ref<HTMLDivElement>;
}

/**
 * 要送去印的測試頁(`@repo/ui/receipt58` 的 `PrinterTestPage`):掛在畫面外、不給人看,
 * 只當轉圖的來源(與預覽同一個元件)。
 * 表頭 = 最上層組織名稱(`me.currentOrg.tenantName`,不印分店名稱)+ 印表機名稱與 IP + 送出時間(租戶時區);
 * QR code = 本頁的網址。
 */
export const TestPageReceipt = ({
  printer,
  receiptRef,
}: TestPageReceiptProps) => {
  const t = useTranslations("admin.printers.testPage");
  const me = useMe();
  const routeOf = useModuleRoutes();
  const temporalText = useTemporalText();
  // 時間取開窗那一刻(重試沿用;重新整理才會換)
  const [now] = useState(() => new Date().toISOString());
  const managementUrl = `${globalThis.location.origin}${routeOf(PRINTERS_MODULE_KEY) ?? ""}`;

  return (
    <Box
      aria-hidden
      // 畫面外:轉圖要真的排版(不能 display: none),但不佔版面、念不到
      sx={{ position: "fixed", top: 0, left: "-200vw", pointerEvents: "none" }}
    >
      <PrinterTestPage
        ref={receiptRef}
        tenantName={me.data?.me.currentOrg?.tenantName ?? ""}
        printerName={printer.name}
        printerHost={printer.host}
        time={temporalText(now, "datetime")}
        managementUrl={managementUrl}
        labels={{
          title: t("title"),
          large: t("large"),
          normal: t("normal"),
          small: t("small"),
          bold: t("bold"),
          alignLeft: t("alignLeft"),
          alignCenter: t("alignCenter"),
          alignRight: t("alignRight"),
          rowLabel: t("rowLabel"),
          rowValue: t("rowValue"),
          tableHead: [t("tableItem"), t("tableQty"), t("tableAmount")],
          tableRow: [t("tableItemValue"), "2", "400"],
          longText: t("longText"),
          qrCaption: t("qrCaption"),
          cut: t("cut"),
        }}
      />
    </Box>
  );
};
