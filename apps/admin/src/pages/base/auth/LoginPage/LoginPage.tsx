import { type SyntheticEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";

import { useLoginMutation } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Link } from "@repo/ui/link";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useSession } from "@/hooks/base/useSession";
import {
  FORGOT_PASSWORD_PATH,
  NEXT_PARAM,
  safeNextPath,
} from "@/lib/base/paths";

import { AuthCard } from "../AuthCard";
import { type LoginErrorKey, loginErrorKeyOf } from "./login-error";

/** 登入頁(Figma「Admin 登入 LoginCard」17:4;版型見 AuthCard,品牌文字登記於 docs/branding.md)。 */
export const LoginPage = () => {
  const t = useTranslations("admin.login");
  const { session, snapshot } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = safeNextPath(searchParams.get(NEXT_PARAM));

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [errorKey, setErrorKey] = useState<LoginErrorKey | null>(null);

  const login = useLoginMutation(session.publicClient, {
    onSuccess: ({ login: payload }) => {
      session.store.getState().setAccessToken(payload.accessToken);
      void navigate(nextPath, { replace: true });
    },
    onError: (error: unknown) => {
      setErrorKey(loginErrorKeyOf(error));
    },
  });

  if (snapshot.status === "authenticated") {
    return <Navigate to={nextPath} replace />;
  }

  const handleSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    setErrorKey(null);
    login.mutate({ input: { account, password } });
  };

  return (
    <AuthCard subtitle={t("subtitle")}>
      <Box component="form" onSubmit={handleSubmit}>
        <Stack spacing={2.5}>
          {errorKey === null ? null : (
            <Alert severity="error">{t(`errors.${errorKey}`)}</Alert>
          )}

          <TextField
            label={t("account")}
            name="account"
            autoComplete="username"
            fullWidth
            value={account}
            onChange={(event) => {
              setAccount(event.target.value);
            }}
          />
          <TextField
            label={t("password")}
            name="password"
            type="password"
            autoComplete="current-password"
            fullWidth
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <Button
            type="submit"
            size="large"
            fullWidth
            disabled={login.isPending}
          >
            {t("submit")}
          </Button>

          <Stack sx={{ alignItems: "center" }}>
            <Link href={FORGOT_PASSWORD_PATH}>{t("forgotPassword")}</Link>
          </Stack>
        </Stack>
      </Box>
    </AuthCard>
  );
};
