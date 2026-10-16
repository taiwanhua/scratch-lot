import { useTranslations } from "use-intl";

import { useUserQuery } from "@repo/graphql";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";

import { useSession } from "@/hooks/base/useSession";
import type { OrgNodeLike } from "@/lib/base/org-tree";

import type { UserActionAbility, UserRow } from "../user-manager-types";
import { UserFormBody } from "./UserFormBody";
import { EMPTY_USER_FORM } from "./useUserForm";

export interface UserFormDialogProps {
  /** 編輯的對象;新增模式為 null */
  user: UserRow | null;
  /** 新增模式的預設所屬組織 = 目前選中的組織 */
  defaultOrgIds: readonly string[];
  orgNodes: readonly OrgNodeLike[];
  isOrgTreeAvailable: boolean;
  ability: UserActionAbility;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 新增 / 編輯使用者彈窗的外層:編輯模式先取單筆(清單沒有暱稱 / 性別 / 電話 / 地址 /
 * 身分證這些欄位,`nationalId` 還要看欄位級權限),取到才把表單掛上去。
 */
export const UserFormDialog = ({
  user,
  defaultOrgIds,
  orgNodes,
  isOrgTreeAvailable,
  ability,
  onClose,
  onSaved,
}: UserFormDialogProps) => {
  const t = useTranslations("admin.userManager.form");
  const { session } = useSession();
  const detail = useUserQuery(
    session.client,
    { id: user?.id ?? "" },
    { enabled: user !== null },
  );

  if (user === null) {
    return (
      <UserFormBody
        userId={null}
        title={t("createTitle")}
        initialValues={EMPTY_USER_FORM}
        initialOrgIds={defaultOrgIds}
        orgNodes={orgNodes}
        isOrgTreeAvailable={isOrgTreeAvailable}
        ability={ability}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  if (detail.data === undefined) {
    return (
      <Dialog
        open
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        title={t("editTitle", { name: user.name })}
      >
        <Stack sx={{ alignItems: "center", py: 4 }}>
          <CircularProgress aria-label={t("editTitle", { name: user.name })} />
        </Stack>
      </Dialog>
    );
  }

  const loaded = detail.data.user;
  return (
    <UserFormBody
      userId={loaded.id}
      title={t("editTitle", { name: loaded.name })}
      initialValues={{
        account: loaded.account,
        name: loaded.name,
        nickname: loaded.nickname ?? "",
        gender: loaded.gender ?? "",
        email: loaded.email,
        phone: loaded.phone ?? "",
        address: loaded.address ?? "",
        nationalId: loaded.nationalId ?? "",
      }}
      initialOrgIds={loaded.orgs.map((org) => org.id)}
      orgNodes={orgNodes}
      isOrgTreeAvailable={isOrgTreeAvailable}
      ability={ability}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
};
