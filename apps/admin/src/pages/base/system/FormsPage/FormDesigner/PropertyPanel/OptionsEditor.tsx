import { useTranslations } from "use-intl";

import type { FieldOptions, StaticOptionItem } from "@repo/domain/form";
import { useFieldCategoriesQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { IconButton } from "@repo/ui/icon-button";
import { DeleteIcon } from "@repo/ui/icons";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Tooltip } from "@repo/ui/tooltip";

import { useSession } from "@/hooks/base/useSession";
import { nextKey } from "@/lib/base/form-engine/designer-ops";

import { LookupSourceEditor } from "./LookupSourceEditor";
import { useRowIds } from "./useRowIds";

export interface OptionsEditorProps {
  value: FieldOptions | null | undefined;
  onChange: (value: FieldOptions) => void;
  /** 可選的來源(明細子欄只有靜態清單與欄位管理類別);預設三種都可選 */
  kinds?: readonly FieldOptions["kind"][];
}

type SourceKind = FieldOptions["kind"];

const SOURCE_KINDS: readonly SourceKind[] = [
  "static",
  "fieldCategory",
  "lookup",
];

const emptyOf = (kind: SourceKind): FieldOptions => {
  switch (kind) {
    case "static": {
      return { kind, items: [] };
    }
    case "fieldCategory": {
      return { kind, key: "" };
    }
    case "lookup": {
      return { kind, source: { provider: "user", labelField: "name" } };
    }
  }
};

const UNSET = "";

/**
 * 選項欄的三種來源(Spec 6a §5「`options` 三種來源」):靜態清單逐列加 value / label(可停用、依列順序排)、
 * 欄位管理類別**從啟用的類別清單下拉挑**(`fieldCategories(enabledOnly)`)、lookup 來源選 provider / 表單 / 顯示欄 / 值欄。
 * value 重複等由檢查器報錯。靜態清單的列以**穩定內部 id** 當 React key(`useRowIds`),改 value 不會整列重掛失焦。
 */
export const OptionsEditor = ({
  value,
  onChange,
  kinds = SOURCE_KINDS,
}: OptionsEditorProps) => {
  const t = useTranslations("admin.forms.options");
  const tForms = useTranslations("admin.forms");
  const { session } = useSession();
  const options = value ?? emptyOf("static");
  const items = options.kind === "static" ? options.items : [];
  const rows = useRowIds(items.length);
  // 只列啟用的類別(停用只影響這裡的清單與新選);已選了停用類別的欄位,下面照樣以 key 顯示那一個值
  const categories = useFieldCategoriesQuery(
    session.client,
    { input: { enabledOnly: true } },
    { enabled: options.kind === "fieldCategory" },
  );
  const categoryOptions = (categories.data?.fieldCategories.items ?? []).map(
    (category) => ({
      value: category.key,
      label: tForms("labelWithKey", {
        label: category.name,
        key: category.key,
      }),
    }),
  );

  const setItems = (items: StaticOptionItem[]) => {
    onChange({
      kind: "static",
      items: items.map((item, index) => ({ ...item, order: index + 1 })),
    });
  };

  return (
    <Stack spacing={1.5}>
      <SelectField<SourceKind>
        label={t("source")}
        value={options.kind}
        options={kinds.map((kind) => ({
          value: kind,
          label: t(`sources.${kind}`),
        }))}
        onChange={(kind) => {
          onChange(emptyOf(kind));
        }}
        size="small"
      />
      {options.kind === "static" && (
        <Stack spacing={1} role="group" aria-label={t("items")}>
          {options.items.map((item, index) => (
            <Stack
              key={rows.ids[index]}
              direction="row"
              spacing={1}
              sx={{ alignItems: "center" }}
            >
              <TextField
                label={t("value")}
                size="small"
                value={item.value}
                onChange={(event) => {
                  setItems(
                    options.items.map((entry, at) =>
                      at === index
                        ? { ...entry, value: event.target.value }
                        : entry,
                    ),
                  );
                }}
              />
              <TextField
                label={t("label")}
                size="small"
                value={item.label}
                onChange={(event) => {
                  setItems(
                    options.items.map((entry, at) =>
                      at === index
                        ? { ...entry, label: event.target.value }
                        : entry,
                    ),
                  );
                }}
              />
              <Tooltip title={t("enabled")}>
                <Checkbox
                  checked={item.enabled}
                  onChange={(_event, checked) => {
                    setItems(
                      options.items.map((entry, at) =>
                        at === index ? { ...entry, enabled: checked } : entry,
                      ),
                    );
                  }}
                  slotProps={{
                    input: {
                      "aria-label": t("enabledOf", { label: item.label }),
                    },
                  }}
                />
              </Tooltip>
              <Tooltip title={t("remove")} describeChild={false}>
                <IconButton
                  size="small"
                  aria-label={t("removeOf", { label: item.label })}
                  onClick={() => {
                    rows.removed(index);
                    setItems(
                      options.items.filter((_entry, at) => at !== index),
                    );
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
          <Stack direction="row">
            <Button
              variant="text"
              size="small"
              onClick={() => {
                const value_ = nextKey(
                  "option",
                  options.items.map((item) => item.value),
                );
                rows.added();
                setItems([
                  ...options.items,
                  { value: value_, label: value_, order: 0, enabled: true },
                ]);
              }}
            >
              {t("add")}
            </Button>
          </Stack>
        </Stack>
      )}
      {options.kind === "fieldCategory" && (
        <SelectField<string>
          label={t("category")}
          value={options.key}
          displayEmpty
          helperText={t("categoryHint")}
          options={[
            { value: UNSET, label: t("categoryUnset") },
            ...categoryOptions,
            ...(options.key === UNSET ||
            categoryOptions.some((option) => option.value === options.key)
              ? []
              : [{ value: options.key, label: options.key }]),
          ]}
          onChange={(key) => {
            onChange({ kind: "fieldCategory", key });
          }}
          size="small"
        />
      )}
      {options.kind === "lookup" && (
        <LookupSourceEditor
          value={options.source}
          hasValueField
          onChange={(source) => {
            onChange({ kind: "lookup", source });
          }}
        />
      )}
    </Stack>
  );
};
