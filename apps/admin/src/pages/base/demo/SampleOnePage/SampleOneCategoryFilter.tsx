import { useTranslations } from "use-intl";

import { Autocomplete } from "@repo/ui/autocomplete";

import type { DemoFiltersProps } from "@/components/base/crud/demo-module-config";

import { SAMPLE_ONE_I18N } from "../demo-sample-one-config";
import type { DemoCategoryOption } from "../demo-sample-one-types";
import { useDemoCategoryOptions } from "../useDemoCategoryOptions";

/**
 * 列表工具列上的分類篩選(設定物件的 `list.Filters`;Figma 176:489 之外另加的)。
 *
 * 用 `Autocomplete`而不是 Select:選項來自欄位管理,合併清單可能很長,
 * 輸入即過濾比「選單外再掛一個搜尋框」好用(STYLE-05 的兩條記錄)。
 *
 * **拿不到選項時整個藏起來** —— 給一個永遠空的篩選器只會讓人以為沒有資料。
 */
export const SampleOneCategoryFilter = ({
  value,
  onChange,
}: DemoFiltersProps) => {
  const t = useTranslations(`${SAMPLE_ONE_I18N}.toolbar`);
  const categories = useDemoCategoryOptions();

  if (!categories.isAvailable) {
    return null;
  }

  return (
    <Autocomplete<DemoCategoryOption>
      options={categories.options}
      value={value}
      onChange={onChange}
      getOptionLabel={(option) => option.label}
      getOptionKey={(option) => option.value}
      label={t("category")}
      size="small"
      loading={categories.isLoading}
      noOptionsText={t("categoryEmpty")}
      sx={{ width: 240 }}
    />
  );
};
