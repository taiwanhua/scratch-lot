import { useTranslations } from "use-intl";

import {
  ARRAY_COLUMN_TYPES,
  type ArrayColumnDef,
  type ArrayColumnType,
  type FieldDef,
  arrayColumnsOf,
  checkFieldKey,
} from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import type { DesignerIssue } from "@/lib/base/form-engine/designer-issues";
import {
  type FieldKeyProblem,
  newColumnOf,
} from "@/lib/base/form-engine/designer-ops";
import { columnSectionsOf } from "@/lib/base/form-engine/property-sections";
import { scalarText } from "@/lib/base/form-engine/value-text";

import { FieldKeyInput } from "../FieldKeyInput";
import { LookupSourceEditor } from "../LookupSourceEditor";
import { OptionsEditor } from "../OptionsEditor";
import { RulesEditor } from "../RulesEditor";
import { ColumnPrefillEditor } from "./ColumnPrefillEditor";
import { ColumnValueSourceEditor } from "./ColumnValueSourceEditor";

export interface ArrayColumnPanelProps {
  arrayField: FieldDef;
  column: ArrayColumnDef;
  fields: readonly FieldDef[];
  formKey: string;
  /** 檢查器指到這個子欄的錯誤 */
  issues: readonly DesignerIssue[];
  onChange: (column: ArrayColumnDef) => void;
  onBack: () => void;
}

const PRECISIONS = [0, 1, 2, 3, 4, 5, 6];

/** 子欄只能從靜態清單或欄位管理類別挑選項(沒有 lookup)。 */
const COLUMN_OPTION_KINDS = ["static", "fieldCategory"] as const;

/**
 * 明細子欄的屬性面板(屬性面板的縮小版,Spec 6a §5「明細列」):**只列白名單內的設定** —— key(當場擋
 * 格式與同一明細內重複)、標題、型別(文字 / 數字 / 日期 / 日期時間 / 單選 / 是否 / 引用)、小數位數、表格欄寬、說明、
 * 值來源(使用者填 / 列內公式;引用子欄只能使用者填)、選項(靜態 / 類別)、引用來源(同表單層引用欄)、
 * 驗證規則(必填、長度 / 數值 / 日期上下限、文字格式)。
 * 沒有顯示 / 鎖定條件、預設值、自訂驗證、允許清單外、欄位權限(整欄的設定在明細欄上)。
 */
export const ArrayColumnPanel = ({
  arrayField,
  column,
  fields,
  formKey,
  issues,
  onChange,
  onBack,
}: ArrayColumnPanelProps) => {
  const t = useTranslations("admin.forms.columns");
  const tProperty = useTranslations("admin.forms.property");
  const siblings = arrayColumnsOf(arrayField).filter(
    (candidate) => candidate !== column,
  );
  const keyProblemOf = (key: string): FieldKeyProblem | null => {
    const check = checkFieldKey(key);
    if (!check.valid) {
      return check.reason;
    }
    return siblings.some((candidate) => candidate.key === key)
      ? "duplicate"
      : null;
  };
  const sections = columnSectionsOf(column.type);
  const general = issues.filter(
    (issue) => issue.location.exprSlot === undefined,
  );

  return (
    <Stack spacing={2} component="section" aria-label={t("panel")}>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t("panelTitle", { label: column.label })}
        </Typography>
        <Button variant="text" size="small" onClick={onBack}>
          {t("back")}
        </Button>
      </Stack>
      {general.map((issue, index) => (
        <Typography
          key={`${issue.code}-${String(index)}`}
          variant="caption"
          color="error"
        >
          {issue.message}
        </Typography>
      ))}
      {/* 換選子欄要先回清單,面板整個重掛,輸入框的初始值重新取 */}
      <FieldKeyInput
        value={column.key}
        problemOf={keyProblemOf}
        onCommit={(key) => {
          onChange({ ...column, key });
        }}
      />
      <TextField
        label={tProperty("label")}
        size="small"
        value={column.label}
        onChange={(event) => {
          onChange({ ...column, label: event.target.value });
        }}
      />
      <SelectField<ArrayColumnType>
        label={tProperty("type")}
        value={column.type}
        options={ARRAY_COLUMN_TYPES.map((type) => ({
          value: type,
          label: tProperty(`types.${type}`),
        }))}
        onChange={(type) => {
          // 換型別:元件、選項、規則、小數位數回到該型別的預設,key / 標題 / 寬度 / 說明留著
          onChange({
            ...newColumnOf(type, column.key, column.label),
            ...(column.width !== undefined && { width: column.width }),
            ...(column.help !== undefined && { help: column.help }),
          });
        }}
        size="small"
      />
      {sections.numberRange && (
        <SelectField
          label={tProperty("precision")}
          value={String(column.precision ?? 0)}
          options={PRECISIONS.map((item) => ({
            value: String(item),
            label: String(item),
          }))}
          onChange={(next) => {
            onChange({ ...column, precision: Number(next) });
          }}
          size="small"
        />
      )}
      <TextField
        label={t("width")}
        size="small"
        type="number"
        helperText={t("widthHint")}
        value={scalarText(column.width)}
        onChange={(event) => {
          const text = event.target.value.trim();
          onChange({ ...column, width: text === "" ? null : Number(text) });
        }}
      />
      <TextField
        label={tProperty("help")}
        size="small"
        value={column.help ?? ""}
        onChange={(event) => {
          onChange({
            ...column,
            help: event.target.value === "" ? null : event.target.value,
          });
        }}
      />
      {!sections.referenceSource && (
        <ColumnValueSourceEditor
          arrayField={arrayField}
          column={column}
          fields={fields}
          formKey={formKey}
          exprIssues={issues
            .filter((issue) => issue.location.exprSlot === "valueSource.expr")
            .map((issue) => issue.message)}
          onChange={(valueSource) => {
            onChange({ ...column, valueSource });
          }}
        />
      )}
      {sections.options && (
        <OptionsEditor
          value={column.options}
          kinds={COLUMN_OPTION_KINDS}
          onChange={(options) => {
            onChange({ ...column, options });
          }}
        />
      )}
      {sections.referenceSource && (
        <LookupSourceEditor
          value={column.source ?? { provider: "user", labelField: "name" }}
          hasValueField={false}
          // 明細子欄的篩選只能引用表單層欄位(同一列的其他子欄不行)
          linkFields={fields.filter(
            (candidate) =>
              candidate.key !== arrayField.key && candidate.type !== "array",
          )}
          onChange={(source) => {
            onChange({ ...column, source });
          }}
        />
      )}
      {sections.referenceSource && (
        <ColumnPrefillEditor
          column={column}
          siblings={siblings}
          onChange={(prefill) => {
            const next = { ...column, prefill };
            if (prefill === null) {
              Reflect.deleteProperty(next, "prefill");
            }
            onChange(next);
          }}
        />
      )}
      <RulesEditor
        field={column}
        formKey={formKey}
        fields={[]}
        sections={sections}
        customIssues={[]}
        onChange={(rules) => {
          onChange({ ...column, rules });
        }}
      />
    </Stack>
  );
};
