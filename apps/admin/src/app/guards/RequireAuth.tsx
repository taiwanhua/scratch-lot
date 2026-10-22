import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useTranslations } from "use-intl";

import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import {
  CHANGE_PASSWORD_PATH,
  changePasswordPathWithNext,
  loginPathWithNext,
} from "@/lib/base/paths";

export interface RequireAuthProps {
  children: ReactNode;
}

/**
 * 路由守門:
 * - 未登入 → 導 `/login?next=<原路徑>`;開機換票中 → 顯示恢復中,不閃登入頁
 * - 首登須改密碼(`me.mustChangePassword`,或 fetch 層攔到 `MUST_CHANGE_PASSWORD`)→ 導 `/change-password?next=<原路徑>`;
 *   改密碼頁本身不再轉向
 */
export const RequireAuth = ({ children }: RequireAuthProps) => {
  const { snapshot } = useSession();
  const location = useLocation();
  const t = useTranslations("admin.session");
  const isAuthenticated = snapshot.status === "authenticated";
  const me = useMe();

  if (snapshot.status === "booting" || (isAuthenticated && me.isPending)) {
    return (
      <Stack
        component="main"
        spacing={2}
        sx={{
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress aria-label={t("restoring")} />
        <Typography color="textSecondary">{t("restoring")}</Typography>
      </Stack>
    );
  }

  const here = `${location.pathname}${location.search}`;

  if (snapshot.status === "anonymous") {
    return <Navigate to={loginPathWithNext(here)} replace />;
  }

  const mustChangePassword =
    snapshot.mustChangePassword || me.data?.me.mustChangePassword === true;
  if (mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={changePasswordPathWithNext(here)} replace />;
  }

  return <>{children}</>;
};
