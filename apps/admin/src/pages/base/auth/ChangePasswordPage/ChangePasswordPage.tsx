import { useQueryClient } from "@tanstack/react-query";
import { type SyntheticEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { PASSWORD_MIN_LENGTH } from "@repo/domain/password";
import { useChangePasswordMutation, useMeQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Link } from "@repo/ui/link";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { passwordViolationsOf } from "@/lib/base/auth/graphql-errors";
import { NEXT_PARAM, safeNextPath, urlStringSchema } from "@/lib/base/paths";

import { AuthCard } from "../AuthCard";
import { NewPasswordFields } from "../NewPasswordFields/NewPasswordFields";
import { useNewPassword } from "../NewPasswordFields/useNewPassword";
import {
  type ChangePasswordErrorKey,
  changePasswordErrorKeyOf,
} from "./change-password-error";

/**
 * 改密碼頁(已登入;無設計稿,沿用 LoginCard 版型):首登須改密碼者由路由守門帶 `next` 導來,
 * 成功後旗標清除、`me` 重取、回原頁(user-manager.md「密碼流程」)。
 */
export const ChangePasswordPage = () => {
  const t = useTranslations("admin.changePassword");
  const { session, snapshot } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [next] = useUrlState(NEXT_PARAM, urlStringSchema);
  const nextPath = safeNextPath(next);

  const me = useMe();
  const isForced =
    snapshot.mustChangePassword || me.data?.me.mustChangePassword === true;

  const [currentPassword, setCurrentPassword] = useState("");
  const password = useNewPassword();
  const [errorKey, setErrorKey] = useState<ChangePasswordErrorKey | null>(null);

  const changePassword = useChangePasswordMutation(session.client, {
    onSuccess: async () => {
      session.store.getState().setMustChangePassword(false);
      // 旗標已清:重取 me 後再回原頁,路由守門才不會再把人導回來
      await queryClient.invalidateQueries({ queryKey: useMeQuery.getKey() });
      void navigate(nextPath, { replace: true });
    },
    onError: (error: unknown) => {
      const violations = passwordViolationsOf(error);
      if (violations !== null) {
        password.applyServerViolations(violations);
        return;
      }
      setErrorKey(changePasswordErrorKeyOf(error));
    },
  });

  const handleSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    setErrorKey(null);
    if (!password.submitAttempt()) {
      return;
    }
    changePassword.mutate({
      input: { currentPassword, newPassword: password.newPassword },
    });
  };

  return (
    <AuthCard subtitle={t("subtitle")}>
      <Box component="form" onSubmit={handleSubmit}>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="textSecondary">
            {isForced
              ? t("forced")
              : t("description", { min: PASSWORD_MIN_LENGTH })}
          </Typography>

          {errorKey === null ? null : (
            <Alert severity="error">{t(`errors.${errorKey}`)}</Alert>
          )}

          <TextField
            label={t("currentPassword")}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            fullWidth
            disabled={changePassword.isPending}
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
          />
          <NewPasswordFields
            state={password}
            isDisabled={changePassword.isPending}
          />
          <Button
            type="submit"
            size="large"
            fullWidth
            disabled={changePassword.isPending}
          >
            {t("submit")}
          </Button>

          {isForced ? null : (
            <Stack sx={{ alignItems: "center" }}>
              <Link href={nextPath}>{t("back")}</Link>
            </Stack>
          )}
        </Stack>
      </Box>
    </AuthCard>
  );
};
