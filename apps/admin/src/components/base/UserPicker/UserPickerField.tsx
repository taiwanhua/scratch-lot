import { useTranslations } from "use-intl";

import { Autocomplete } from "@repo/ui/autocomplete";

import type { UserCandidate, UserCandidates } from "./useUserCandidates";

export interface UserPickerFieldProps {
  /** 候選來源(`useUserCandidates` 或別的候選查詢,如個人設定的代理人候選) */
  users: UserCandidates;
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

/** 同 `UserPicker`,候選來源由呼叫端給(不同查詢共用同一個選人欄)。 */
export const UserPickerField = ({
  users,
  label,
  value,
  onChange,
  disabledReasonOf,
  allowDisabled = false,
  excludeUserIds = [],
  helperText,
}: UserPickerFieldProps) => {
  const t = useTranslations("admin.userPicker");
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
