import { useTranslations } from "use-intl";

import {
  type ArrayColumnDef,
  type FieldDef,
  arrayColumnsOf,
} from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { DeleteIcon } from "@repo/ui/icons";
import { List, ListItemButton, ListItemText } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import type { DesignerIssue } from "@/lib/base/form-engine/designer-issues";
import { newColumnOf, nextKey } from "@/lib/base/form-engine/designer-ops";

import { useRowIds } from "../useRowIds";

export interface ArrayColumnsEditorProps {
  field: FieldDef;
  /** 檢查器指到這個明細欄子欄的錯誤(`location.columnKey` 有值) */
  issues: readonly DesignerIssue[];
  onChange: (field: FieldDef) => void;
  /** 點一個子欄:屬性面板換成它的縮小版(`ArrayColumnPanel`) */
  onOpen: (index: number) => void;
}

/**
 * 明細列的「子欄位」區塊(Spec 6a §5「明細列」設計器):子欄清單(key / 標題 / 型別 / 必填 / 寬度),
 * 點一個子欄開同一個屬性面板的縮小版(`onOpen` → `ArrayColumnPanel`,只列白名單內的設定);可新增、刪除子欄。
 * 清單的列以穩定內部 id 當 React key(`useRowIds`),改 key 不會整列重掛。
 */
export const ArrayColumnsEditor = ({
  field,
  issues,
  onChange,
  onOpen,
}: ArrayColumnsEditorProps) => {
  const t = useTranslations("admin.forms.columns");
  const tProperty = useTranslations("admin.forms.property");
  const columns = arrayColumnsOf(field);
  const rows = useRowIds(columns.length);
  const setColumns = (next: ArrayColumnDef[]) => {
    onChange({ ...field, columns: next });
  };

  return (
    <Stack spacing={1} component="section" aria-label={t("title")}>
      <Typography variant="body2">{t("title")}</Typography>
      <List dense aria-label={t("list")}>
        {columns.map((column, index) => {
          const hasIssue = issues.some(
            (issue) => issue.location.columnKey === column.key,
          );
          return (
            <Stack
              key={rows.ids[index]}
              direction="row"
              sx={{ alignItems: "center" }}
            >
              <ListItemButton
                aria-label={t("open", { label: column.label })}
                onClick={() => {
                  onOpen(index);
                }}
              >
                <ListItemText
                  primary={column.label}
                  secondary={[
                    column.key,
                    tProperty(`types.${column.type}`),
                    ...(column.rules?.required === true ? [t("required")] : []),
                    ...(typeof column.width === "number"
                      ? [t("widthOf", { width: column.width })]
                      : []),
                  ].join(" · ")}
                  slotProps={{
                    primary: hasIssue ? { color: "error" } : {},
                  }}
                />
              </ListItemButton>
              <Tooltip title={t("remove")} describeChild={false}>
                <IconButton
                  size="small"
                  aria-label={t("removeOf", { label: column.label })}
                  onClick={() => {
                    rows.removed(index);
                    setColumns(columns.filter((_item, at) => at !== index));
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          );
        })}
      </List>
      {issues
        .filter((issue) => issue.location.columnKey === undefined)
        .map((issue, index) => (
          <Typography
            key={`${issue.code}-${String(index)}`}
            variant="caption"
            color="error"
          >
            {issue.message}
          </Typography>
        ))}
      <Stack direction="row">
        <Button
          variant="text"
          size="small"
          onClick={() => {
            rows.added();
            setColumns([
              ...columns,
              newColumnOf(
                "text",
                nextKey(
                  "column",
                  columns.map((column) => column.key),
                ),
                t("newColumn"),
              ),
            ]);
          }}
        >
          {t("add")}
        </Button>
      </Stack>
    </Stack>
  );
};
