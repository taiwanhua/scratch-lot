import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type CreateRoleMutation,
  type UpdateRoleMutation,
  useCreateRoleMutation,
  useUpdateRoleMutation,
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
  type RoleManagerErrorCode,
  roleManagerErrorOf,
} from "../role-manager-error";
import type { RoleRow } from "../role-manager-types";
import { useOwnerOrgOptions } from "../useOwnerOrgOptions";

export interface RoleFormDialogProps {
  /** null = 新增;有值 = 編輯(擁有組織建立後不可改,ADR-0003) */
  role: RoleRow | null;
  onCancel: () => void;
  onSaved: (roleId: string) => void;
}

/**
 * 新增 / 編輯角色(Figma 62:154)。新增才選擁有組織(限管理範圍、預設當前組織),
 * 欄位下的固定提示說明它是管轄邊界;編輯只改名稱與描述(`updateRole` 的範圍,GQL-06)。
 * 初始值由 props 帶進 `useState`,彈窗關閉即卸載(REACT-08)。
 */
export const RoleFormDialog = ({
  role,
  onCancel,
  onSaved,
}: RoleFormDialogProps) => {
  const t = useTranslations("admin.roleManager.form");
  const tErrors = useTranslations("admin.roleManager.errors");
  const tFeedback = useTranslations("admin.roleManager.feedback");
  const { session } = useSession();
  const orgs = useOwnerOrgOptions();

  const [name, setName] = useState(() => role?.name ?? "");
  const [description, setDescription] = useState(() => role?.description ?? "");
  const [ownerOrgId, setOwnerOrgId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<RoleManagerErrorCode | null>(null);

  const isEdit = role !== null;
  /** 組織清單是非同步的,所以「還沒選過」時才回退到預設值(不在 effect 內補,REACT-06) */
  const pickedOrgId = ownerOrgId ?? orgs.defaultOrgId;

  const onError = (error: unknown) => {
    setErrorCode(roleManagerErrorOf(error).code);
  };
  const feedbackError = (error: unknown) =>
    tErrors(roleManagerErrorOf(error).code);

  const createRole = useCreateRoleMutation(
    session.client,
    useMutationFeedback<CreateRoleMutation>({
      success: tFeedback("createSuccess"),
      error: feedbackError,
      onSuccess: (payload) => {
        onSaved(payload.createRole.role.id);
      },
      onError,
    }),
  );
  const updateRole = useUpdateRoleMutation(
    session.client,
    useMutationFeedback<UpdateRoleMutation>({
      success: tFeedback("updateSuccess"),
      error: feedbackError,
      onSuccess: (payload) => {
        onSaved(payload.updateRole.role.id);
      },
      onError,
    }),
  );

  const isSubmitting = createRole.isPending || updateRole.isPending;
  const submit = () => {
    setErrorCode(null);
    if (name.trim() === "") {
      setErrorCode("VALIDATION_FAILED");
      return;
    }
    if (role === null) {
      createRole.mutate({
        input: {
          name: name.trim(),
          description: description.trim() === "" ? null : description.trim(),
          ...(pickedOrgId === "" ? {} : { ownerOrgId: pickedOrgId }),
        },
      });
      return;
    }
    updateRole.mutate({
      input: {
        id: role.id,
        name: name.trim(),
        // GQL-06:description 送 null = 清空
        description: description.trim() === "" ? null : description.trim(),
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={isEdit ? t("editTitle", { name: role.name }) : t("createTitle")}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button disabled={isSubmitting} onClick={submit}>
            {isEdit ? t("submitEdit") : t("submitCreate")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {isEdit ? (
          <TextField
            label={t("ownerOrg")}
            value={role.ownerOrg?.name ?? t("noOrg")}
            disabled
            size="small"
          />
        ) : (
          <SelectField
            label={t("ownerOrg")}
            size="small"
            value={pickedOrgId}
            helperText={t("ownerOrgHint")}
            options={orgs.options.map((option) => ({
              value: option.id,
              label: option.path,
              disabled: option.outOfScope,
            }))}
            onChange={setOwnerOrgId}
          />
        )}
        <TextField
          label={t("name")}
          value={name}
          size="small"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextField
          label={t("description")}
          value={description}
          size="small"
          multiline
          minRows={2}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
