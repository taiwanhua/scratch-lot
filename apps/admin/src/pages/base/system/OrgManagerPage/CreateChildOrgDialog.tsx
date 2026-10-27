import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type CreateChildOrgMutation,
  useCreateChildOrgMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import {
  type OrgManagerErrorCode,
  orgManagerErrorOf,
} from "./org-manager-error";

export interface CreateChildOrgDialogProps {
  parentId: string;
  parentName: string;
  onClose: () => void;
  onCreated: (orgId: string) => void;
}

/**
 * 新增子組織(Figma 202:405):輕量入口,只有名稱與描述,掛在目前選中的組織底下。
 * **不觸發租戶開通流程**(那是根組織專屬的另一條線,ADR-0009)。
 * 彈窗關閉即卸載,所以初始值直接進 `useState`,不需要 effect 同步(REACT-06)。
 */
export const CreateChildOrgDialog = ({
  parentId,
  parentName,
  onClose,
  onCreated,
}: CreateChildOrgDialogProps) => {
  const t = useTranslations("admin.orgManager.createChild");
  const tForm = useTranslations("admin.orgManager.form");
  const tErrors = useTranslations("admin.orgManager.errors");
  const tFeedback = useTranslations("admin.orgManager.feedback");
  const { session } = useSession();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorCode, setErrorCode] = useState<OrgManagerErrorCode | null>(null);

  const createChildOrg = useCreateChildOrgMutation(
    session.client,
    useMutationFeedback<CreateChildOrgMutation>({
      success: tFeedback("createSuccess"),
      error: (error) => tErrors(orgManagerErrorOf(error).code),
      onSuccess: (payload) => {
        onCreated(payload.createChildOrg.org.id);
      },
      onError: (error) => {
        setErrorCode(orgManagerErrorOf(error).code);
      },
    }),
  );

  const isValid = name.trim() !== "";

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("title", { parent: parentName })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {tForm("cancel")}
          </Button>
          <Button
            disabled={!isValid || createChildOrg.isPending}
            onClick={() => {
              setErrorCode(null);
              createChildOrg.mutate({
                input: {
                  parentId,
                  name: name.trim(),
                  description:
                    description.trim() === "" ? null : description.trim(),
                },
              });
            }}
          >
            {t("submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.25}>
        <TextField
          label={tForm("name")}
          value={name}
          required
          fullWidth
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextField
          label={tForm("description")}
          value={description}
          fullWidth
          multiline
          minRows={2}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        <Typography variant="caption" color="textSecondary">
          {t("hint")}
        </Typography>
        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
