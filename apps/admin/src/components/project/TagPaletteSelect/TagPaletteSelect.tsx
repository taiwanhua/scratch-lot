import { useTranslations } from "use-intl";

import { SelectField, type SelectFieldOption } from "@repo/ui/select-field";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import {
  TAG_PALETTE_KEYS,
  type TagPaletteKey,
  isTagPaletteKey,
} from "@/lib/project/tag-palettes";

export interface TagPaletteSelectProps {
  /** 目前的色票代號;`null` = 不設定 */
  value: TagPaletteKey | null;
  onChange: (value: TagPaletteKey | null) => void;
  /** 浮動標籤 / 無障礙名稱;省略 = 「顏色」 */
  label?: string;
  /** 表格格子裡用:不畫浮動標籤,`label` 改當 combobox 的名稱 */
  hiddenLabel?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  fullWidth?: boolean;
}

/** 「不設定」選項的值(SelectField 以 `""` 表示空值)。 */
const NONE = "";

/**
 * 色票下拉(規格 18.5:**只能從色票選,不能輸入色碼**):十組色票依固定順序列出,
 * 每個選項畫成色票標籤(色塊 + 名稱),最上面一項「不設定」。收合時顯示選中的那一個標籤。
 * 包 `@repo/ui/select-field`(表單下拉一律用它)。
 */
export const TagPaletteSelect = ({
  value,
  onChange,
  label,
  hiddenLabel = false,
  disabled = false,
  size = "small",
  fullWidth = false,
}: TagPaletteSelectProps) => {
  const t = useTranslations("admin.tagPalettes.select");
  const options: SelectFieldOption<TagPaletteKey | typeof NONE>[] = [
    { value: NONE, label: t("none") },
    ...TAG_PALETTE_KEYS.map((key) => ({
      value: key,
      label: <TagPaletteChip paletteKey={key} />,
    })),
  ];
  return (
    <SelectField
      label={label ?? t("label")}
      hiddenLabel={hiddenLabel}
      options={options}
      value={value ?? NONE}
      displayEmpty
      disabled={disabled}
      size={size}
      fullWidth={fullWidth}
      onChange={(next) => {
        onChange(isTagPaletteKey(next) ? next : null);
      }}
    />
  );
};
