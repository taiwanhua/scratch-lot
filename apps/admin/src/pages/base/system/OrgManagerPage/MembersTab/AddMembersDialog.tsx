import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type OrgMemberCandidatesQuery,
  useOrgMemberCandidatesQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Autocomplete } from "@repo/ui/autocomplete";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";

import type { OrgManagerErrorCode } from "../org-manager-error";
import { ORG_MEMBER_CANDIDATES_PAGE_SIZE } from "../org-manager-types";

/** 候選清單的一筆(`orgMemberCandidates` 的 item)。 */
type Candidate =
  OrgMemberCandidatesQuery["orgMemberCandidates"]["items"][number];

export interface AddMembersDialogProps {
  orgId: string;
  orgName: string;
  isSubmitting: boolean;
  errorCode: OrgManagerErrorCode | null;
  onCancel: () => void;
  onConfirm: (userIds: readonly string[]) => void;
}

/**
 * 加入成員(#377)。清單來自 `orgMemberCandidates`:操作者**管理範圍**內、
 * **尚未加入**這個組織的使用者 —— 守在 `system.org-manager.add-members` 底下,
 * 不借使用者管理的 `users`(借了會讓這個彈窗連帶需要 `system.user-manager.view`,#246 踩過)。
 *
 * **關鍵字丟回 api 查**(候選有分頁上限,前端手上不會是全量),所以走 `onInputChange` 這條路 ——
 * 給了它 Autocomplete 就不再自己過濾一次,否則打第一個字就把「還沒換過來的那批 options」濾成空的
 * (#307 在角色的「加入使用者」踩過)。
 */
export const AddMembersDialog = ({
  orgId,
  orgName,
  isSubmitting,
  errorCode,
  onCancel,
  onConfirm,
}: AddMembersDialogProps) => {
  const t = useTranslations("admin.orgManager.addMembers");
  const tErrors = useTranslations("admin.orgManager.errors");
  const { session } = useSession();
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<Candidate[]>([]);

  const candidatesQuery = useOrgMemberCandidatesQuery(session.client, {
    orgId,
    input: {
      page: 1,
      pageSize: ORG_MEMBER_CANDIDATES_PAGE_SIZE,
      keyword: keyword.trim() === "" ? null : keyword.trim(),
    },
  });
  const candidates: readonly Candidate[] =
    candidatesQuery.data?.orgMemberCandidates.items ?? [];

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
      title={t("title", { name: orgName })}
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
                candidate.otherOrgs.length === 0
                  ? t("noOrg")
                  : candidate.otherOrgs.map((org) => org.name).join("、"),
            })
          }
          onInputChange={setKeyword}
          onChange={setPicked}
        />
        <Typography variant="caption" color="text.secondary">
          {t("hint")}
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
