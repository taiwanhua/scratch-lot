import { type ReactNode, useMemo } from "react";
import { useTranslations } from "use-intl";

import {
  DEFAULT_LIST_BUILTIN_COLUMNS,
  type ListBuiltinColumns,
} from "@repo/domain/form";
import {
  ModuleListColumnKind,
  useLotteryRequisitionStatesQuery,
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
  resolveListCell,
  sortedColumns,
} from "@/lib/base/form-engine/list-columns";
import { summaryDateTypeOf } from "@/lib/base/form-engine/tab-label";

import { REQUISITION_MODULE_KEY } from "../purchasing-keys";
import { RequisitionStatusTag } from "./RequisitionStatusTag";
import { type RequisitionRow, completedIdsOf } from "./requisitions";

/** 內建欄(狀態、建立者)的欄寬。 */
const BUILTIN_WIDTH = 110;

/** 列表 / 卡片的一欄:表頭 + 一格怎麼畫。 */
export interface RequisitionColumn {
  key: string;
  header: string;
  width: number;
  render: (row: RequisitionRow) => ReactNode;
}

/**
 * 叫貨單列表的欄位:讀 `purchasing.requisition` 的**列表欄位配置**(root 在「模組與權限」設定;
 * 初值在 `apps/db-migrator/seeds/project/settings.ts`:單號、叫貨分店、期望到貨日、本數),算法同底座
 * `FormSubmissionList`(`lib/base/form-engine/list-columns.ts`)。內建欄「狀態」把已完成再細分
 * 待購買 / 已進貨 / 已調貨(`lotteryRequisitionStates`);「建立者」照底座。表格與手機卡片共用。
 */
export const useRequisitionColumns = (
  rows: readonly RequisitionRow[],
): RequisitionColumn[] => {
  const t = useTranslations("admin.formEngine.list");
  const tValue = useTranslations("admin.formEngine.renderer");
  const temporalText = useTemporalText();
  const tenantTimezone = useTenantTimezone();
  const { session } = useSession();
  const configured = useModuleListColumnsQuery(session.client, {
    moduleKey: REQUISITION_MODULE_KEY,
  });
  const specs = sortedColumns(configured.data?.moduleListColumns.columns ?? []);
  const builtin: ListBuiltinColumns =
    configured.data?.moduleListColumns.builtin ?? DEFAULT_LIST_BUILTIN_COLUMNS;

  const completedIds = completedIdsOf(rows);
  const statesQuery = useLotteryRequisitionStatesQuery(
    session.client,
    { requisitionIds: completedIds },
    { enabled: completedIds.length > 0 },
  );
  const states = useMemo(
    () =>
      new Map(
        (statesQuery.data?.lotteryRequisitionStates ?? []).map((item) => [
          item.requisitionId,
          item.state,
        ]),
      ),
    [statesQuery.data],
  );

  const { forms } = useModuleForms(REQUISITION_MODULE_KEY);
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
    spec.kind === ModuleListColumnKind.Slot
      ? t(`slots.${spec.key}`)
      : (fieldColumnLabelOf(
          spec,
          currentRefs.map((ref) => ({
            formKey: ref.formKey,
            fields: currentDefinitionOf(ref.formKey, ref.version)?.fields,
          })),
        ) ??
        fieldColumnLabelOf(
          spec,
          rows.map((row) => ({
            formKey: row.formKey,
            fields: definitionOf(row.formKey, row.version)?.fields,
          })),
        ) ??
        spec.key);

  const cellOf = (spec: ListColumnSpec, row: RequisitionRow): ReactNode => {
    const cell = resolveListCell(
      spec,
      row,
      (formKey, version) => definitionOf(formKey, version)?.fields,
    );
    let node: ReactNode = valueText.empty;
    if (cell.kind === "slot" && cell.value !== null) {
      node =
        spec.key === "date"
          ? temporalText(
              cell.value,
              summaryDateTypeOf(definitionOf(row.formKey, row.version)),
              timezone,
            )
          : cell.value;
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
    ...specs.map((spec): RequisitionColumn => ({
      key: columnIdOf(spec),
      header: headerOf(spec),
      width: spec.width,
      render: (row) => cellOf(spec, row),
    })),
    ...(builtin.status
      ? [
          {
            key: "status",
            header: t("status"),
            width: BUILTIN_WIDTH,
            render: (row: RequisitionRow) => (
              <RequisitionStatusTag row={row} states={states} />
            ),
          },
        ]
      : []),
    ...(builtin.createdBy
      ? [
          {
            key: "createdBy",
            header: t("createdBy"),
            width: BUILTIN_WIDTH,
            render: (row: RequisitionRow) =>
              row.createdBy?.name ?? valueText.empty,
          },
        ]
      : []),
  ];
};
