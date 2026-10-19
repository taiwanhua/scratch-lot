import { Button } from "@repo/ui/button";

import { useTemporalText } from "@/hooks/base/useTemporalText";
import {
  type FormValueRenderContext,
  displayTextOf,
  isEmptyDisplay,
} from "@/lib/base/form-engine/value-text";

/**
 * 一格值(`renderValue(ctx)` 的元件形;`render-value.ts` 的 `renderValue` 就是渲染它)。
 * 只給表格格子用(列表、修訂差異);詳情頁的唯讀呈現是各 widget 的 readOnly 分支。
 * 文字規則在 `lib/base/form-engine/value-text.ts`。
 * 上傳欄有 `onDownload` 時檔名是按鈕(簽名網址短效,點了才去要)。
 */
export const FormValue = (ctx: FormValueRenderContext) => {
  const { onDownload, field, value } = ctx;
  // 日期 / 日期時間:時點以呼叫端給的時區(沒給 = 讀者的租戶時區)印 YYYY-MM-DD / YYYY-MM-DD HH:mm
  const temporalText = useTemporalText(ctx.timezone);
  const text =
    (field.type === "date" || field.type === "datetime") &&
    !isEmptyDisplay(value)
      ? temporalText(value, field.type)
      : displayTextOf(ctx);
  if (
    field.type !== "upload" ||
    onDownload === undefined ||
    isEmptyDisplay(value)
  ) {
    return <>{text}</>;
  }
  return (
    <Button
      variant="text"
      size="small"
      onClick={() => {
        onDownload(field);
      }}
    >
      {text}
    </Button>
  );
};
