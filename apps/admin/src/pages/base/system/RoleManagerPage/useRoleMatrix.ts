import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import {
  type PermissionGrant,
  isWholeGroupGranted,
  toggleWholeGroup,
} from "@repo/domain/permission";
import {
  type SaveRoleMatrixMutation,
  useRoleMatrixQuery,
  useSaveRoleMatrixMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  allMatrixRowIds,
  isSameGrant,
  matrixSelectionOf,
  nextGrantFromSelection,
  outOfCeilingMatrixRowIds,
  ungrantedMatrixRowIds,
} from "@/lib/base/role-matrix-208";

import {
  type RoleManagerErrorCode,
  roleManagerErrorOf,
} from "./role-manager-error";
import type { MatrixModuleView } from "./role-manager-types";

const EMPTY_GRANT: PermissionGrant = { moduleKeys: [], permissionKeys: [] };
const EMPTY_TREE: readonly MatrixModuleView[] = [];

export interface UseRoleMatrixOptions {
  /** 沒有 `edit-matrix` 權限時整份鎖住(看得到、動不了) */
  canEdit: boolean;
  /** 儲存成功後由頁面精準 invalidate(DATA-04) */
  onSaved: (roleId: string) => void;
}

/**
 * 權限矩陣的狀態(規則正本 ADR-0004 + `docs/modules/role-manager.md`「權限矩陣規則」)。
 *
 * **連動一律呼叫 `@repo/domain/permission`**:本 hook 只保管「使用者改過的那份授予」,
 * 勾選換算、`*` 收斂 / 展開、整組切換全部交給純函式(`lib/base/role-matrix-208.ts` 是它的薄殼)。
 *
 * 草稿連同 roleId 一起存,換角色時**推導**成「沒有草稿」而不是在 effect 內清空(REACT-06);
 * 未儲存時換角色會先被放棄變更彈窗攔下,所以正常情況不會丟掉東西。
 */
export const useRoleMatrix = (
  roleId: string | null,
  { canEdit, onSaved }: UseRoleMatrixOptions,
) => {
  const t = useTranslations("admin.roleManager");
  const tErrors = useTranslations("admin.roleManager.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{
    roleId: string;
    grant: PermissionGrant;
  } | null>(null);
  const [errorCode, setErrorCode] = useState<RoleManagerErrorCode | null>(null);

  const query = useRoleMatrixQuery(
    session.client,
    { roleId: roleId ?? "" },
    { enabled: roleId !== null },
  );
  const payload = query.data?.roleMatrix;
  /** 空樹的 fallback 每次 render 都是新陣列,包一層 memo 才不會讓下面的 memo 每次失效。 */
  const tree = useMemo<readonly MatrixModuleView[]>(
    () => payload?.modules ?? EMPTY_TREE,
    [payload?.modules],
  );
  const saved = payload?.granted ?? EMPTY_GRANT;
  const grant = draft !== null && draft.roleId === roleId ? draft.grant : saved;

  const isDirty =
    payload !== undefined &&
    draft !== null &&
    draft.roleId === roleId &&
    !isSameGrant(tree, draft.grant, saved);

  const ceiling = payload?.ceiling ?? null;

  /**
   * 不給勾的列(都是防呆,判準仍在 api):
   * - 沒有 `edit-matrix` 權限 → 整份鎖住
   * - 預設角色的**天花板外**(`ceiling`)→ root 與租戶都鎖
   * - `shrinkOnly`(非 root 的預設角色)→ 目前沒勾的列再多鎖一層
   */
  const lockedIds = useMemo(() => {
    if (!canEdit) {
      return allMatrixRowIds(tree);
    }
    return [
      ...(ceiling === null ? [] : outOfCeilingMatrixRowIds(tree, ceiling)),
      ...(payload?.shrinkOnly === true
        ? ungrantedMatrixRowIds(tree, saved)
        : []),
    ];
  }, [canEdit, ceiling, payload?.shrinkOnly, tree, saved]);

  const selection = useMemo(
    () => matrixSelectionOf(tree, grant, { lockedIds }),
    [tree, grant, lockedIds],
  );

  const applyGrant = (next: PermissionGrant) => {
    if (roleId === null) {
      return;
    }
    setErrorCode(null);
    setDraft({ roleId, grant: next });
  };

  const save = useSaveRoleMatrixMutation(
    session.client,
    useMutationFeedback<SaveRoleMatrixMutation>({
      success: t("feedback.saveMatrixSuccess"),
      error: (error) => tErrors(roleManagerErrorOf(error).code),
      onSuccess: (result) => {
        /**
         * 先把回傳的矩陣寫進 `roleMatrix` 的快取,再丟掉草稿(DATA-04 的 (a) 步)。
         * 順序反過來就是驗收看到的「閃一下」:草稿一沒了,`grant` 立刻退回
         * `saved` —— 那還是**儲存前**的快取,畫面會先跳回舊勾選,等 `onSaved` 失效
         * 後重取回來才變新的。payload 與 `roleMatrix` 查詢同形,所以整份覆寫即可。
         */
        queryClient.setQueryData(
          useRoleMatrixQuery.getKey({ roleId: result.saveRoleMatrix.role.id }),
          { roleMatrix: result.saveRoleMatrix },
        );
        setDraft(null);
        onSaved(result.saveRoleMatrix.role.id);
      },
      onError: (error: unknown) => {
        setErrorCode(roleManagerErrorOf(error).code);
      },
    }),
  );

  return {
    isLoading: roleId !== null && query.isLoading,
    tree,
    shrinkOnly: payload?.shrinkOnly ?? false,
    /** 預設角色才有天花板:頁面據此多顯示一句「模板沒有的項目勾不動」 */
    hasCeiling: ceiling !== null,
    selection,
    isDirty,
    isSaving: save.isPending,
    errorCode,
    /** 勾 / 取消一列:把新的勾選集合翻成授予,再由 `normalizeGrant` 收斂 */
    changeSelection: (nextIds: readonly string[]) => {
      applyGrant(nextGrantFromSelection(tree, selection.checkedIds, nextIds));
    },
    /** 頂層群組列的「全選整組 / 清空整組」(ADR-0004:子樹每個模組各一筆 `*`) */
    toggleGroup: (groupKey: string) => {
      applyGrant(
        toggleWholeGroup(
          tree,
          grant,
          groupKey,
          !isWholeGroupGranted(tree, grant, groupKey),
        ),
      );
    },
    isGroupGranted: (groupKey: string) =>
      isWholeGroupGranted(tree, grant, groupKey),
    /** 放棄未儲存的變更 */
    reset: () => {
      setDraft(null);
      setErrorCode(null);
    },
    submit: () => {
      if (roleId === null) {
        return;
      }
      setErrorCode(null);
      save.mutate({
        input: {
          roleId,
          moduleKeys: [...grant.moduleKeys],
          permissionKeys: [...grant.permissionKeys],
        },
      });
    },
  };
};
