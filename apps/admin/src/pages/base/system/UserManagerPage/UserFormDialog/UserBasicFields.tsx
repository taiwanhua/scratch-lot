import { useTranslations } from "use-intl";

import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import type { UserFormState, UserFormValues } from "./useUserForm";

/** 性別的可選值(識別符英文、畫面文案走 i18n;api 的 `gender` 是自由字串)。 */
const GENDERS = ["male", "female", "other"] as const;

export interface UserBasicFieldsProps {
  form: UserFormState;
  /** 身分證欄可見(`show-national-id`);沒有就整欄不出現 */
  canShowNationalId: boolean;
  /** 身分證欄可改(`edit-national-id`);只可見不可改時唯讀 */
  canEditNationalId: boolean;
  isDisabled: boolean;
}

/**
 * 基本欄位兩欄式版面(Figma 202:731 起):帳號 / 姓名、暱稱 / 性別、Email / 電話、地址 / 身分證。
 * 身分證是欄位級權限(ADR-0007):無 `show-national-id` 連欄位都不渲染,
 * 有看沒有改(`edit-national-id`)時唯讀。
 */
export const UserBasicFields = ({
  form,
  canShowNationalId,
  canEditNationalId,
  isDisabled,
}: UserBasicFieldsProps) => {
  const t = useTranslations("admin.userManager.form");

  const field = (key: keyof UserFormValues, isRequired = false) => ({
    label: t(key),
    value: form.values[key],
    required: isRequired,
    fullWidth: true,
    disabled: isDisabled,
    onChange: (event: { target: { value: string } }) => {
      form.setValue(key, event.target.value);
    },
  });

  return (
    <Stack spacing={2.25}>
      <Stack direction="row" spacing={2}>
        <TextField {...field("account", true)} />
        <TextField {...field("name", true)} />
      </Stack>
      <Stack direction="row" spacing={2}>
        <TextField {...field("nickname")} />
        {/*
         * 性別是下拉,但**照其他欄位一樣要有浮動標籤**(Figma 202:734 的「性別」;
         * 驗收時發現:原本只有 `aria-label`,畫面上看不到欄位名)。表單下拉一律 `SelectField`
         * (REACT-11):標籤、`disabled` / `fullWidth` 與同列的 `TextField` 一致,
         * 「未填」是 `value: ""` 的空值項 + `displayEmpty`(標籤釘在上緣)。
         * 表單值是自由字串(api 的 `gender` 不是 enum),所以 `Value` 明示為 `string`。
         */}
        <SelectField<string>
          label={t("gender")}
          value={form.values.gender}
          fullWidth
          disabled={isDisabled}
          displayEmpty
          options={[
            { value: "", label: t("genderOptions.unset") },
            ...GENDERS.map((gender) => ({
              value: gender,
              label: t(`genderOptions.${gender}`),
            })),
          ]}
          onChange={(value) => {
            form.setValue("gender", value);
          }}
        />
      </Stack>
      <Stack direction="row" spacing={2}>
        <TextField {...field("email", true)} type="email" />
        <TextField {...field("phone")} />
      </Stack>
      <Stack direction="row" spacing={2}>
        <TextField {...field("address")} />
        {canShowNationalId && (
          <TextField
            {...field("nationalId")}
            disabled={isDisabled || !canEditNationalId}
          />
        )}
      </Stack>
    </Stack>
  );
};
