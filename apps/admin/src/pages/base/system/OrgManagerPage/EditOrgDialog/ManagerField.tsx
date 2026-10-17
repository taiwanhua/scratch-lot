import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type UserSummaryFieldsFragment,
  useOrgManagerCandidatesQuery,
} from "@repo/graphql";
import { Autocomplete } from "@repo/ui/autocomplete";

import { useSession } from "@/hooks/base/useSession";

export interface ManagerFieldProps {
  orgId: string;
  value: readonly UserSummaryFieldsFragment[];
  onChange: (managers: UserSummaryFieldsFragment[]) => void;
  isDisabled: boolean;
}

/**
 * 組織的「主管」欄(`org_manager`;審核流程的主管來源從申請所屬組織往上找它):多選本租戶的使用者。
 *
 * 候選來自 `orgManagerCandidates`(該組織所屬租戶裡啟用中的使用者,關鍵字丟回 api 查),
 * 所以走 `onInputChange` 關掉 Autocomplete 的前端過濾(同「加入成員」,#307 踩過);
 * 已選但不在這一批候選裡的人(停用的主管、關鍵字換過)仍留在值裡。
 */
export const ManagerField = ({
  orgId,
  value,
  onChange,
  isDisabled,
}: ManagerFieldProps) => {
  const t = useTranslations("admin.orgManager.form");
  const { session } = useSession();
  const [keyword, setKeyword] = useState("");
  const trimmed = keyword.trim();

  const candidatesQuery = useOrgManagerCandidatesQuery(session.client, {
    orgId,
    keyword: trimmed === "" ? null : trimmed,
  });
  const candidates = candidatesQuery.data?.orgManagerCandidates ?? [];
  const options: UserSummaryFieldsFragment[] = [
    ...value,
    ...candidates.filter(
      (candidate) => !value.some((picked) => picked.id === candidate.id),
    ),
  ];

  return (
    <Autocomplete<UserSummaryFieldsFragment, true>
      multiple
      label={t("managers")}
      placeholder={t("managersPlaceholder")}
      helperText={t("managersHint")}
      options={options}
      value={[...value]}
      disabled={isDisabled}
      fullWidth
      loading={candidatesQuery.isFetching}
      loadingText={t("managersLoading")}
      noOptionsText={t("managersEmpty")}
      getOptionKey={(manager) => manager.id}
      getOptionLabel={(manager) =>
        t("managerOption", { name: manager.name, account: manager.account })
      }
      onInputChange={setKeyword}
      onChange={onChange}
    />
  );
};
