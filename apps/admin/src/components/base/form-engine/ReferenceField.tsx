import { useState } from "react";
import { useTranslations } from "use-intl";

import { useFormLookupQuery } from "@repo/graphql";
import { Autocomplete } from "@repo/ui/autocomplete";

import { useSession } from "@/hooks/base/useSession";
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
}: WidgetProps) => {
  const t = useTranslations("admin.formEngine.widgets");
  const { session } = useSession();
  const [keyword, setKeyword] = useState("");
  const lookup = useFormLookupQuery(
    session.client,
    {
      input: {
        formKey: context.formKey,
        ...(context.version !== null && { version: context.version }),
        target: { fieldKey: field.key },
        keyword,
        page: 1,
        pageSize: PAGE_SIZE,
      },
    },
    { enabled: !isDesign && !isDisabled && !isReadOnly },
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
  const found: ReferenceOption[] = (lookup.data?.formLookup.items ?? []).map(
    (record) => ({ id: record.id, label: record.label ?? record.id }),
  );
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
        onChange(
          option === null ? null : { id: option.id, label: option.label },
        );
      }}
      onInputChange={setKeyword}
      loading={lookup.isLoading}
      loadingText={t("loading")}
      noOptionsText={t("noOptions")}
      disabled={isDisabled}
      required={field.rules?.required === true}
      error={hasError}
      helperText={helperText}
      size="small"
      fullWidth
    />
  );
};
