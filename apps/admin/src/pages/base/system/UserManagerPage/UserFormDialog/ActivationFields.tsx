import { useTranslations } from "use-intl";

import {
  PASSWORD_MIN_LENGTH,
  type PasswordRuleViolation,
} from "@repo/domain/password";
import { UserActivationMode } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import type { UserFormState } from "./useUserForm";

/** 違規項 → `admin.passwordRules.*` 文案 key(與設定新密碼頁同一份規則)。 */
const RULE_MESSAGE_KEY: Record<
  PasswordRuleViolation,
  "tooShort" | "digitsOnly"
> = {
  "too-short": "tooShort",
  "digits-only": "digitsOnly",
};

export interface ActivationFieldsProps {
  form: UserFormState;
  isDisabled: boolean;
}

/**
 * 啟用方式(Figma 202:811,ADR-0009):預設寄啟用信;
 * 選「直接設定初始密碼」才顯示密碼欄,規則提示與 api 同用 `@repo/domain/password`。
 */
export const ActivationFields = ({
  form,
  isDisabled,
}: ActivationFieldsProps) => {
  const t = useTranslations("admin.userManager.form");
  const tRules = useTranslations("admin.passwordRules");
  const isPasswordMode = form.activationMode === UserActivationMode.Password;
  const hasViolations = form.passwordViolations.length > 0;

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" color="textSecondary">
        {t("activation.legend")}
      </Typography>
      <RadioGroup
        value={form.activationMode}
        onChange={(event) => {
          form.setActivationMode(event.target.value as UserActivationMode);
        }}
      >
        <FormControlLabel
          value={UserActivationMode.Email}
          control={<Radio />}
          disabled={isDisabled}
          label={
            <Typography variant="body2">{t("activation.email")}</Typography>
          }
        />
        <FormControlLabel
          value={UserActivationMode.Password}
          control={<Radio />}
          disabled={isDisabled}
          label={
            <Typography variant="body2">{t("activation.password")}</Typography>
          }
        />
      </RadioGroup>
      {isPasswordMode && (
        <TextField
          label={t("initialPassword")}
          type="password"
          autoComplete="new-password"
          fullWidth
          required
          disabled={isDisabled}
          value={form.initialPassword}
          error={form.initialPassword.length > 0 && hasViolations}
          helperText={
            form.initialPassword.length > 0 && hasViolations
              ? form.passwordViolations.map((violation) => (
                  <Box
                    component="span"
                    key={violation}
                    sx={{ display: "block" }}
                  >
                    {tRules(RULE_MESSAGE_KEY[violation], {
                      min: PASSWORD_MIN_LENGTH,
                    })}
                  </Box>
                ))
              : undefined
          }
          onChange={(event) => {
            form.setInitialPassword(event.target.value);
          }}
        />
      )}
      <Typography variant="caption" color="textSecondary">
        {t("activation.note")}
      </Typography>
    </Stack>
  );
};
