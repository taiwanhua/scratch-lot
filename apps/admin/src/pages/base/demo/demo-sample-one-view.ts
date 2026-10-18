import { DemoItemOneStatus } from "@repo/graphql";
import type { TagTone } from "@repo/ui/tag";

/**
 * 狀態 → 標籤色調(列表與詳情共用同一組,同一個狀態在兩頁不能是兩個顏色)。
 * 草稿是中性的灰、已發布是正面的綠、已封存用警示的黃(不是錯誤,只是「不再流通」)。
 */
const STATUS_TONES: Readonly<Record<DemoItemOneStatus, TagTone>> = {
  [DemoItemOneStatus.Draft]: "grey",
  [DemoItemOneStatus.Published]: "success",
  [DemoItemOneStatus.Archived]: "warning",
};

export const statusToneOf = (status: DemoItemOneStatus): TagTone =>
  STATUS_TONES[status];

/**
 * 審計動作 `demo-item-one.edit` → i18n 的 key `edit`。
 * 動作字串的正本是 api 的審計紀錄(模組文件「審計」),前綴是 targetType、最後一段才是動作。
 */
export const historyActionKeyOf = (action: string): string =>
  action.slice(action.lastIndexOf(".") + 1);

/** 這次改了哪些欄位(`after` 只放有變的欄位;不是物件就當作沒有可列的欄位)。 */
export const changedFieldsOf = (
  after: Record<string, unknown> | null | undefined,
): readonly string[] =>
  after === null || after === undefined ? [] : Object.keys(after);

/**
 * 附件的顯示檔名:api 回原始檔名;**早期的舊資料 `name` 為 null**
 * (當時只存路徑)→ 退回物件路徑的最後一段(`demo/<uuid>.pdf` → `<uuid>.pdf`)。
 * 欄位語意正本:`docs/modules/demo.sub.sample-one.md`「api 介面」。
 */
export const attachmentNameOf = (attachment: {
  path: string;
  name?: string | null;
}): string =>
  attachment.name ??
  attachment.path.slice(attachment.path.lastIndexOf("/") + 1);

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * bytes → 人類可讀的大小(`532 B`、`120.6 KB`、`18.4 MB`;1 KB = 1024 B)。
 * 單位是通用符號、不隨語言變,所以不走 i18n。
 */
export const formatFileSize = (bytes: number): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(value) : value.toFixed(1);
  return `${text} ${FILE_SIZE_UNITS[unit]}`;
};
