import { useState } from "react";
import { useTranslations } from "use-intl";

import { lookupFilterVarsOf } from "@repo/domain/form";
import { useFormLookupQuery } from "@repo/graphql";
import { Autocomplete } from "@repo/ui/autocomplete";

import { useSession } from "@/hooks/base/useSession";
import {
  filterValuesFor,
  missingLinksOf,
} from "@/lib/base/form-engine/filter-links";
import { identityOf, scalarText } from "@/lib/base/form-engine/value-text";

import { ReadOnlyField } from "./widgets/ReadOnlyField";
import type { WidgetProps } from "./widgets/widget-types";

/** 一次列幾筆(搜尋交給 api 的 keyword)。 */
const PAGE_SIZE = 20;

interface ReferenceOption {
  id: string;
  label: string;
}

const optionOfStored = (value: unknown): ReferenceOption | null => {
  const id = identityOf(value);
  if (id === "") {
    return null;
  }
  const label =
    typeof value === "object" && value !== null && "label" in value
      ? scalarText(value.label)
      : "";
  return { id, label: label === "" ? id : label };
};

/**
 * 引用欄位的搜尋選擇器(Spec 6a §5「引用」;`reference` → `referencePicker`)。
 * 只能從清單選一筆或換選,存 `{ id, label }`;**provider 來自版本定義**:這裡只帶
 * 「哪個版本的哪個欄位」+ 關鍵字打 `formLookup`,api 依定義取 provider / filter 並套操作者的範圍。
 * 送出時 api 會重驗來源可讀、重取 label 寫快照,所以這裡存的 label 只是畫面用的暫值。
 *
 * - 連動篩選(B2d):來源 `filter` 引用其他欄位時,查詢一併送那些欄位目前的值(`filterValues`);
 *   被引用欄位還沒填 → 停用並提示先填
 * - 列內帶入(B2c):給了 `onReferencePick`(明細引用子欄有對應表)時,選定一筆改呼叫它,連同來源欄位的值
 */
export const ReferenceField = ({
  field,
  value,
  onChange,
  isDisabled,
  isReadOnly = false,
  hiddenLabel = false,
  isDesign,
  helperText,
  hasError,
  context,
  display,
  filterLinks,
  onReferencePick,
}: WidgetProps) => {
  const t = useTranslations("admin.formEngine.widgets");
  const { session } = useSession();
  const [keyword, setKeyword] = useState("");
  const vars = lookupFilterVarsOf(field.source);
  const filterValues = filterValuesFor(vars, filterLinks);
  const missing = isDesign ? [] : missingLinksOf(vars, filterLinks);
  const isWaiting = missing.length > 0;
  const lookup = useFormLookupQuery(
    session.client,
    {
      input: {
        formKey: context.formKey,
        ...(context.version !== null && { version: context.version }),
        target: { fieldKey: field.key },
        keyword,
        ...(filterValues !== undefined && { filterValues }),
        page: 1,
        pageSize: PAGE_SIZE,
      },
    },
    { enabled: !isDesign && !isDisabled && !isReadOnly && !isWaiting },
  );
  if (isReadOnly) {
    // 唯讀檢視:顯示 `displayValues` 的現名(來源不可讀時快照 +「(來源不可用)」),不查來源
    return (
      <ReadOnlyField
        field={field}
        value={value}
        context={context}
        helperText={helperText}
        hiddenLabel={hiddenLabel}
        {...(display !== undefined && { display })}
      />
    );
  }
  const current = optionOfStored(value);
  const records = lookup.data?.formLookup.items ?? [];
  const found: ReferenceOption[] = records.map((record) => ({
    id: record.id,
    label: record.label ?? record.id,
  }));
  const options =
    current === null || found.some((option) => option.id === current.id)
      ? found
      : [current, ...found];

  return (
    <Autocomplete<ReferenceOption>
      label={field.label}
      hiddenLabel={hiddenLabel}
      options={options}
      value={current}
      getOptionLabel={(option) => option.label}
      getOptionKey={(option) => option.id}
      onChange={(option) => {
        const next =
          option === null ? null : { id: option.id, label: option.label };
        const record = records.find((candidate) => candidate.id === next?.id);
        if (next !== null && onReferencePick !== undefined) {
          onReferencePick(next, record?.values ?? {});
          return;
        }
        onChange(next);
      }}
      onInputChange={setKeyword}
      loading={lookup.isLoading}
      loadingText={t("loading")}
      noOptionsText={t("noOptions")}
      disabled={isDisabled || isWaiting}
      required={field.rules?.required === true}
      error={hasError}
      helperText={
        isWaiting && !hasError
          ? t("filterPending", { fields: missing.join("、") })
          : helperText
      }
      size="small"
      fullWidth
    />
  );
};
