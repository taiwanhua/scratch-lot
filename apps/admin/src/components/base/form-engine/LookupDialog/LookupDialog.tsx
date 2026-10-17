import { useState } from "react";
import { useTranslations } from "use-intl";

import type { FormDefinition, StoredValues } from "@repo/domain/form";
import {
  type FormLookupRecordFieldsFragment,
  useFormLookupQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { List, ListItemButton, ListItemText } from "@repo/ui/list";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { prefillPatchOf, prefillRowsOf } from "@/lib/base/form-engine/prefill";

import { PrefillMappingTable } from "./PrefillMappingTable";

const PAGE_SIZE = 20;

export interface LookupDialogProps {
  definition: FormDefinition;
  formKey: string;
  /** 綁的版本(新增 = 目前版本;設計器預覽 = null 草稿) */
  version: number | null;
  values: StoredValues;
  /** 填寫者對該欄有沒有 `edit` 資格(沒有的列不出現) */
  canEdit: (fieldKey: string) => boolean;
  onApply: (patch: StoredValues) => void;
  onClose: () => void;
}

/**
 * 帶入資料跳窗(Spec 6a §5「帶入」、§8 畫面 10):來源下拉(只有一條就不顯示)→ 搜尋 + 結果清單
 * (`formLookup`,依來源可見範圍與權限過濾)→ 選一筆 → 對應表每列「本表單欄位 ← 來源欄位:值」帶勾選框
 * (預設全勾;本欄已有值提示「會覆蓋」;**填寫者對該欄沒有 `edit` 資格的列不出現**)→「帶入」/「取消」。
 */
export const LookupDialog = ({
  definition,
  formKey,
  version,
  values,
  canEdit,
  onApply,
  onClose,
}: LookupDialogProps) => {
  const t = useTranslations("admin.formEngine.lookup");
  const { session } = useSession();
  const [prefillIndex, setPrefillIndex] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [record, setRecord] = useState<FormLookupRecordFieldsFragment | null>(
    null,
  );
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const prefill = definition.prefills.at(prefillIndex);

  const lookup = useFormLookupQuery(
    session.client,
    {
      input: {
        formKey,
        ...(version !== null && { version }),
        target: { prefillIndex },
        keyword,
        page: 1,
        pageSize: PAGE_SIZE,
      },
    },
    { enabled: prefill !== undefined },
  );
  const records = lookup.data?.formLookup.items ?? [];

  const rows =
    prefill === undefined || record === null
      ? []
      : prefillRowsOf(
          prefill,
          definition.fields,
          record.values,
          values,
          canEdit,
        );
  const checked = new Set(
    rows.map((row) => row.field.key).filter((key) => !unchecked.has(key)),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={record === null || checked.size === 0}
            onClick={() => {
              onApply(prefillPatchOf(rows, checked));
            }}
          >
            {t("apply")}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        {definition.prefills.length > 1 && (
          <SelectField
            label={t("source")}
            value={String(prefillIndex)}
            options={definition.prefills.map((item, index) => ({
              value: String(index),
              label: item.label,
            }))}
            onChange={(next) => {
              setPrefillIndex(Number(next));
              setRecord(null);
              setUnchecked(new Set());
            }}
            size="small"
          />
        )}
        {record === null ? (
          <>
            <TextField
              label={t("search")}
              size="small"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
              }}
            />
            <List aria-label={t("results")} dense>
              {records.map((item) => (
                <ListItemButton
                  key={item.id}
                  onClick={() => {
                    setRecord(item);
                    setUnchecked(new Set());
                  }}
                >
                  <ListItemText primary={item.label ?? item.id} />
                </ListItemButton>
              ))}
            </List>
            {!lookup.isLoading && records.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("noResults")}
              </Typography>
            )}
          </>
        ) : (
          <PrefillMappingTable
            recordLabel={record.label ?? record.id}
            rows={rows}
            checked={checked}
            onToggle={(fieldKey, isChecked) => {
              const next = new Set(unchecked);
              if (isChecked) {
                next.delete(fieldKey);
              } else {
                next.add(fieldKey);
              }
              setUnchecked(next);
            }}
            onBack={() => {
              setRecord(null);
            }}
          />
        )}
      </Stack>
    </Dialog>
  );
};
