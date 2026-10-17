import { useTranslations } from "use-intl";

import {
  DEFAULT_ARRAY_MAX_ROWS,
  type FieldRules,
  MAX_ARRAY_ROWS,
} from "@repo/domain/form";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { scalarText } from "@/lib/base/form-engine/value-text";

export interface ArrayRowRangeEditorProps {
  rules: FieldRules;
  onChange: (rules: FieldRules) => void;
}

/** 空字串 = 拿掉這條規則(回到預設)。 */
const withRowRule = (
  rules: FieldRules,
  key: "minRows" | "maxRows",
  text: string,
): FieldRules => {
  const next: FieldRules = { ...rules };
  if (text.trim() === "") {
    Reflect.deleteProperty(next, key);
  } else {
    next[key] = Number(text);
  }
  return next;
};

/**
 * 明細列的列數上下限(`rules.minRows` / `maxRows`,非負整數;沒設 = 0 / 100,上限 200)。
 * 必填 = 至少一列(與最少列數取大的那個);不合法的組合由檢查器 `ARRAY_ROWS_INVALID` 指出。
 */
export const ArrayRowRangeEditor = ({
  rules,
  onChange,
}: ArrayRowRangeEditorProps) => {
  const t = useTranslations("admin.forms.rules");

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1}>
        <TextField
          label={t("minRows")}
          size="small"
          type="number"
          value={scalarText(rules.minRows)}
          onChange={(event) => {
            onChange(withRowRule(rules, "minRows", event.target.value));
          }}
        />
        <TextField
          label={t("maxRows")}
          size="small"
          type="number"
          value={scalarText(rules.maxRows)}
          onChange={(event) => {
            onChange(withRowRule(rules, "maxRows", event.target.value));
          }}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {t("rowsHint", {
          fallback: DEFAULT_ARRAY_MAX_ROWS,
          max: MAX_ARRAY_ROWS,
        })}
      </Typography>
    </Stack>
  );
};
