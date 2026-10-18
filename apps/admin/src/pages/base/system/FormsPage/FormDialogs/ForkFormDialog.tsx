import { useState } from "react";
import { useTranslations } from "use-intl";

import { isValidFormKey } from "@repo/domain/form-keys";
import {
  type ForkFormMutation,
  type FormFieldsFragment,
  FormVersionStatus,
  useForkFormMutation,
  useFormVersionsQuery,
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

export interface ForkFormDialogProps {
  source: FormFieldsFragment;
  onClose: () => void;
  onForked: (formKey: string) => void;
}

/**
 * 以此為基底建新表單(`forkForm`):挑來源的某個**已發布或已退役**版本,
 * 填新表單的 key(建立後不可改)與名稱;同模組。租戶建出來的是客製表單(只有自己的租戶看得到,
 * 自動在本租戶啟用),root 建出來的仍是共用表單。新表單帶一份以該版為基底的草稿。
 */
export const ForkFormDialog = ({
  source,
  onClose,
  onForked,
}: ForkFormDialogProps) => {
  const t = useTranslations("admin.forms.fork");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const versions = useFormVersionsQuery(session.client, {
    formKey: source.key,
  });
  const bases = (versions.data?.formVersions.items ?? []).filter(
    (item) =>
      item.version !== null &&
      item.version !== undefined &&
      (item.status === FormVersionStatus.Published ||
        item.status === FormVersionStatus.Retired),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const baseVersion =
    picked ??
    (source.currentVersion === null || source.currentVersion === undefined
      ? String(bases.at(0)?.version ?? "")
      : String(source.currentVersion));
  const [key, setKey] = useState(`${source.key}_`);
  const [name, setName] = useState(source.name);
  const [error, setError] = useState<FormError | null>(null);
  const isKeyValid = isValidFormKey(key);

  const fork = useForkFormMutation(
    session.client,
    useMutationFeedback<ForkFormMutation>({
      success: t("success"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: (payload) => {
        onForked(payload.forkForm.form.key);
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
      title={t("title", { name: source.name })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={
              !isKeyValid ||
              name.trim() === "" ||
              baseVersion === "" ||
              fork.isPending
            }
            onClick={() => {
              setError(null);
              fork.mutate({
                input: {
                  sourceKey: source.key,
                  sourceVersion: Number(baseVersion),
                  key,
                  name: name.trim(),
                },
              });
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <SelectField
          label={t("baseVersion")}
          value={baseVersion}
          options={bases.map((item) => ({
            value: String(item.version),
            label: t("versionOption", {
              version: item.version ?? 0,
              status: item.status,
            }),
          }))}
          onChange={setPicked}
          size="small"
        />
        <TextField
          label={t("key")}
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
          }}
          error={!isKeyValid}
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
        {error !== null && (
          <Alert severity="error">{tErrors(error.code)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
