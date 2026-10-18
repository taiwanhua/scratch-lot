"use client";

import type { ReactNode, Ref } from "react";

import { Receipt58 } from "./Receipt58";
import { Receipt58Barcode } from "./Receipt58Barcode";
import { Receipt58Cut } from "./Receipt58Cut";
import { Receipt58Divider } from "./Receipt58Divider";
import { Receipt58Header } from "./Receipt58Header";
import { Receipt58Qr } from "./Receipt58Qr";
import { Receipt58Row } from "./Receipt58Row";
import { Receipt58Table } from "./Receipt58Table";
import { Receipt58Text } from "./Receipt58Text";

/** 測試頁的固定文字;ui 不帶語系(I18N-01),由使用處從訊息檔傳入。 */
export interface PrinterTestPageLabels {
  /** 單據名稱「測試頁」。 */
  title: ReactNode;
  /** 字體大小四行(都印「ABC 123」):大字、一般字、小字、粗體字。 */
  large: ReactNode;
  normal: ReactNode;
  small: ReactNode;
  bold: ReactNode;
  /** 對齊三行:靠左、置中、靠右。 */
  alignLeft: ReactNode;
  alignCenter: ReactNode;
  alignRight: ReactNode;
  /** 左右兩欄(標籤:值)。 */
  rowLabel: ReactNode;
  rowValue: ReactNode;
  /** 三欄表格:表頭 + 一列。 */
  tableHead: readonly [ReactNode, ReactNode, ReactNode];
  tableRow: readonly [ReactNode, ReactNode, ReactNode];
  /** 一段超過一行的長文字,確認自動換行不截斷。 */
  longText: ReactNode;
  /** QR code 下方說明(例「掃描開啟印表機管理」)。 */
  qrCaption: ReactNode;
  /** 切紙位置的說明「切紙」。 */
  cut: ReactNode;
}

export interface PrinterTestPageProps {
  /** 最上層組織名稱(租戶名稱);不印平台名稱。 */
  tenantName: ReactNode;
  printerName: ReactNode;
  /** 印表機 IP(與名稱同列印出)。 */
  printerHost: ReactNode;
  /** 時間:使用處依租戶時區格式化後傳入。 */
  time: ReactNode;
  /** QR code 內容 = 印表機管理頁的連結。 */
  managementUrl: string;
  /** 一維條碼(Code128)內容;預設 `PRINTER_TEST_BARCODE`。 */
  barcodeValue?: string;
  labels: PrinterTestPageLabels;
  /** 交給 `renderReceiptToPng` 用。 */
  ref?: Ref<HTMLDivElement>;
}

/** 測試頁一維條碼的預設內容(Code128 的數字與英文字母都涵蓋)。 */
export const PRINTER_TEST_BARCODE = "TEST-0123456789";

/**
 * 印表機的測試頁(`[測試列印]` 印這一張;規格第 6 章「測試頁」):
 * 用版面零件組成,涵蓋所有列印格式 —— 表頭、字體大小、對齊、欄位、換行、分隔線、條碼、切紙。
 */
export const PrinterTestPage = ({
  tenantName,
  printerName,
  printerHost,
  time,
  managementUrl,
  barcodeValue = PRINTER_TEST_BARCODE,
  labels,
  ref,
}: PrinterTestPageProps) => (
  <Receipt58 ref={ref}>
    <Receipt58Header
      tenantName={tenantName}
      title={labels.title}
      documentNo={
        <>
          {printerName} · {printerHost}
        </>
      }
      time={time}
    />
    <Receipt58Divider />
    <Receipt58Text variant="large">{labels.large}</Receipt58Text>
    <Receipt58Text variant="normal">{labels.normal}</Receipt58Text>
    <Receipt58Text variant="small">{labels.small}</Receipt58Text>
    <Receipt58Text variant="bold">{labels.bold}</Receipt58Text>
    <Receipt58Divider />
    <Receipt58Text align="left">{labels.alignLeft}</Receipt58Text>
    <Receipt58Text align="center">{labels.alignCenter}</Receipt58Text>
    <Receipt58Text align="right">{labels.alignRight}</Receipt58Text>
    <Receipt58Divider />
    <Receipt58Row label={labels.rowLabel} value={labels.rowValue} />
    <Receipt58Table head={labels.tableHead} rows={[labels.tableRow]} />
    <Receipt58Divider />
    <Receipt58Text>{labels.longText}</Receipt58Text>
    <Receipt58Divider />
    <Receipt58Barcode value={barcodeValue} />
    <Receipt58Qr value={managementUrl} caption={labels.qrCaption} />
    {/* 條碼與切紙之間不另加虛線:切紙列本身就是一條點線,兼作分隔 */}
    <Receipt58Cut label={labels.cut} />
  </Receipt58>
);
