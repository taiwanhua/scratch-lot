import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type RoleUserCandidatesQuery,
  useRoleUserCandidatesQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Autocomplete } from "@repo/ui/autocomplete";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";

import type { RoleManagerErrorCode } from "../role-manager-error";
import {
  ROLE_USER_CANDIDATES_PAGE_SIZE,
  type RoleRow,
} from "../role-manager-types";

/** 候選清單的一筆(`roleUserCandidates` 的 item)。 */
type Candidate = RoleUserCandidatesQuery["roleUserCandidates"]["items"][number];

export interface AddUsersDialogProps {
  role: RoleRow;
  isSubmitting: boolean;
  errorCode: RoleManagerErrorCode | null;
  onCancel: () => void;
  onConfirm: (userIds: readonly string[]) => void;
}

/**
 * 加入使用者(Figma 69:697)。清單來自 `roleUserCandidates`(#246 的 4):
 * 操作者**管理範圍**內、**尚未持有**這個角色的人,每筆自帶 `eligible`。
 *
 * **範圍外的人也列出來,只是勾不動**(#261 的 7):直接不列的話,找不到人的人只會覺得
 * 「這個人不見了」,而不知道是資格不符。資格由 api 算(`eligible`),前端不再自己走組織樹。
 *
 * #307:改用 `@repo/ui/autocomplete`,**關鍵字仍然丟回 api 查**(候選有分頁上限,
 * 前端手上不會是全量),所以走 `onInputChange` 這條路 —— 給了它 Autocomplete 就不再
 * 自己過濾一次,否則打第一個字就把「還沒換過來的那批 options」濾成空的。
 *
 * 權限:這支 query 掛在 `system.role-manager.assign-users` 底下 —— 在 #246 之前這裡借
 * `users`,連帶逼得這個彈窗需要 `system.user-manager.view`,能分配使用者的人卻打不開。
 * 判定權仍在 api:送出時 `grantRoleUsers` 會回 `USER_NOT_ELIGIBLE`。
 */
export const AddUsersDialog = ({
  role,
  isSubmitting,
  errorCode,
  onCancel,
  onConfirm,
}: AddUsersDialogProps) => {
  const t = useTranslations("admin.roleManager.addUsers");
  const tErrors = useTranslations("admin.roleManager.errors");
  const { session } = useSession();
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<Candidate[]>([]);

  const ownerOrgName = role.ownerOrg?.name ?? t("noOrg");

  const candidatesQuery = useRoleUserCandidatesQuery(session.client, {
    roleId: role.id,
    input: {
      page: 1,
      pageSize: ROLE_USER_CANDIDATES_PAGE_SIZE,
      keyword: keyword.trim() === "" ? null : keyword.trim(),
    },
  });
  const candidates: readonly Candidate[] =
    candidatesQuery.data?.roleUserCandidates.items ?? [];

  /**
   * 選單只給「這一批」候選,已選但不在這批裡的(關鍵字換過)仍要留在值裡,
   * 否則打字一次就把選好的人清光。
   */
  const options: Candidate[] = [
    ...picked,
    ...candidates.filter(
      (candidate) => !picked.some((one) => one.id === candidate.id),
    ),
  ];

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="sm"
      title={t("title", { name: role.name, org: ownerOrgName })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            disabled={picked.length === 0 || isSubmitting}
            onClick={() => {
              onConfirm(picked.map((candidate) => candidate.id));
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <Autocomplete<Candidate, true>
          multiple
          size="small"
          label={t("label")}
          placeholder={t("searchPlaceholder")}
          options={options}
          value={picked}
          loading={candidatesQuery.isFetching}
          loadingText={t("loading")}
          noOptionsText={t("empty")}
          getOptionKey={(candidate) => candidate.id}
          getOptionLabel={(candidate) =>
            t("candidate", {
              account: candidate.account,
              name: candidate.name,
              orgs:
                candidate.orgs.length === 0
                  ? t("noOrg")
                  : candidate.orgs.map((org) => org.name).join("、"),
            })
          }
          getOptionDisabled={(candidate) => !candidate.eligible}
          getOptionDisabledReason={() =>
            t("notEligible", { org: ownerOrgName })
          }
          onInputChange={setKeyword}
          onChange={setPicked}
        />
        <Typography variant="caption" color="text.secondary">
          {t("hint", { org: ownerOrgName })}
        </Typography>
        <Typography variant="body2">
          {t("picked", { count: picked.length })}
        </Typography>
        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
