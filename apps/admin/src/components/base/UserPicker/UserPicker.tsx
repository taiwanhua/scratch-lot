import { useTranslations } from "use-intl";

import { Autocomplete } from "@repo/ui/autocomplete";

import { type UserCandidate, useUserCandidates } from "./useUserCandidates";

export interface UserPickerProps {
  label: string;
  value: UserCandidate | null;
  onChange: (user: UserCandidate | null) => void;
  /** 不能選的人(申請人自己、已在本關的人);列出來但灰掉並寫原因 */
  disabledReasonOf?: (user: UserCandidate) => string | null;
  /** 停用的使用者也可以選(預設不行:列出來但灰掉寫「已停用」) */
  allowDisabled?: boolean;
  /** 完全不列出的人(如複製組織與角色的來源本人) */
  excludeUserIds?: readonly string[];
  helperText?: string;
}

/**
 * 選一位使用者(流程的改派 / 新增審核者、使用者管理的複製組織與角色):
 * 候選 = 操作者管理範圍內的使用者,關鍵字丟回 api 查。
 * 停用的人預設列出但不能選;`allowDisabled` 時照常可選。
 */
export const UserPicker = ({
  label,
  value,
  onChange,
  disabledReasonOf,
  allowDisabled = false,
  excludeUserIds = [],
  helperText,
}: UserPickerProps) => {
  const t = useTranslations("admin.userPicker");
  const users = useUserCandidates();
  const reasonOf = (user: UserCandidate): string | null =>
    user.enabled || allowDisabled
      ? (disabledReasonOf?.(user) ?? null)
      : t("disabled");
  const candidates = users.candidates.filter(
    (user) => !excludeUserIds.includes(user.id),
  );
  const options =
    value === null || candidates.some((user) => user.id === value.id)
      ? candidates
      : [value, ...candidates];

  return (
    <Autocomplete<UserCandidate>
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      fullWidth
      size="small"
      loading={users.isFetching}
      loadingText={t("loading")}
      noOptionsText={users.isForbidden ? t("forbidden") : t("empty")}
      helperText={helperText}
      getOptionKey={(user) => user.id}
      getOptionLabel={(user) =>
        t("option", { name: user.name, account: user.account })
      }
      getOptionDisabled={(user) => reasonOf(user) !== null}
      getOptionDisabledReason={(user) => reasonOf(user)}
      onInputChange={users.setKeyword}
    />
  );
};
