import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryContactRole,
  LotteryContactStatus,
  type LotteryDealerContactRefFieldsFragment,
  useLotteryDealerContactsQuery,
} from "@repo/graphql";
import { Autocomplete } from "@repo/ui/autocomplete";

import { useSession } from "@/hooks/base/useSession";

export interface ContactsPickerProps {
  label: string;
  role: LotteryContactRole;
  value: readonly LotteryDealerContactRefFieldsFragment[];
  onChange: (value: LotteryDealerContactRefFieldsFragment[]) => void;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
}

/**
 * 關係人挑選器(規格 5.2):**只列出有這個身分且啟用中的人**;已選的人之後停用了照樣留在欄位上
 * (既有關聯保留),可以取消、選不回來。上限由 api 擋(甲:代理人 2、受託人 2、介紹人 1)。
 */
export const ContactsPicker = ({
  label,
  role,
  value,
  onChange,
  error,
  helperText,
  disabled,
}: ContactsPickerProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const [keyword, setKeyword] = useState("");
  const query = useLotteryDealerContactsQuery(session.client, {
    input: {
      role,
      status: LotteryContactStatus.Active,
      keyword: keyword === "" ? null : keyword,
      pageSize: 50,
    },
  });
  const candidates = (query.data?.lotteryDealerContacts.items ?? []).map(
    (contact) => ({
      id: contact.id,
      name: contact.name,
      status: contact.status,
    }),
  );
  const options = [
    ...value,
    ...candidates.filter(
      (candidate) => !value.some((selected) => selected.id === candidate.id),
    ),
  ];
  return (
    <Autocomplete
      multiple
      label={label}
      options={options}
      value={[...value]}
      onChange={(next) => {
        onChange(next);
      }}
      onInputChange={setKeyword}
      getOptionLabel={(option) => option.name}
      getOptionKey={(option) => option.id}
      loading={query.isLoading}
      loadingText={t("common.loading")}
      noOptionsText={t("common.empty")}
      error={error}
      helperText={helperText ?? t("form.pickContacts")}
      disabled={disabled}
      size="small"
      fullWidth
    />
  );
};
