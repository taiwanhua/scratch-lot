import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import type {
  ExpressionContext,
  FormDefinition,
  StoredValues,
} from "@repo/domain/form";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useFillValues } from "@/hooks/base/useFillValues";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import type { FieldPermissionFacts } from "@/lib/base/form-engine/field-states";
import {
  type FormError,
  isCapacityError,
} from "@/lib/base/form-engine/form-errors";

import { FormRenderer } from "../FormRenderer/FormRenderer";
import { LookupDialog } from "../LookupDialog/LookupDialog";

export interface FormFillFormProps {
  /** 頁面標題(「新增 — 表單名」);與「帶入資料」同一列 */
  title: ReactNode;
  /** 標題列下方的提示(被退回 / 已撤回的說明) */
  notice?: ReactNode;
  definition: FormDefinition;
  formKey: string;
  version: number;
  initialValues: StoredValues;
  /** 使用者碰過的欄位(草稿的 `touched[]`;新增為空) */
  initialTouched?: readonly string[];
  /** 預設值跟著依賴重算(新增、還沒送出過的草稿);見 `useFillValues` */
  recomputeDefaults: boolean;
  /** 一打開就填預設值(新增頁) */
  fillDefaultsOnMount: boolean;
  /** 引用欄預設值(填寫者 / 填寫者的組織)的暫時顯示名 */
  systemLabels?: { user: string | null; org: string | null };
  mode: "create" | "edit";
  permissions: FieldPermissionFacts;
  expressionContext: ExpressionContext;
  /** 未完成(新增、草稿、被退回 / 撤回):[存草稿](`canSaveDraft` 時)+ [送出];已完成:只有「儲存修改」 */
  isCompleted: boolean;
  /** 顯示 [存草稿](表單設定「允許存草稿」;關掉時只有 [送出]);不給 = true */
  canSaveDraft?: boolean;
  isPending: boolean;
  error: FormError | null;
  /** `touched` = 使用者碰過的欄位 key(存草稿時一併存,預設值不再覆蓋它們) */
  onSaveDraft: (values: StoredValues, touched: readonly string[]) => void;
  onSubmit: (values: StoredValues, touched: readonly string[]) => void;
  onCancel: () => void;
  /** 409 時的「重新載入」 */
  onReload: () => void;
  /** 渲染的是表單目前版本(分區收合紀錄才清掉已不存在的分區);不給 = false */
  isCurrentVersion?: boolean;
  /** 頁籤 / 標題:以正在輸入的值即時算(`useTabLabelRenderer`);不給就不動頁籤 */
  tabLabelOf?: (values: StoredValues) => string | null;
}

/**
 * 新增 / 編輯的表單本體:`FormRenderer` + 「帶入資料」(版本有帶入規則時)+
 * 存草稿 / 送出(「送出」一個請求完成;表單關了「允許存草稿」時沒有 [存草稿];已完成的單只有「儲存修改」,修訂 +1)。
 *
 * 初始值由外層 gate 後帶進 `useState` 的初始化器(REACT-08);`values` 是整張表單的狀態,
 * 看不到的欄位原樣保留 `"[redacted]"` 送回(api 視為沒動)。預設值與「碰過」旗標在 `useFillValues`:
 * 沒碰過的欄位依賴變了就重算預設值,碰過(改過、清空、帶入)就停。
 */
export const FormFillForm = ({
  title,
  notice,
  definition,
  formKey,
  version,
  initialValues,
  initialTouched = [],
  recomputeDefaults,
  fillDefaultsOnMount,
  systemLabels,
  mode,
  permissions,
  expressionContext,
  isCompleted,
  canSaveDraft = true,
  isPending,
  error,
  onSaveDraft,
  onSubmit,
  onCancel,
  onReload,
  tabLabelOf,
  isCurrentVersion = false,
}: FormFillFormProps) => {
  const t = useTranslations("admin.formEngine.fill");
  const tErrors = useTranslations("admin.formEngine.errors");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const fill = useFillValues({
    fields: definition.fields,
    initialValues,
    initialTouched,
    ctx: expressionContext,
    permissions,
    recomputeDefaults,
    fillOnMount: fillDefaultsOnMount,
    ...(systemLabels !== undefined && { systemLabels }),
  });
  const { values } = fill;
  useRouteTabItemLabel(tabLabelOf?.(values));
  const [isPrefilling, setIsPrefilling] = useState(false);
  const canPrefill = definition.prefills.length > 0;

  return (
    <Stack spacing={2.5}>
      {/* 標題列:標題靠左、「帶入資料」同一列靠右 */}
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Typography variant="h6" component="h1" sx={{ flex: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {canPrefill && (
          <Button
            variant="outlined"
            onClick={() => {
              setIsPrefilling(true);
            }}
          >
            {t("prefill")}
          </Button>
        )}
      </Stack>
      {notice}
      <FormRenderer
        version={definition}
        values={values}
        mode={mode}
        context={{ formKey, version }}
        expressionContext={expressionContext}
        permissions={permissions}
        onChange={fill.change}
        fieldErrors={error?.fieldErrors ?? []}
        pruneMissingSections={isCurrentVersion}
      />
      {/* 容量上限(修訂次數 / 文件大小)已由 Snackbar 告知,這裡不重複 */}
      {error !== null &&
        !isCapacityError(error) &&
        (error.code === "CONFLICT" ? (
          <Alert
            severity="warning"
            action={
              <Button variant="text" size="small" onClick={onReload}>
                {t("reload")}
              </Button>
            }
          >
            {tErrors("CONFLICT")}
          </Alert>
        ) : (
          <Alert severity="error">{errorText(error)}</Alert>
        ))}
      <FormActions
        cancel={{ label: t("cancel"), onClick: onCancel }}
        {...(!isCompleted &&
          canSaveDraft && {
            draft: {
              label: t("saveDraft"),
              disabled: isPending,
              onClick: () => {
                onSaveDraft(values, fill.touched);
              },
            },
          })}
        submit={
          isCompleted
            ? {
                label: t("saveChanges"),
                disabled: isPending,
                onClick: () => {
                  onSaveDraft(values, fill.touched);
                },
              }
            : {
                label: t("submit"),
                disabled: isPending,
                onClick: () => {
                  onSubmit(values, fill.touched);
                },
              }
        }
      />
      {isPrefilling && (
        <LookupDialog
          definition={definition}
          formKey={formKey}
          version={version}
          values={values}
          canEdit={permissions.canEdit}
          onApply={(patch) => {
            // 帶入 = 使用者的動作:帶進來的欄位算碰過,預設值不再覆蓋
            fill.change({ ...values, ...patch });
            setIsPrefilling(false);
          }}
          onClose={() => {
            setIsPrefilling(false);
          }}
        />
      )}
    </Stack>
  );
};
