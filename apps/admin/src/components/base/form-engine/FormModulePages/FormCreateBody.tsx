import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import type { FormDefinition } from "@repo/domain/form";

import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useMe } from "@/hooks/base/useMe";
import type { ModuleFormSummary } from "@/hooks/base/useModuleForms";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { liveContextOf } from "@/lib/base/form-engine/expression-context";
import {
  permissionsFromHeld,
  permissionsOfSubmission,
} from "@/lib/base/form-engine/field-permissions";

import { FormFillForm } from "./FormFillForm";
import type { FormModuleAccess } from "./useFormModuleAccess";
import { useTabLabelRenderer } from "./useTabLabelRenderer";

export interface FormCreateBodyProps {
  moduleKey: string;
  form: ModuleFormSummary;
  definition: FormDefinition;
  access: FormModuleAccess;
  onLeave: () => void;
}

/**
 * 新增的本體(外層已 gate 好表單與版本定義)。欄位級權限:草稿還沒建之前由持有的權限 key 推,
 * 建了之後用 api 算的 `fieldStates` / `abilities`(docs/modules/forms.md「讀取投影」)。
 * 送出成功 → 詳情頁(沒綁詳情頁就回列表);存草稿成功留在原頁,之後的寫入都針對同一筆草稿。
 */
export const FormCreateBody = ({
  moduleKey,
  form,
  definition,
  access,
  onLeave,
}: FormCreateBodyProps) => {
  const t = useTranslations("admin.formEngine.fill");
  const navigate = useNavigate();
  const me = useMe();
  const { hasPermission } = usePermissions();
  const showSnackbar = useSnackbar();
  const draft = useFormDraft(form.key);
  const [now] = useState(() => new Date());
  const user = me.data?.me;
  const timezone = useTenantTimezone();

  // 權限與 ctx 以 useMemo 保持身分穩定:`FormRenderer` 以它們為 memo 依賴
  const held = useMemo(
    () =>
      permissionsFromHeld({
        moduleKey,
        formKey: form.key,
        fields: definition.fields,
        hasPermission,
      }),
    [moduleKey, form.key, definition.fields, hasPermission],
  );
  const fromDraft = useMemo(
    () => (draft.draft === null ? null : permissionsOfSubmission(draft.draft)),
    [draft.draft],
  );
  const permissions = fromDraft ?? held;
  const userId = user?.id ?? null;
  const orgId = user?.currentOrg?.id ?? null;
  const expressionContext = useMemo(
    () => liveContextOf(userId, orgId, now, timezone),
    [userId, orgId, now, timezone],
  );
  // 頁籤 / 標題:以正在輸入的值即時算(`FormFillForm` 呼叫);建立者 = 自己
  const tabLabelOf = useTabLabelRenderer({
    moduleKey,
    formKey: form.key,
    formName: form.name,
    definition,
    action: "create",
    applicantName: user?.name,
  });
  const systemLabels = useMemo(
    () => ({ user: user?.name ?? null, org: user?.currentOrg?.name ?? null }),
    [user?.name, user?.currentOrg?.name],
  );

  return (
    <FormFillForm
      title={t("createTitle", { form: form.name })}
      definition={definition}
      formKey={form.key}
      version={form.currentVersion}
      initialValues={{}}
      recomputeDefaults
      fillDefaultsOnMount
      systemLabels={systemLabels}
      mode="create"
      permissions={permissions}
      expressionContext={expressionContext}
      isCompleted={false}
      isPending={draft.isPending}
      error={draft.error}
      onSaveDraft={(values, touched) => {
        void draft.saveDraft(values, touched).then((saved) => {
          if (saved !== null) {
            showSnackbar("success", t("draftSaved"));
          }
        });
      }}
      onSubmit={(values, touched) => {
        void draft.submit(values, touched).then((submitted) => {
          if (submitted === null) {
            return;
          }
          showSnackbar("success", t("submitted"));
          if (access.viewRoute === null) {
            onLeave();
          } else {
            void navigate(`${access.viewRoute}/${submitted.id}`);
          }
        });
      }}
      onCancel={onLeave}
      onReload={() => {
        if (draft.draft !== null && access.editRoute !== null) {
          void navigate(`${access.editRoute}/${draft.draft.id}`);
        }
      }}
      tabLabelOf={tabLabelOf}
    />
  );
};
