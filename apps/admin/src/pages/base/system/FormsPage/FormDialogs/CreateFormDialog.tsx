import { useState } from "react";
import { useTranslations } from "use-intl";

import { isValidFormKey } from "@repo/domain/form-keys";
import {
  type CreateFormMutation,
  ModuleEngine,
  useCreateFormMutation,
  useFormEngineModulesQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";

export interface CreateFormDialogProps {
  onClose: () => void;
  onCreated: (formKey: string) => void;
}

/**
 * 建立共用表單(只有站在根組織;`createForm`)。表單 key **建立後不可改**,
 * 格式 `^[a-z][a-z0-9_]{0,39}$`(不准 `.` 與 `-`,欄位級權限 key 才拆得回來)。
 * 所屬模組只列表單模組(`engine = FORM`)。
 */
export const CreateFormDialog = ({
  onClose,
  onCreated,
}: CreateFormDialogProps) => {
  const t = useTranslations("admin.forms.create");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const modules = useFormEngineModulesQuery(session.client);
  const formModules = (modules.data?.me.modules ?? []).filter(
    (module) => module.engine === ModuleEngine.Form,
  );
  const isKeyValid = isValidFormKey(key);

  const create = useCreateFormMutation(
    session.client,
    useMutationFeedback<CreateFormMutation>({
      success: t("success"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: (payload) => {
        onCreated(payload.createForm.form.key);
      },
      onError: (failure) => {
        setError(formErrorOf(failure));
      },
    }),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={
              !isKeyValid ||
              name.trim() === "" ||
              moduleKey === "" ||
              create.isPending
            }
            onClick={() => {
              setError(null);
              create.mutate({ input: { key, name: name.trim(), moduleKey } });
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label={t("key")}
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
          }}
          error={key !== "" && !isKeyValid}
          helperText={t("keyHint")}
          size="small"
          required
        />
        <TextField
          label={t("name")}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          size="small"
          required
        />
        <SelectField
          label={t("module")}
          value={moduleKey}
          displayEmpty
          options={[
            { value: "", label: t("moduleUnset") },
            ...formModules.map((module) => ({
              value: module.key,
              label: module.name,
            })),
          ]}
          onChange={setModuleKey}
          size="small"
          required
        />
        {error !== null && (
          <Alert severity="error">{tErrors(error.code)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
