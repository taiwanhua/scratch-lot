import { useState } from "react";
import { useTranslations } from "use-intl";

import { Autocomplete } from "@repo/ui/autocomplete";

import {
  type UserCandidate,
  useUserCandidates,
} from "@/components/base/UserPicker/useUserCandidates";

export interface UsersFieldProps {
  /** 定義裡存的只有 id */
  value: readonly string[];
  onChange: (userIds: string[]) => void;
  isDisabled: boolean;
}

/**
 * 「指定使用者」來源的多選(只給客製流程):關鍵字丟回 api 查本租戶使用者;
 * 已選但不在這一批候選裡的人仍留在值裡(先顯示記得的名字,不知道就顯示 id)。
 */
export const UsersField = ({
  value,
  onChange,
  isDisabled,
}: UsersFieldProps) => {
  const t = useTranslations("admin.workflows.assignee");
  const tPicker = useTranslations("admin.userPicker");
  const users = useUserCandidates();
  const [known, setKnown] = useState<ReadonlyMap<string, UserCandidate>>(
    () => new Map(),
  );
  const nameOf = (id: string): UserCandidate =>
    users.candidates.find((user) => user.id === id) ??
    known.get(id) ?? { id, name: id, account: "", enabled: true };
  const picked = value.map((id) => nameOf(id));
  const options = [
    ...picked,
    ...users.candidates.filter((user) => !value.includes(user.id)),
  ];

  return (
    <Autocomplete<UserCandidate, true>
      multiple
      label={t("users")}
      options={options}
      value={picked}
      disabled={isDisabled}
      fullWidth
      size="small"
      loading={users.isFetching}
      loadingText={tPicker("loading")}
      noOptionsText={
        users.isForbidden ? tPicker("forbidden") : tPicker("empty")
      }
      helperText={t("usersHint")}
      getOptionKey={(user) => user.id}
      getOptionLabel={(user) =>
        user.account === ""
          ? user.name
          : tPicker("option", { name: user.name, account: user.account })
      }
      onInputChange={users.setKeyword}
      onChange={(next) => {
        setKnown(
          new Map([...known, ...next.map((user) => [user.id, user] as const)]),
        );
        onChange(next.map((user) => user.id));
      }}
    />
  );
};
