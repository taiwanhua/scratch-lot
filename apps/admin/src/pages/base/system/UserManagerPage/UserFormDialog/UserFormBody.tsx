import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type CreateUserMutation,
  type UpdateUserMutation,
  UserActivationMode,
  type UserQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useUserQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { type OrgNodeLike, flattenOrgs } from "@/lib/base/org-tree";

import { OrgPickerDialog } from "../OrgPickerDialog/OrgPickerDialog";
import { userManagerErrorOf } from "../user-manager-error";
import type { UserActionAbility } from "../user-manager-types";
import { ActivationFields } from "./ActivationFields";
import { UserBasicFields } from "./UserBasicFields";
import { UserOrgsField } from "./UserOrgsField";
import { type UserFormValues, useUserForm } from "./useUserForm";

/** 選填欄位:空字串送 null(api 以 null 代表清空)。 */
const blank = (value: string) => (value.trim() === "" ? null : value.trim());

export interface UserFormBodyProps {
  /** 編輯模式帶使用者 id;新增模式為 null */
  userId: string | null;
  title: string;
  initialValues: UserFormValues;
  initialOrgIds: readonly string[];
  orgNodes: readonly OrgNodeLike[];
  isOrgTreeAvailable: boolean;
  ability: UserActionAbility;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 新增 / 編輯使用者的表單本體(Figma 202:728 / 86:162 是同一個彈窗的兩個模式)。
 * 只在初始值備齊後才掛載(編輯模式要先取單筆),所以表單狀態用 `useState` 初始化即可。
 */
export const UserFormBody = ({
  userId,
  title,
  initialValues,
  initialOrgIds,
  orgNodes,
  isOrgTreeAvailable,
  ability,
  onClose,
  onSaved,
}: UserFormBodyProps) => {
  const t = useTranslations("admin.userManager.form");
  // 成功提示在頁層級的 `admin.userManager.feedback`,不在 `form` 底下(死鍵測試抓到的誤指)
  const tFeedback = useTranslations("admin.userManager.feedback");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isCreate = userId === null;
  const form = useUserForm({
    initialValues,
    initialOrgIds,
    hasActivation: isCreate,
  });
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isPickingOrgs, setIsPickingOrgs] = useState(false);

  const onError = (error: unknown) => {
    const { code, fields = [] } = userManagerErrorOf(error);
    if (code === "VALIDATION_FAILED" && fields.length > 0) {
      setErrorText(t("errors.duplicate", { fields: fields.join("、") }));
      return;
    }
    setErrorText(
      code === "FORBIDDEN" ? t("errors.forbidden") : t("errors.unexpected"),
    );
  };

  /**
   * 失敗的 Snackbar 文案:這裡的錯誤解讀比表單那一份粗一級 —— 欄位級的
   * `VALIDATION_FAILED` 在表單內已經指名是哪幾欄,Snackbar 只講「這次沒存成功」。
   */
  const feedbackError = (error: unknown) => {
    const { code } = userManagerErrorOf(error);
    if (code === "FORBIDDEN") {
      return t("errors.forbidden");
    }
    return code === "VALIDATION_FAILED"
      ? t("errors.required")
      : t("errors.unexpected");
  };

  const createUser = useCreateUserMutation(
    session.client,
    useMutationFeedback<CreateUserMutation>({
      success: tFeedback("createSuccess"),
      error: feedbackError,
      onSuccess: onSaved,
      onError,
    }),
  );
  const updateUser = useUpdateUserMutation(
    session.client,
    useMutationFeedback<UpdateUserMutation>({
      success: tFeedback("updateSuccess"),
      error: feedbackError,
      onSuccess: (payload) => {
        /**
         * DATA-04 的 (a) 步:把回傳的欄位併進 `user(id)` 的快取,再由 `onSaved` 失效清單與單筆。
         * 不寫的話,關掉彈窗馬上再按一次「編輯」看到的是舊值——
         * `UserFormDialog` 的初始值只取一次,重取回來時表單早就掛好了。
         * `updateUser` 的 payload 只有基本欄位(沒有 orgs / roles / enabled),所以是**併進**
         * 既有那一筆而不是整份覆寫;快取裡還沒有那一筆就什麼都不做(回 undefined)。
         */
        queryClient.setQueryData<UserQuery>(
          useUserQuery.getKey({ id: payload.updateUser.user.id }),
          (current) =>
            current === undefined
              ? undefined
              : { user: { ...current.user, ...payload.updateUser.user } },
        );
        onSaved();
      },
      onError,
    }),
  );
  const isSubmitting = createUser.isPending || updateUser.isPending;

  const selectedOrgs = flattenOrgs(orgNodes).filter((org) =>
    form.orgIds.includes(org.id),
  );

  const handleSubmit = () => {
    setErrorText(null);
    if (!form.isValid) {
      setErrorText(t("errors.required"));
      return;
    }
    const { values } = form;
    const base = {
      name: values.name.trim(),
      account: values.account.trim(),
      email: values.email.trim(),
      nickname: blank(values.nickname),
      gender: blank(values.gender),
      phone: blank(values.phone),
      address: blank(values.address),
      ...(ability.canEditNationalId
        ? { nationalId: blank(values.nationalId) }
        : {}),
    };

    if (userId === null) {
      createUser.mutate({
        input: {
          ...base,
          orgIds: [...form.orgIds],
          activation: {
            mode: form.activationMode,
            initialPassword:
              form.activationMode === UserActivationMode.Password
                ? form.initialPassword
                : null,
          },
        },
      });
      return;
    }
    updateUser.mutate({ input: { id: userId, ...base } });
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        title={title}
        actions={
          <>
            <Button variant="text" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button disabled={isSubmitting} onClick={handleSubmit}>
              {isCreate ? t("submitCreate") : t("submitEdit")}
            </Button>
          </>
        }
      >
        <Stack spacing={2.25}>
          <UserBasicFields
            form={form}
            canShowNationalId={ability.canShowNationalId}
            canEditNationalId={ability.canEditNationalId}
            isDisabled={isSubmitting}
          />
          {isCreate && (
            <ActivationFields form={form} isDisabled={isSubmitting} />
          )}
          <UserOrgsField
            orgs={selectedOrgs}
            isEditable={isCreate && isOrgTreeAvailable}
            onRemove={(orgId) => {
              form.setOrgIds(form.orgIds.filter((id) => id !== orgId));
            }}
            onPick={() => {
              setIsPickingOrgs(true);
            }}
          />
          {errorText !== null && <Alert severity="error">{errorText}</Alert>}
        </Stack>
      </Dialog>
      {isPickingOrgs && (
        <OrgPickerDialog
          title={t("orgs")}
          nodes={orgNodes}
          initialSelectedIds={form.orgIds}
          onCancel={() => {
            setIsPickingOrgs(false);
          }}
          onConfirm={(orgIds) => {
            form.setOrgIds(orgIds);
            setIsPickingOrgs(false);
          }}
        />
      )}
    </>
  );
};
