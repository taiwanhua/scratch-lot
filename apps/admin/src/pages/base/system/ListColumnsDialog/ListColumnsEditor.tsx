import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  LIST_BUILTIN_COLUMNS,
  type ListBuiltinColumns,
} from "@repo/domain/form";
import {
  ModuleListColumnKind,
  type SetModuleListColumnsMutation,
  useModuleListColumnsQuery,
  useSetModuleListColumnsMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";
import {
  LIST_COLUMN_WIDTH,
  type ListColumnSpec,
  SUMMARY_SLOTS,
} from "@/lib/base/form-engine/list-columns";

import { ListColumnRow } from "./ListColumnRow";
import { useListColumnCandidates } from "./useListColumnCandidates";

export interface ListColumnsEditorProps {
  moduleKey: string;
  initial: readonly ListColumnSpec[];
  /** 內建欄(表單 / 狀態 / 建立者)的開關 */
  initialBuiltin: ListBuiltinColumns;
  onClose: () => void;
}

/**
 * 列表欄位配置的編輯(`modules.settings.list`,root 整份覆蓋):摘要槽或表單欄位、順序、寬度,
 * 加內建欄「表單 / 狀態 / 建立者」各一個顯示開關。
 * 表單欄位只列共用表單目前版本的非受保護欄位;清空 = 回到預設欄(標題 + 日期)。
 * 表單改版後配置引用到那一筆版本沒有的欄位不自動清,列表那一格顯示「—」。
 */
export const ListColumnsEditor = ({
  moduleKey,
  initial,
  initialBuiltin,
  onClose,
}: ListColumnsEditorProps) => {
  const t = useTranslations("admin.moduleManager.listColumns");
  const tErrors = useTranslations("admin.formEngine.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { candidates } = useListColumnCandidates(moduleKey);
  const [rows, setRows] = useState<ListColumnSpec[]>(() =>
    initial.toSorted((a, b) => a.order - b.order).map((row) => ({ ...row })),
  );
  const [builtin, setBuiltin] = useState<ListBuiltinColumns>(() => ({
    form: initialBuiltin.form,
    status: initialBuiltin.status,
    createdBy: initialBuiltin.createdBy,
  }));
  const [error, setError] = useState<FormError | null>(null);

  const save = useSetModuleListColumnsMutation(
    session.client,
    useMutationFeedback<SetModuleListColumnsMutation>({
      success: t("saved"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: useModuleListColumnsQuery.getKey({ moduleKey }),
        });
        onClose();
      },
      onError: (failure) => {
        setError(formErrorOf(failure));
      },
    }),
  );

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= rows.length) {
      return;
    }
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
  };

  return (
    <Stack spacing={2}>
      <Typography variant="body2">{t("body")}</Typography>
      {rows.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("usingDefault")}
        </Typography>
      )}
      {rows.map((row, index) => (
        <ListColumnRow
          key={`${String(index)}-${row.kind}`}
          row={row}
          index={index}
          count={rows.length}
          candidates={candidates}
          hasError={
            error?.fields?.includes(`columns.${String(index)}`) === true
          }
          onChange={(next) => {
            setRows(rows.map((item, at) => (at === index ? next : item)));
          }}
          onMove={(offset) => {
            move(index, offset);
          }}
          onRemove={() => {
            setRows(rows.filter((_item, at) => at !== index));
          }}
        />
      ))}
      <Stack direction="row" spacing={1}>
        <Button
          variant="text"
          size="small"
          onClick={() => {
            setRows([
              ...rows,
              {
                kind: ModuleListColumnKind.Slot,
                key: SUMMARY_SLOTS[0],
                width: LIST_COLUMN_WIDTH.default,
                order: rows.length,
              },
            ]);
          }}
        >
          {t("addSlot")}
        </Button>
        <Button
          variant="text"
          size="small"
          disabled={candidates.length === 0}
          onClick={() => {
            const [first] = candidates;
            setRows([
              ...rows,
              {
                kind: ModuleListColumnKind.Field,
                key: first.key,
                formKey: first.formKey,
                width: LIST_COLUMN_WIDTH.default,
                order: rows.length,
              },
            ]);
          }}
        >
          {t("addField")}
        </Button>
      </Stack>
      <Stack spacing={0.25} role="group" aria-label={t("builtin")}>
        <Typography variant="body2">{t("builtin")}</Typography>
        <Stack direction="row" spacing={2}>
          {LIST_BUILTIN_COLUMNS.map((column) => (
            <FormControlLabel
              key={column}
              label={t(`builtinColumns.${column}`)}
              control={
                <Switch
                  checked={builtin[column]}
                  onChange={(_event, checked) => {
                    setBuiltin({ ...builtin, [column]: checked });
                  }}
                />
              }
            />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t("builtinHint")}
        </Typography>
      </Stack>
      {error !== null && <Alert severity="error">{tErrors(error.code)}</Alert>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
        <Button variant="text" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            setError(null);
            save.mutate({
              input: {
                moduleKey,
                columns: rows.map((row, order) => ({
                  kind: row.kind,
                  key: row.key,
                  ...(row.formKey !== null &&
                    row.formKey !== undefined && { formKey: row.formKey }),
                  width: row.width,
                  order,
                })),
                builtin,
              },
            });
          }}
        >
          {t("save")}
        </Button>
      </Stack>
    </Stack>
  );
};
