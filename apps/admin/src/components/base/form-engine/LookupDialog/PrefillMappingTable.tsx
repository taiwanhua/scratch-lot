import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { PrefillRow } from "@/lib/base/form-engine/prefill";
import { scalarText } from "@/lib/base/form-engine/value-text";

export interface PrefillMappingTableProps {
  recordLabel: string;
  rows: readonly PrefillRow[];
  checked: ReadonlySet<string>;
  onToggle: (fieldKey: string, isChecked: boolean) => void;
  onBack: () => void;
}

const sourceText = (value: unknown, empty: string): string => {
  if (Array.isArray(value)) {
    return value.map((item) => scalarText(item)).join("、");
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  const text = scalarText(value);
  return text === "" ? empty : text;
};

/**
 * 帶入的對應表(選好來源的一筆之後):每列「本表單欄位 ← 來源欄位:值」+ 勾選框(預設全勾),
 * 本欄已有值的附「會覆蓋」。列已先濾掉填寫者沒有 `edit` 資格的欄位(`prefillRowsOf`)。
 */
export const PrefillMappingTable = ({
  recordLabel,
  rows,
  checked,
  onToggle,
  onBack,
}: PrefillMappingTableProps) => {
  const t = useTranslations("admin.formEngine.lookup");

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t("selected", { label: recordLabel })}
        </Typography>
        <Button variant="text" size="small" onClick={onBack}>
          {t("back")}
        </Button>
      </Stack>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("noMapping")}
        </Typography>
      ) : (
        <Stack role="group" aria-label={t("mapping")}>
          {rows.map((row) => (
            <Stack key={row.field.key} spacing={0}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={checked.has(row.field.key)}
                    onChange={(_event, isChecked) => {
                      onToggle(row.field.key, isChecked);
                    }}
                  />
                }
                label={t("row", {
                  field: row.field.label,
                  source: row.sourceField,
                  value: sourceText(row.sourceValue, t("empty")),
                })}
              />
              {row.willOverwrite && (
                <Typography
                  variant="caption"
                  color="warning.main"
                  sx={{ pl: 4 }}
                >
                  {t("willOverwrite")}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
