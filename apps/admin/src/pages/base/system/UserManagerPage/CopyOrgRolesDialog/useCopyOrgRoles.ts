import { useRef, useState } from "react";
import { useTranslations } from "use-intl";

import {
  CopyUserOrgRolesMode,
  type CopyUserOrgRolesMutation,
  type CopyUserOrgRolesMutationVariables,
  useCopyUserOrgRolesMutation,
} from "@repo/graphql";

import type { UserCandidate } from "@/components/base/UserPicker/useUserCandidates";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import {
  type UserManagerErrorCode,
  userManagerErrorOf,
} from "../user-manager-error";
import type { CopyUserOrgRolesResult, UserRow } from "../user-manager-types";

/** 預覽對應的是哪一組「目標 × 方式」;切換後舊的回應不算數(避免慢回來的覆蓋新的)。 */
const previewKeyOf = (targetId: string, mode: CopyUserOrgRolesMode) =>
  `${targetId}:${mode}`;

/**
 * 失敗只在彈窗內就地顯示(使用者正盯著這個彈窗),不再跳 Snackbar,
 * 同一句話不出現兩次(`useMutationFeedback` 的 `error` 回 null,DATA-06)。
 */
const noSnackbar = () => null;

/** 有沒有任何一項會變(新增或移除);只有保留 = 不需變更。 */
export const hasCopyChanges = (result: CopyUserOrgRolesResult): boolean =>
  result.orgs.added.length +
    result.orgs.removed.length +
    result.roles.added.length +
    result.roles.removed.length >
  0;

/**
 * 複製組織與角色的流程:選目標或切方式 → `copyUserOrgRoles(dryRun: true)` 重新預覽 →
 * 確認 → `dryRun: false` 正式送出(api 端重算重驗)。
 * 預覽是「還沒完成的操作」,成功不跳提示、失敗照跳(同 `useUserOrgsFlow` 的試算)。
 */
export const useCopyOrgRoles = (
  source: UserRow,
  onCopied: (targetId: string) => void,
) => {
  const t = useTranslations("admin.userManager");
  const { session } = useSession();
  const [target, setTarget] = useState<UserCandidate | null>(null);
  const [mode, setMode] = useState<CopyUserOrgRolesMode>(
    CopyUserOrgRolesMode.Merge,
  );
  const [preview, setPreview] = useState<{
    key: string;
    result: CopyUserOrgRolesResult;
  } | null>(null);
  /** 最近一次送出預覽的「目標 × 方式」;回應回來時比對它,被丟棄的舊回應不寫入 */
  const latestPreviewKey = useRef<string | null>(null);
  /** 預覽失敗也以「目標 × 方式」為鍵:切換後才回來的舊失敗不算數 */
  const [previewFailure, setPreviewFailure] = useState<{
    key: string;
    code: UserManagerErrorCode;
  } | null>(null);
  const [submitError, setSubmitError] = useState<UserManagerErrorCode | null>(
    null,
  );

  const previewMutation = useCopyUserOrgRolesMutation(
    session.client,
    useMutationFeedback<
      CopyUserOrgRolesMutation,
      CopyUserOrgRolesMutationVariables
    >({
      success: null,
      error: noSnackbar,
      onSuccess: (data, variables) => {
        setPreview({
          key: previewKeyOf(variables.input.targetUserId, variables.input.mode),
          result: data.copyUserOrgRoles,
        });
      },
      onError: (error, variables) => {
        const key = previewKeyOf(
          variables.input.targetUserId,
          variables.input.mode,
        );
        if (key !== latestPreviewKey.current) {
          return;
        }
        setPreviewFailure({ key, code: userManagerErrorOf(error).code });
      },
    }),
  );

  const submitMutation = useCopyUserOrgRolesMutation(
    session.client,
    useMutationFeedback<
      CopyUserOrgRolesMutation,
      CopyUserOrgRolesMutationVariables
    >({
      success: t("feedback.copyOrgRolesSuccess", { name: target?.name ?? "" }),
      error: noSnackbar,
      onSuccess: (data) => {
        onCopied(data.copyUserOrgRoles.user.id);
      },
      onError: (error) => {
        setSubmitError(userManagerErrorOf(error).code);
      },
    }),
  );

  const requestPreview = (
    nextTarget: UserCandidate | null,
    nextMode: CopyUserOrgRolesMode,
  ) => {
    setSubmitError(null);
    setPreviewFailure(null);
    if (nextTarget === null) {
      latestPreviewKey.current = null;
      return;
    }
    latestPreviewKey.current = previewKeyOf(nextTarget.id, nextMode);
    previewMutation.mutate({
      input: {
        sourceUserId: source.id,
        targetUserId: nextTarget.id,
        mode: nextMode,
        dryRun: true,
      },
    });
  };

  const selectTarget = (user: UserCandidate | null) => {
    setTarget(user);
    requestPreview(user, mode);
  };

  const selectMode = (nextMode: CopyUserOrgRolesMode) => {
    setMode(nextMode);
    requestPreview(target, nextMode);
  };

  const currentKey = target === null ? null : previewKeyOf(target.id, mode);
  const currentPreview =
    currentKey !== null && preview?.key === currentKey ? preview.result : null;
  const previewError =
    currentKey !== null && previewFailure?.key === currentKey
      ? previewFailure.code
      : null;
  const isPreviewing = previewMutation.isPending;
  const canConfirm =
    currentPreview !== null &&
    !isPreviewing &&
    !submitMutation.isPending &&
    currentPreview.blockers.length === 0 &&
    hasCopyChanges(currentPreview);

  const confirm = () => {
    if (!canConfirm || target === null) {
      return;
    }
    setSubmitError(null);
    submitMutation.mutate({
      input: {
        sourceUserId: source.id,
        targetUserId: target.id,
        mode,
        dryRun: false,
      },
    });
  };

  return {
    target,
    mode,
    preview: currentPreview,
    isPreviewing,
    isSubmitting: submitMutation.isPending,
    canConfirm,
    /** 這組預覽失敗了(彈窗不再顯示「計算中」) */
    hasPreviewFailed: previewError !== null,
    /** 就地顯示的錯誤:正式送出的失敗優先,其次是目前這組預覽的失敗 */
    errorCode: submitError ?? previewError,
    selectTarget,
    selectMode,
    confirm,
  };
};
