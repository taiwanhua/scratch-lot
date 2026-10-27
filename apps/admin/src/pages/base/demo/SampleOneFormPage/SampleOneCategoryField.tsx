import { Autocomplete } from "@repo/ui/autocomplete";
import { TextField } from "@repo/ui/text-field";

import type { DemoFormFieldContext } from "@/components/base/crud/demo-module-config";

import type {
  DemoCategoryOption,
  DemoItemDetail,
  SampleOneFormValues,
} from "../demo-sample-one-types";
import { useDemoCategoryOptions } from "../useDemoCategoryOptions";

export interface SampleOneCategoryFieldProps {
  context: DemoFormFieldContext<DemoItemDetail, SampleOneFormValues>;
}

/**
 * 表單的分類欄(設定物件的 `custom` 欄位)。選項來自欄位管理的「示範分類」,
 * 那兩個端點都掛在 `system.field-manager.view` 底下 —— **沒有那個權限就拿不到選項**,
 * 此時保留原值、改不動,並就地講明原因(空的下拉只會讓人以為系統壞了)。
 *
 * 寫成元件而不是設定物件裡的 `render` 閉包:它要呼叫 hook,而 `render` 是在
 * `DemoForm` 的 render 裡被呼叫的普通函式,在那裡呼叫 hook 會違反 hooks 規則。
 */
export const SampleOneCategoryField = ({
  context,
}: SampleOneCategoryFieldProps) => {
  const { values, setValue, hasError, helperText, t, tFields } = context;
  const categories = useDemoCategoryOptions();

  if (!categories.isAvailable) {
    return (
      <TextField
        label={tFields("category")}
        size="small"
        value={values.category?.label ?? ""}
        disabled
        helperText={t("categoryUnavailable")}
        sx={{ width: 240 }}
      />
    );
  }

  return (
    <Autocomplete<DemoCategoryOption>
      options={categories.options}
      value={values.category}
      onChange={(value) => {
        setValue("category", value);
      }}
      getOptionLabel={(option) => option.label}
      getOptionKey={(option) => option.value}
      label={tFields("category")}
      size="small"
      error={hasError("category")}
      helperText={helperText("category")}
      sx={{ width: 240 }}
    />
  );
};
