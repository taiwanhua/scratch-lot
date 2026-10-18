import {
  type CreateDemoItemOneInput,
  DemoItemOneStatus,
  type UpdateDemoItemOneInput,
} from "@repo/graphql";

import type {
  DemoFieldMode,
  DemoUploadResults,
} from "@/components/base/crud/demo-module-config";

import type {
  DemoItemDetail,
  SampleOneFormValues,
} from "../demo-sample-one-types";

/** 編輯情境的初始值;新增情境傳 `null`。 */
export const toFormValues = (
  item: DemoItemDetail | null,
): SampleOneFormValues => {
  if (item === null) {
    return {
      name: "",
      category: null,
      status: DemoItemOneStatus.Draft,
      note: "",
      internalNote: "",
    };
  }
  const category = item.category ?? null;
  return {
    name: item.name,
    // 選項清單拿不到(沒有欄位管理檢視權限)或該選項已停用時,仍用 api 給的顯示名撐住這一格
    category:
      category === null
        ? null
        : { value: category, label: item.categoryLabel ?? category },
    status: item.status,
    note: item.note ?? "",
    internalNote: item.internalNote ?? "",
  };
};

/** 空字串 → `null`(api 的「沒填」是 null,不是空字串)。 */
const orNull = (value: string): string | null =>
  value.trim() === "" ? null : value.trim();

/**
 * 上傳欄的結果 → input 的兩個檔案欄位。**沒動的上傳欄不放鍵**(缺席 = 不動,GQL-06):
 * 封面只送路徑(`coverPath`);附件把路徑與原始檔名 / 大小 / 檔型一起送(`attachment`)。
 */
const uploadInputOf = (
  uploads: DemoUploadResults,
): Pick<CreateDemoItemOneInput, "coverPath" | "attachment"> => {
  const { cover, attachment } = uploads;
  return {
    ...(cover === undefined ? {} : { coverPath: cover?.path ?? null }),
    ...(attachment === undefined ? {} : { attachment }),
  };
};

/**
 * 表單 → `createDemoItemOne` 的 input。
 *
 * **`internalNote` 只在可改時才放進 input**:模組文件寫得很清楚 —— 這個欄位**一出現就要權限**,
 * 連送 `null` 清空都會被 `FORBIDDEN` + `FIELD_FORBIDDEN` 擋下。唯讀 / 不顯示時整個鍵都不能出現。
 */
export const toCreateInput = (
  values: SampleOneFormValues,
  uploads: DemoUploadResults,
  internalNoteMode: DemoFieldMode,
): CreateDemoItemOneInput => ({
  name: values.name.trim(),
  status: values.status,
  category: values.category?.value ?? null,
  note: orNull(values.note),
  ...uploadInputOf(uploads),
  ...(internalNoteMode === "editable"
    ? { internalNote: orNull(values.internalNote) }
    : {}),
});

/**
 * 表單 → `updateDemoItemOne` 的 input。缺席 = 不動、`null` = 清空(GQL-06):
 * 文字欄明確送值;封面 / 附件「不換檔」就不放那個鍵(見 `uploadInputOf`)。
 */
export const toUpdateInput = (
  id: string,
  values: SampleOneFormValues,
  uploads: DemoUploadResults,
  internalNoteMode: DemoFieldMode,
): UpdateDemoItemOneInput => ({
  id,
  ...toCreateInput(values, uploads, internalNoteMode),
});
