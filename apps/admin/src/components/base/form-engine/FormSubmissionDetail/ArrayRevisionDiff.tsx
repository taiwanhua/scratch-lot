import { useTranslations } from "use-intl";

import {
  type ArrayRowChange,
  type ArrayRowValue,
  type FieldDef,
  arrayColumnsOf,
  arrayRowChanges,
} from "@repo/domain/form";
import { Stack } from "@repo/ui/stack";
import { Table } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { cellFieldOf } from "@/lib/base/form-engine/array-rows";
import type { FormValueRenderContext } from "@/lib/base/form-engine/value-text";

import { FormValue } from "../FormValue";

export interface ArrayRevisionDiffProps {
  field: FieldDef;
  before: unknown;
  after: unknown;
  text: FormValueRenderContext["text"];
}

/**
 * 明細列的修訂差異(Spec 6a §5「明細列」):以 `rowId` 對列,每列標示新增 / 刪除 / 移動 / 改值
 * (一列可以同時移動又改值);改值的列逐格列出「前 → 後」。沒有變動的列不列。
 */
export const ArrayRevisionDiff = ({
  field,
  before,
  after,
  text,
}: ArrayRevisionDiffProps) => {
  const t = useTranslations("admin.formEngine.detail");
  const columns = arrayColumnsOf(field);
  const changes = arrayRowChanges(field, before, after);
  const cellOf = (row: ArrayRowValue | null, columnKey: string) => {
    const column = columns.find((item) => item.key === columnKey);
    return column === undefined ? null : (
      <FormValue
        field={cellFieldOf(field.key, column)}
        value={row?.[columnKey] ?? null}
        text={text}
      />
    );
  };
  const tagsOf = (change: ArrayRowChange): string[] => {
    if (change.kind === "added") {
      return [t("rowAdded")];
    }
    if (change.kind === "removed") {
      return [t("rowRemoved")];
    }
    return [
      ...(change.isMoved ? [t("rowMoved")] : []),
      ...(change.changedColumns.length > 0 ? [t("rowChanged")] : []),
    ];
  };

  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">{field.label}</Typography>
      <Table<ArrayRowChange>
        aria-label={t("arrayDiffAria", { label: field.label })}
        size="small"
        rows={changes}
        getRowKey={(change) => change.rowId}
        containerSx={{ height: "auto" }}
        columns={[
          {
            key: "kind",
            header: t("rowChange"),
            render: (change) => (
              <Stack direction="row" spacing={0.5}>
                {tagsOf(change).map((label) => (
                  <Tag key={label} tone="primary" label={label} />
                ))}
              </Stack>
            ),
          },
          {
            key: "row",
            header: t("rowContent"),
            render: (change) => {
              const row = change.after ?? change.before;
              return (
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                  {columns.map((column) => (
                    <span key={column.key}>
                      {column.label}:{cellOf(row, column.key)}
                    </span>
                  ))}
                </Stack>
              );
            },
          },
          {
            key: "cells",
            header: t("rowCells"),
            render: (change) => (
              <Stack spacing={0.25}>
                {change.changedColumns.map((columnKey) => (
                  <span key={columnKey}>
                    {columns.find((column) => column.key === columnKey)
                      ?.label ?? columnKey}
                    :{cellOf(change.before, columnKey)} →{" "}
                    {cellOf(change.after, columnKey)}
                  </span>
                ))}
              </Stack>
            ),
          },
        ]}
      />
    </Stack>
  );
};
