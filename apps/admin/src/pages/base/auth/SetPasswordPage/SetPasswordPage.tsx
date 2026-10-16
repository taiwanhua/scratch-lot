import { type SyntheticEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";

import { PASSWORD_MIN_LENGTH } from "@repo/domain/password";
import { useSetPasswordMutation } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Link } from "@repo/ui/link";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import {
  authErrorCodeOf,
  passwordViolationsOf,
} from "@/lib/base/auth/graphql-errors";
import {
  FORGOT_PASSWORD_PATH,
  LOGIN_PATH,
  TOKEN_PARAM,
} from "@/lib/base/paths";

import { AuthCard } from "../AuthCard";
import { NewPasswordFields } from "../NewPasswordFields/NewPasswordFields";
import { useNewPassword } from "../NewPasswordFields/useNewPassword";

/**
 * 設定新密碼頁(Figma「Admin 設定新密碼」120:1582 / 連結失效 121:1520):啟用信與重設信共用同一頁,
 * 成功即持回傳的登入 token 進入後台;`ACTION_TOKEN_INVALID`(逾期 / 已用 / 不存在,同碼)→ 連結失效 + 一鍵重新申請。
 */
export const SetPasswordPage = () => {
  const t = useTranslations("admin.setPassword");
  const { session } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get(TOKEN_PARAM) ?? "";

  const password = useNewPassword();
  const [isLinkInvalid, setIsLinkInvalid] = useState(token.length === 0);
  const [hasUnexpectedError, setHasUnexpectedError] = useState(false);

  const setPassword = useSetPasswordMutation(session.publicClient, {
    onSuccess: ({ setPassword: payload }) => {
      session.store.getState().setAccessToken(payload.accessToken);
      void navigate("/", { replace: true });
    },
    onError: (error: unknown) => {
      if (authErrorCodeOf(error) === "ACTION_TOKEN_INVALID") {
        setIsLinkInvalid(true);
        return;
      }
      const violations = passwordViolationsOf(error);
      if (violations !== null) {
        password.applyServerViolations(violations);
        return;
      }
      setHasUnexpectedError(true);
    },
  });

  const handleSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    setHasUnexpectedError(false);
    if (!password.submitAttempt()) {
      return;
    }
    setPassword.mutate({
      input: { token, newPassword: password.newPassword },
    });
  };

  if (isLinkInvalid) {
    return (
      <AuthCard subtitle={t("subtitle")}>
        <Typography variant="body2" color="text.secondary">
          {t("invalid.description")}
        </Typography>
        <Button
          size="large"
          fullWidth
          onClick={() => {
            void navigate(FORGOT_PASSWORD_PATH);
          }}
        >
          {t("invalid.requestAgain")}
        </Button>
        <Stack sx={{ alignItems: "center" }}>
          <Link href={LOGIN_PATH}>{t("backToLogin")}</Link>
        </Stack>
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle={t("subtitle")}>
      <Box component="form" onSubmit={handleSubmit}>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            {t("description", { min: PASSWORD_MIN_LENGTH })}
          </Typography>

          {hasUnexpectedError ? (
            <Alert severity="error">{t("errors.unexpected")}</Alert>
          ) : null}

          <NewPasswordFields
            state={password}
            isDisabled={setPassword.isPending}
          />
          <Button
            type="submit"
            size="large"
            fullWidth
            disabled={setPassword.isPending}
          >
            {t("submit")}
          </Button>

          <Stack sx={{ alignItems: "center" }}>
            <Link href={LOGIN_PATH}>{t("backToLogin")}</Link>
          </Stack>
        </Stack>
      </Box>
    </AuthCard>
  );
};
