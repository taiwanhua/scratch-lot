import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type OrgQuery,
  type UserSummaryFieldsFragment,
  useMoveOrgMutation,
  useOrgManagersQuery,
  useOrgQuery,
  useSetOrgManagersMutation,
  useSetOrgTimezoneMutation,
  useSetOrgVisibilityMutation,
  useTransferOrgOwnerMutation,
  useUpdateOrgMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import type { OrgOption } from "@/lib/base/org-tree";

import { OrgLogoField } from "../OrgLogoField";
import {
  type OrgManagerErrorCode,
  orgManagerErrorOf,
} from "../org-manager-error";
import type { OrgActionAbility, OrgDetail } from "../org-manager-types";
import { useLogoUpload } from "../useLogoUpload";
import { ManagerField } from "./ManagerField";
import { type OwnerCandidate, TenantTopFields } from "./TenantTopFields";
import { TimezoneField } from "./TimezoneField";
import { useEditOrgForm } from "./useEditOrgForm";

export interface EditOrgDialogProps {
  org: OrgDetail;
  /** 可當新上層的組織(管理範圍內、同租戶、不含自己與自己的子樹;租戶頂層本身候選為空) */
  parentOptions: readonly OrgOption[];
  /** 這個組織是租戶頂層(api 只讓這一層有擁有者與可見範圍;時區則根組織也有) */
  isTenantTop: boolean;
  /** 租戶頂層 + 操作者是租戶內的人:搬移不給改(ADR-0009),上層組織欄的位置改放說明 */
  isTenantTopProtected: boolean;
  ownerCandidates: readonly OwnerCandidate[];
  ability: OrgActionAbility;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 編輯組織(Figma 88:168):名稱、描述、上層組織(搬移)、商標,租戶頂層再多擁有者與可見範圍;根組織與租戶頂層另有時區。
 *
 * 送出時**只打有變動的 mutation**,依序:商標上傳 → `updateOrg` → `moveOrg` →
 * `transferOrgOwner` → `setOrgVisibility` → `setOrgTimezone` → `setOrgManagers`(主管整組取代;根組織沒有這一欄)。任何一步失敗就停在那裡並顯示錯誤 —
 * 前面已成功的不回滾(它們各自是完整的動作、各自留了審計),重新送出只會補上還沒做的那幾步。
 */
export const EditOrgDialog = ({
  org,
  parentOptions,
  isTenantTop,
  isTenantTopProtected,
  ownerCandidates,
  ability,
  onClose,
  onSaved,
}: EditOrgDialogProps) => {
  const t = useTranslations("admin.orgManager.form");
  const tEdit = useTranslations("admin.orgManager.edit");
  const tActions = useTranslations("admin.orgManager.actions");
  const tErrors = useTranslations("admin.orgManager.errors");
  const tFeedback = useTranslations("admin.orgManager.feedback");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const form = useEditOrgForm(org);
  const { uploadLogo, isUploading } = useLogoUpload();

  const [errorCode, setErrorCode] = useState<OrgManagerErrorCode | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * 一次「儲存」會打好幾支 mutation,但對操作者而言只是一次操作 —— 所以回饋由整段
   * try / catch 自己報一次,而不是掛在每一支 mutation 的 options 上(
   * 掛上去會一次跳四則)。
   */
  const feedback = useMutationFeedback({
    success: tFeedback("updateSuccess"),
    error: (error: unknown) => tErrors(orgManagerErrorOf(error).code),
  });

  const updateOrg = useUpdateOrgMutation(session.client);
  const moveOrg = useMoveOrgMutation(session.client);
  const transferOwner = useTransferOrgOwnerMutation(session.client);
  const setVisibility = useSetOrgVisibilityMutation(session.client);
  const setTimezone = useSetOrgTimezoneMutation(session.client);
  const setManagers = useSetOrgManagersMutation(session.client);

  /**
   * 主管名單:`OrgManagers` 載入前不給編輯(免得把「還沒載到」當成「清空」送出)。
   * `pickedManagers` 為 null = 沒碰過,顯示目前名單;碰過才與目前名單比對要不要送。
   */
  const managersQuery = useOrgManagersQuery(
    session.client,
    { id: org.id },
    { enabled: !org.isSystem },
  );
  const currentManagers = managersQuery.data?.org.managers;
  const [pickedManagers, setPickedManagers] = useState<
    UserSummaryFieldsFragment[] | null
  >(null);
  const shownManagers = pickedManagers ?? currentManagers ?? [];
  const hasManagersChange =
    pickedManagers !== null &&
    currentManagers !== undefined &&
    pickedManagers.map((manager) => manager.id).join(",") !==
      currentManagers.map((manager) => manager.id).join(",");

  const isBusy = isSaving || isUploading;

  /**
   * 「上層組織」下拉只給搬得動的組織:根組織不可搬,租戶頂層的候選是空的(整棵子樹與別的租戶都被排除),
   * 它原本的上層也不在候選裡 —— 渲染出來只會是空白的下拉。租戶內的人編輯租戶頂層時改放一句說明。
   */
  const hasParentField = ability.canMove && !org.isSystem && !isTenantTop;
  const hasMove = hasParentField && form.changes.hasMove;

  const submit = async () => {
    setErrorCode(null);
    setIsSaving(true);
    try {
      const { changes } = form;
      if (changes.hasProfileChange) {
        // 沒碰過商標欄就不送 `logoPath`:api 把 `null` 當成「清空商標」,
        // 欄位缺席才是「不動它」
        const logoPath = form.isLogoTouched
          ? await uploadLogo(form.logoFile)
          : undefined;
        const payload = await updateOrg.mutateAsync({
          input: {
            id: org.id,
            name: form.name.trim(),
            description:
              form.description.trim() === "" ? null : form.description.trim(),
            ...(logoPath === undefined ? {} : { logoPath }),
            ...(changes.hasSlugChange ? { slug: form.slug.trim() } : {}),
          },
        });
        /**
         * DATA-04 的 (a) 步:把回傳的欄位併進 `org(id)` 的快取,再由 `onSaved` 失效
         * 樹 / 單筆 / `me`。不寫的話,右邊的詳情面板與「再開一次編輯」在重取回來之前
         * 都還是舊名稱。payload 只有 `name` / `description` / `logoUrl`,
         * 所以是**併進**既有那一筆;快取裡沒有那一筆就什麼都不做。
         */
        queryClient.setQueryData<OrgQuery>(
          useOrgQuery.getKey({ id: org.id }),
          (current) =>
            current === undefined
              ? undefined
              : { org: { ...current.org, ...payload.updateOrg.org } },
        );
      }
      if (hasMove) {
        await moveOrg.mutateAsync({
          input: { id: org.id, newParentId: form.parentId },
        });
      }
      if (changes.hasOwnerChange) {
        await transferOwner.mutateAsync({
          input: { orgId: org.id, newOwnerUserId: form.ownerUserId },
        });
      }
      if (changes.hasVisibilityChange) {
        await setVisibility.mutateAsync({
          input: { orgId: org.id, visibility: form.visibility },
        });
      }
      if (changes.hasTimezoneChange) {
        // 成功後由 `onSaved` 失效 `org(id)` 與 `me`:改的是自己的租戶時,
        // `me.currentOrg.timezone` 換掉,畫面上的日期時間跟著換算
        await setTimezone.mutateAsync({
          input: { orgId: org.id, timezone: form.timezone },
        });
      }
      if (hasManagersChange) {
        const payload = await setManagers.mutateAsync({
          input: {
            orgId: org.id,
            userIds: shownManagers.map((manager) => manager.id),
          },
        });
        // DATA-04 (a):回傳的名單直接換掉 `OrgManagers` 快取,詳情的「主管」列不必等重取
        queryClient.setQueryData(useOrgManagersQuery.getKey({ id: org.id }), {
          org: payload.setOrgManagers.org,
        });
      }
      feedback.onSuccess();
      onSaved();
    } catch (error) {
      feedback.onError(error);
      setErrorCode(orgManagerErrorOf(error).code);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={tEdit("title", { name: org.name })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!form.isValid || isBusy}
            onClick={() => {
              void submit();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.25}>
        <TextField
          label={t("name")}
          value={form.name}
          required
          fullWidth
          disabled={isBusy}
          onChange={(event) => {
            form.setName(event.target.value);
          }}
        />
        <TextField
          label={t("description")}
          value={form.description}
          fullWidth
          multiline
          minRows={2}
          disabled={isBusy}
          onChange={(event) => {
            form.setDescription(event.target.value);
          }}
        />
        {hasParentField && (
          <SelectField
            label={t("parent")}
            value={form.parentId}
            displayEmpty
            fullWidth
            disabled={isBusy}
            helperText={t("parentHint")}
            options={[
              { value: "", label: t("parentUnset") },
              ...parentOptions.map((option) => ({
                value: option.id,
                label: option.path,
              })),
            ]}
            onChange={form.setParentId}
          />
        )}
        {ability.canMove && isTenantTopProtected && (
          <Typography variant="caption" color="text.secondary">
            {tActions("tenantTopHint")}
          </Typography>
        )}
        <OrgLogoField
          file={form.logoFile}
          onFileChange={form.setLogoFile}
          initialPreviewUrl={org.logoUrl}
          isDisabled={isBusy}
        />
        {!org.isSystem && (
          <ManagerField
            orgId={org.id}
            value={shownManagers}
            isDisabled={isBusy || currentManagers === undefined}
            onChange={setPickedManagers}
          />
        )}
        {isTenantTop && (
          <TenantTopFields
            form={form}
            canTransferOwner={ability.canTransferOwner}
            canSetVisibility={ability.canSetVisibility}
            candidates={ownerCandidates}
            isDisabled={isBusy}
          />
        )}
        {(isTenantTop || org.isSystem) && (
          <TimezoneField
            value={form.timezone}
            onChange={form.setTimezone}
            canSetTimezone={ability.canSetTimezone}
            isDisabled={isBusy}
          />
        )}
        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
