import { type ReactNode, useMemo } from "react";
import { useTranslations } from "use-intl";

import {
  DEFAULT_LIST_BUILTIN_COLUMNS,
  type ListBuiltinColumns,
} from "@repo/domain/form";
import {
  type FormSubmissionFieldsFragment,
  useModuleListColumnsQuery,
} from "@repo/graphql";

import { renderValue } from "@/components/base/form-engine/render-value";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useVersionDefinitions } from "@/hooks/base/useVersionDefinitions";
import {
  type ListColumnSpec,
  columnIdOf,
  fieldColumnLabelOf,
  listColumnHeaderOf,
  listTemplateTextOf,
  resolveListCell,
  sortedColumns,
} from "@/lib/base/form-engine/list-columns";
import { summaryDateTypeOf } from "@/lib/base/form-engine/tab-label";

/** 列表的一筆(表單引擎的提交)。 */
export type SubmissionRow = FormSubmissionFieldsFragment;

/** 內建欄(狀態、建立者)的欄寬。 */
const BUILTIN_WIDTH = 110;

/** 列表 / 卡片的一欄:表頭 + 一格怎麼畫。 */
export interface SubmissionColumn {
  key: string;
  header: string;
  width: number;
  render: (row: SubmissionRow) => ReactNode;
}

export interface FormListColumnsOptions {
  /** 內建欄「狀態」怎麼畫(例:叫貨單把已完成細分 待購買 / 已進貨 / 已調貨)。 */
  renderStatus: (row: SubmissionRow) => ReactNode;
  /** 配置欄之後、內建欄之前追加的欄(例:進貨單的點收進度、結算)。 */
  extraColumns?: readonly SubmissionColumn[];
}

/**
 * 叫貨與進貨各表單模組列表的欄位:讀模組的**列表欄位配置**(root 在「模組與權限」設定;初值在
 * `apps/db-migrator/seeds/project/settings.ts`),算法同底座 `FormSubmissionList`
 * (`lib/base/form-engine/list-columns.ts`);內建欄「狀態」由呼叫端決定怎麼畫、「建立者」照底座。
 * 表格與手機卡片共用。
 */
export const useFormListColumns = (
  moduleKey: string,
  rows: readonly SubmissionRow[],
  { renderStatus, extraColumns = [] }: FormListColumnsOptions,
): SubmissionColumn[] => {
  const t = useTranslations("admin.formEngine.list");
  const tValue = useTranslations("admin.formEngine.renderer");
  const temporalText = useTemporalText();
  const tenantTimezone = useTenantTimezone();
  const { session } = useSession();
  const configured = useModuleListColumnsQuery(session.client, {
    moduleKey,
  });
  const specs = sortedColumns(configured.data?.moduleListColumns.columns ?? []);
  const builtin: ListBuiltinColumns =
    configured.data?.moduleListColumns.builtin ?? DEFAULT_LIST_BUILTIN_COLUMNS;

  const { forms } = useModuleForms(moduleKey);
  const currentRefs = useMemo(
    () =>
      forms.map((form) => ({
        formKey: form.key,
        version: form.currentVersion,
      })),
    [forms],
  );
  const currentDefinitionOf = useVersionDefinitions(currentRefs);
  const definitionOf = useVersionDefinitions(rows);
  const valueText = {
    empty: tValue("empty"),
    yes: tValue("yes"),
    no: tValue("no"),
    unavailable: tValue("sourceUnavailable"),
  };
  const timezone = tenantTimezone ?? undefined;

  const headerOf = (spec: ListColumnSpec): string =>
    listColumnHeaderOf(spec, {
      slotLabel: (slot) => t(`slots.${slot}`),
      fieldLabel: (column) =>
        fieldColumnLabelOf(
          column,
          currentRefs.map((ref) => ({
            formKey: ref.formKey,
            fields: currentDefinitionOf(ref.formKey, ref.version)?.fields,
          })),
        ) ??
        fieldColumnLabelOf(
          column,
          rows.map((row) => ({
            formKey: row.formKey,
            fields: definitionOf(row.formKey, row.version)?.fields,
          })),
        ) ??
        column.key,
    });
  /** 摘要槽的文字:「日期」依那一筆的版本印日期或日期時間,其他照字。 */
  const slotTextOf = (
    slot: string,
    value: string,
    row: SubmissionRow,
  ): string =>
    slot === "date"
      ? temporalText(
          value,
          summaryDateTypeOf(definitionOf(row.formKey, row.version)),
          timezone,
        )
      : value;

  const cellOf = (spec: ListColumnSpec, row: SubmissionRow): ReactNode => {
    const cell = resolveListCell(
      spec,
      row,
      (formKey, version) => definitionOf(formKey, version)?.fields,
    );
    let node: ReactNode = valueText.empty;
    if (cell.kind === "slot" && cell.value !== null) {
      node = slotTextOf(spec.key, cell.value, row);
    } else if (cell.kind === "template") {
      const text = listTemplateTextOf(spec.key, row, cell.fields, {
        displayOf: (fieldKey) =>
          row.displayValues.find((entry) => entry.fieldKey === fieldKey)
            ?.items ?? [],
        text: valueText,
        timezone,
        slotText: (slot, value) => slotTextOf(slot, value, row),
      });
      node = text === "" ? valueText.empty : text;
    } else if (cell.kind === "field") {
      node = renderValue({
        field: cell.field,
        value: cell.value,
        display:
          row.displayValues.find((entry) => entry.fieldKey === spec.key)
            ?.items ?? [],
        text: valueText,
        ...(timezone !== undefined && { timezone }),
      });
    }
    return node;
  };

  return [
    ...specs.map((spec): SubmissionColumn => ({
      key: columnIdOf(spec),
      header: headerOf(spec),
      width: spec.width,
      render: (row) => cellOf(spec, row),
    })),
    ...extraColumns,
    ...(builtin.status
      ? [
          {
            key: "status",
            header: t("status"),
            width: BUILTIN_WIDTH,
            render: renderStatus,
          },
        ]
      : []),
    ...(builtin.createdBy
      ? [
          {
            key: "createdBy",
            header: t("createdBy"),
            width: BUILTIN_WIDTH,
            render: (row: SubmissionRow) =>
              row.createdBy?.name ?? valueText.empty,
          },
        ]
      : []),
  ];
};
