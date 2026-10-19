import type { ReactElement, ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Link } from "@repo/ui/link";

import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { usePermissions } from "@/hooks/base/usePermissions";

import {
  NOTIFICATION_SETTINGS_MODULE_KEY,
  NOTIFICATION_SETTINGS_PERMISSIONS,
} from "../NotificationSettingsPage/notification-settings-permissions";
import {
  WORKFLOWS_MODULE_KEY,
  WORKFLOWS_PERMISSIONS,
} from "../workflows-permissions";
import type { RoleReference } from "./role-manager-error";

/**
 * 處置要去的頁面:操作者有那個模組、而且有編輯權限才給路由(沒有 → 文案照樣說去哪,但不做成連結)。
 * 路由一律從 `me.modules` 取(ADR-0011)。
 */
const useFixRoutes = (): {
  notification: string | null;
  workflows: string | null;
} => {
  const routeOf = useModuleRoutes();
  const { hasPermission } = usePermissions();
  return {
    notification: hasPermission(NOTIFICATION_SETTINGS_PERMISSIONS.edit)
      ? routeOf(NOTIFICATION_SETTINGS_MODULE_KEY)
      : null,
    workflows: hasPermission(WORKFLOWS_PERMISSIONS.edit)
      ? routeOf(WORKFLOWS_MODULE_KEY)
      : null,
  };
};

export interface RoleReferenceLineProps {
  reference: RoleReference;
}

/** 處置頁的連結;沒有路由(沒權限)就只是文字。 */
const FixLink = ({
  route,
  children,
}: {
  route: string | null;
  children: ReactNode;
}) => {
  const navigate = useNavigate();
  if (route === null) {
    return <>{children}</>;
  }
  return (
    <Link
      href={route}
      onClick={(event) => {
        event.preventDefault();
        void navigate(route);
      }}
    >
      {children}
    </Link>
  );
};

/** 依種類與出處選文案(處置頁有權限時做成連結)。 */
const useReferenceText = (reference: RoleReference): ReactElement => {
  const t = useTranslations("admin.roleManager.delete.references");
  const routes = useFixRoutes();
  const { kind, name, stepName, source, inUseCount } = reference;
  if (kind === "notification-setting") {
    return (
      <>
        {t.rich("notification-setting", {
          name,
          link: function NotificationLink(chunks) {
            return <FixLink route={routes.notification}>{chunks}</FixLink>;
          },
        })}
      </>
    );
  }
  if (kind === "data-scope") {
    return <>{t("data-scope", { name })}</>;
  }
  if (source === "in-use") {
    return (
      <>
        {t(`${kind}.inUse`, {
          name,
          step: stepName ?? "",
          count: inUseCount ?? 0,
        })}
      </>
    );
  }
  return (
    <>
      {t.rich(`${kind}.edit`, {
        name,
        step: stepName ?? "",
        source: source ?? "current",
        link: function WorkflowsLink(chunks) {
          return <FixLink route={routes.workflows}>{chunks}</FixLink>;
        },
      })}
    </>
  );
};

/**
 * 一個引用處的「為什麼 + 怎麼做」(文案 `admin.roleManager.delete.references.*`;
 * 種類與出處的語意正本 `docs/modules/role-manager.md`「被人員條件引用」):
 *
 * | 引用處                 | 處置                                                     |
 * | ---------------------- | -------------------------------------------------------- |
 * | 通知設定               | 到「通知設定」把收件人改成其他角色(有權限才是連結)       |
 * | 流程的草稿 / 目前版本  | 到「流程管理」修改這一關並發布(有權限才是連結)           |
 * | 進行中單據用的版本     | 等這些單據完成,或撤回 / 作廢後再刪除                     |
 * | 資料範圍               | 由系統管理員設定,請聯絡系統管理員修改                    |
 */
export const RoleReferenceLine = ({ reference }: RoleReferenceLineProps) =>
  useReferenceText(reference);
