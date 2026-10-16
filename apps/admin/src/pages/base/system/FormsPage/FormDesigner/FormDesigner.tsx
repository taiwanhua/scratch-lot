import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type FormFieldsFragment,
  useCreateFormVersionDraftMutation,
  useFormVersionQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { FormRenderer } from "@/components/base/form-engine/FormRenderer/FormRenderer";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { definitionOf } from "@/lib/base/form-engine/definition";
import { liveContextOf } from "@/lib/base/form-engine/expression-context";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

import { DesignerWorkspace } from "./DesignerWorkspace";

export interface FormDesignerProps {
  form: FormFieldsFragment;
  onChanged: () => void;
}

const VIEW_CONTEXT = liveContextOf(null, null, new Date(0));

/**
 * 設計頁籤的外層 gate(REACT-08):有草稿才掛設計器(初始值取一次);沒有草稿時,改得動的人
 * 「開新草稿」(以目前版本為基底;還沒發布過就是空白草稿)。改不動的人(分派來的共用表單)只看目前版本的定義。
 */
export const FormDesigner = ({ form, onChanged }: FormDesignerProps) => {
  const t = useTranslations("admin.forms.designer");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [reloadKey, setReloadKey] = useState(0);
  const canEdit = form.abilities.canEdit;
  const draftQuery = useFormVersionQuery(
    session.client,
    { formKey: form.key },
    { enabled: form.hasDraft && canEdit, retry: false },
  );
  const currentQuery = useFormVersionQuery(
    session.client,
    { formKey: form.key, version: form.currentVersion ?? 0 },
    {
      enabled:
        !canEdit &&
        form.currentVersion !== null &&
        form.currentVersion !== undefined,
      retry: false,
    },
  );
  const createDraft = useCreateFormVersionDraftMutation(
    session.client,
    useMutationFeedback({
      success: t("draftCreated"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onChanged,
    }),
  );

  if (!canEdit) {
    const current = currentQuery.data?.formVersion.formVersion;
    return current === undefined ? (
      <Typography variant="body2" color="text.secondary">
        {t("readonlyEmpty")}
      </Typography>
    ) : (
      <Stack spacing={2}>
        <Alert severity="info">{t("readonlyHint")}</Alert>
        <FormRenderer
          version={definitionOf(current)}
          values={{}}
          mode="design"
          context={{ formKey: form.key, version: current.version ?? null }}
          expressionContext={VIEW_CONTEXT}
        />
      </Stack>
    );
  }

  if (!form.hasDraft) {
    return (
      <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
        <Typography variant="body2" color="text.secondary">
          {t("noDraft")}
        </Typography>
        <Button
          disabled={createDraft.isPending}
          onClick={() => {
            createDraft.mutate({
              input: {
                formKey: form.key,
                ...(form.currentVersion !== null &&
                  form.currentVersion !== undefined && {
                    baseVersion: form.currentVersion,
                  }),
              },
            });
          }}
        >
          {t("newDraft")}
        </Button>
      </Stack>
    );
  }

  if (draftQuery.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  const draft = draftQuery.data?.formVersion.formVersion;
  if (draft === undefined) {
    return (
      <Alert severity="error">
        {tErrors(
          draftQuery.error === null
            ? "NOT_FOUND"
            : formErrorOf(draftQuery.error).code,
        )}
      </Alert>
    );
  }

  return (
    <DesignerWorkspace
      key={`${draft.id}:${String(reloadKey)}`}
      form={form}
      draft={draft}
      onSaved={onChanged}
      onReload={() => {
        void queryClient
          .invalidateQueries({
            queryKey: useFormVersionQuery.getKey({ formKey: form.key }),
          })
          .then(() => {
            setReloadKey((current) => current + 1);
          });
      }}
    />
  );
};
