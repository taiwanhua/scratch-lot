import type { ComponentType, ReactNode } from "react";

import type { FieldDef } from "@repo/domain/form";

import type { FilterLinkValues } from "@/lib/base/form-engine/filter-links";
import type { FormFieldErrorLike } from "@/lib/base/form-engine/form-errors";
import type { FormDisplayItemLike } from "@/lib/base/form-engine/value-text";

/**
 * widget 登錄表的共同介面(Spec 6a §5:`type` 決定存什麼、`widget.kind` 決定怎麼畫)。
 * widget 收發的一律是**存值形狀**(§5「值的存法」):靜態選項存 value 字串、類別 / lookup 選項存
 * `{ value, label }`、`allowCustom` 自訂值多一個 `custom: true`、引用存 `{ id, label }`、上傳存
 * `{ path, name, size, contentType }`。數字存十進位字串(送出時 api 依 `precision` 取位)。
 */
export interface WidgetContext {
  formKey: string;
  /** 已發布 / 退役版的版號;設計器預覽(草稿)為 null —— lookup 依它決定查哪一版的定義 */
  version: number | null;
  /**
   * 日期 / 日期時間欄輸入與顯示用的 IANA 時區 = **讀者現在的租戶時區**(填寫與唯讀檢視都是;
   * 修訂的 `ctx.timezone` 只用於重算顯示 / 唯讀條件,不決定顯示)。不給 = 預設時區。
   */
  timezone?: string;
}

export interface WidgetProps {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  /** 填寫中但不能改(沒有欄位級 edit、`readonlyWhen`):停用並附原因 */
  isDisabled: boolean;
  /**
   * 唯讀檢視(詳情頁,`FormRenderer` 的 `readonly` 模式):**不是停用** —— 文字不變灰、附件可下載、
   * 選項 / 引用顯示 label(現名或快照),不查選項、不能改。不給 = false。
   */
  isReadOnly?: boolean;
  /** 設計模式:只畫外觀、不查選項 */
  isDesign: boolean;
  /**
   * 不畫標題(明細列的表格格子:表頭已寫了子欄標題):有框輸入框因此不留 legend 缺口,
   * 標題改當無障礙名稱(`aria-label`)。不給 = false。
   */
  hiddenLabel?: boolean;
  /** 欄位下方的說明(help、唯讀原因、api 回的錯誤) */
  helperText?: ReactNode;
  hasError: boolean;
  context: WidgetContext;
  /** 唯讀檢視:類別 / lookup 選項與引用欄的顯示名(api 的 `displayValues`;現名或快照 + 來源不可用) */
  display?: readonly FormDisplayItemLike[];
  /** 唯讀檢視:上傳欄的下載(簽名網址短效,點了才去要) */
  onDownload?: (field: FieldDef) => void;
  /**
   * 明細列:這一欄的全部值錯誤(api 的 `fieldErrors`):有 `rowId` + `columnKey` 的標在那一格,
   * 其餘(列數不足 / 超過)在表尾
   */
  errors?: readonly FormFieldErrorLike[];
  /** 明細列唯讀:子欄的顯示名(`displayValues` 裡 `<明細 key>.<子欄 key>` 那一組) */
  columnDisplay?: (columnKey: string) => readonly FormDisplayItemLike[];
  /**
   * 連動篩選(B2d):被引用欄位此刻的值與標題(引用欄查詢一併送、沒填就停用;明細往子欄傳)。
   * 只列有被引用的欄位;沒有連動篩選的表單不給。
   */
  filterLinks?: FilterLinkValues;
  /**
   * 列內帶入(B2c):引用欄選定 / 改選一筆時,改呼叫它(連同來源回的欄位值),由明細把引用值與帶入的子欄
   * 一次寫進同一列。不給 = 照常 `onChange`。
   */
  onReferencePick?: (
    value: { id: string; label: string },
    sourceValues: Readonly<Record<string, unknown>>,
  ) => void;
}

export type WidgetComponent = ComponentType<WidgetProps>;

/** 選項欄的一個可選項:`stored` 是選它之後要存的值。 */
export interface ChoiceOption {
  value: string;
  label: string;
  stored: unknown;
}
