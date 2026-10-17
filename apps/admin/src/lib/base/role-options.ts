/**
 * 角色選單的顯示與分組(#261 的 8;#307 改用 `@repo/ui/autocomplete` 後收斂)。
 *
 * 三個地方要能**分辨同名角色** —— 資料範圍頁的套用對象「指定角色」、使用者頁的指派角色、
 * 角色管理頁的清單:每個租戶都有自己的「租戶管理員」,只看角色名稱在根組織視角完全分不出來。
 *
 * 兩層做法,資料都來自 `Role.ownerOrg`(api 已備妥,見 `docs/modules/role-manager.md`):
 * - 每一列「角色名稱」為主文字、「擁有組織名稱」為**次文字**(Autocomplete 的兩行選項;
 *   在此之前是同一行的「名稱 — 擁有組織」,`roleOptionLabel` 仍留著給單行的場合用)
 * - 跨到兩個以上的租戶頂層時再依 `ownerOrg.tenantTop` 分組(單一租戶視角不分組 ——
 *   只有一組的標題是雜訊)
 *
 * **關鍵字過濾不在這裡**:改用 Autocomplete 後,前端過濾由元件內建(比對主文字),
 * 跨頁的 `filterRoleOptions` 因此退場(#307)。
 */

/** 這些函式只吃 `Role` 的這幾個欄位;各頁的 codegen 型別結構上相容,不必轉一手。 */
export interface RoleOptionSource {
  id: string;
  name: string;
  ownerOrg?: {
    id: string;
    name: string;
    tenantTop?: { id: string; name: string } | null;
  } | null;
}

/** 選單的一列。 */
export interface RoleMenuOption {
  id: string;
  name: string;
  /** 擁有組織 id;資料損毀(無 `org_role`)或範圍外時為 null */
  ownerOrgId: string | null;
  /** 擁有組織名稱;資料損毀(無 `org_role`)或範圍外時為 null */
  ownerOrgName: string | null;
  /** 「角色名稱 — 擁有組織」;沒有擁有組織時只有角色名稱(單行顯示的場合用) */
  label: string;
  /** 分組用的租戶頂層;擁有組織是根組織(種子角色)時為 null */
  tenantTopId: string | null;
  tenantTopName: string | null;
}

/** 「角色名稱 — 擁有組織」;破折號用全形,與清單列 / Figma 一致。 */
export const roleOptionLabel = (
  name: string,
  ownerOrgName: string | null,
): string => (ownerOrgName === null ? name : `${name} — ${ownerOrgName}`);

export const roleMenuOptionOf = (role: RoleOptionSource): RoleMenuOption => {
  const ownerOrgName = role.ownerOrg?.name ?? null;
  const tenantTop = role.ownerOrg?.tenantTop ?? null;
  return {
    id: role.id,
    name: role.name,
    ownerOrgId: role.ownerOrg?.id ?? null,
    ownerOrgName,
    label: roleOptionLabel(role.name, ownerOrgName),
    tenantTopId: tenantTop?.id ?? null,
    tenantTopName: tenantTop?.name ?? null,
  };
};

export const roleMenuOptions = (
  roles: readonly RoleOptionSource[],
): RoleMenuOption[] => roles.map((role) => roleMenuOptionOf(role));

/**
 * 以**擁有組織**分組 / 排序用的最小形狀(#372)。與上面的租戶頂層分組是兩件事:
 * 租戶頂層底下可以有很多個擁有組織,所以同一個標題底下還是會混著好幾個組織的角色。
 */
export interface RoleOwnerOrgGroupable {
  name?: string;
  label: string;
  ownerOrgId?: string | null;
  ownerOrgName?: string | null;
}

/**
 * 排序一律**明講 `zh-Hant`**:`localeCompare` 不給語言時吃執行環境的預設語言,
 * 中文字的先後在開發機(zh-TW)與 CI(通常退回 en-US)會不一樣,斷言跟著飄。
 */
const COLLATION_LOCALE = "zh-Hant";

/**
 * 依「擁有組織 → 角色名」排序,讓同一個擁有組織的角色**相鄰**(#372)。
 *
 * MUI 的 `groupBy` 只是「相鄰且同值就合成一組」,**它自己不排序** —— api 回的順序裡
 * 同組織的角色被別的組織隔開時,同一個標題就會出現兩次以上。沒有擁有組織的那幾筆殿後。
 */
export const sortRolesByOwnerOrg = <T extends RoleOwnerOrgGroupable>(
  options: readonly T[],
): T[] =>
  options.toSorted((left, right) => {
    const leftOrg = left.ownerOrgName ?? null;
    const rightOrg = right.ownerOrgName ?? null;
    if (leftOrg !== rightOrg) {
      if (leftOrg === null) {
        return 1;
      }
      if (rightOrg === null) {
        return -1;
      }
      return leftOrg.localeCompare(rightOrg, COLLATION_LOCALE);
    }
    return (left.name ?? left.label).localeCompare(
      right.name ?? right.label,
      COLLATION_LOCALE,
    );
  });

/**
 * 這批選項該不該依擁有組織分組:**跨兩個以上擁有組織才分**(理由同
 * `shouldGroupRoles` —— 只有一組的標題是雜訊)。
 */
export const shouldGroupRolesByOwnerOrg = (
  options: readonly RoleOwnerOrgGroupable[],
): boolean => {
  const ownerOrgIds = new Set(
    options.flatMap((option) =>
      option.ownerOrgId === undefined || option.ownerOrgId === null
        ? []
        : [option.ownerOrgId],
    ),
  );
  return ownerOrgIds.size >= 2;
};

/** 一筆選項的擁有組織組標題;沒有擁有組織的歸 `fallback` 那一組(i18n 由呼叫端負責)。 */
export const roleOwnerOrgGroupNameOf = (
  option: RoleOwnerOrgGroupable,
  fallback: string,
): string => option.ownerOrgName ?? fallback;

/** 分組用的最小形狀:只要這兩個欄位,各頁自己的選項型別結構上相容即可。 */
export interface RoleGroupable {
  tenantTopId: string | null;
  tenantTopName: string | null;
}

/**
 * 這批選項該不該分組:**跨兩個以上租戶頂層才分**(根組織視角),否則只有一組、標題是雜訊。
 *
 * 回 `false` 時呼叫端就不要傳 `groupBy` 給 Autocomplete —— 之前是回一個「單一組」的結構,
 * 但 MUI 的 `groupBy` 只要給了就一定畫標題,所以判斷與取值拆成兩個函式(#307)。
 */
export const shouldGroupRoles = (
  options: readonly RoleGroupable[],
): boolean => {
  const tenantTopIds = new Set(
    options.flatMap((option) =>
      option.tenantTopId === null ? [] : [option.tenantTopId],
    ),
  );
  return tenantTopIds.size >= 2;
};

/**
 * 一筆選項的組標題。沒有租戶頂層的(種子角色)歸 `fallback` 那一組,
 * 呼叫端給一個看得懂的字(i18n 由呼叫端負責,ui 不做 i18n)。
 */
export const roleGroupNameOf = (
  option: RoleGroupable,
  fallback: string,
): string => option.tenantTopName ?? fallback;

/** 分組後的一組;`id` 為 null = 不屬於任何租戶(種子角色那一組,或整批不分組時的唯一一組)。 */
export interface RoleMenuGroup {
  id: string | null;
  name: string | null;
  options: RoleMenuOption[];
}

/**
 * 依租戶頂層把清單切成幾段(`shouldGroupRoles` 為 false 時回單一組、標題為 null)。
 * 組的順序 = 各組第一次出現的順序(= api 回的順序),沒有租戶頂層的一組殿後。
 *
 * **只剩角色管理頁的清單面板用**:那裡是自己畫的分段清單,不是選單。
 * 三個選單自 #307 起改用 Autocomplete,分組交給它的 `groupBy`(配
 * `shouldGroupRoles` + `roleGroupNameOf`),不必先把資料切成巢狀結構。
 */
export const groupRoleOptions = (
  options: readonly RoleMenuOption[],
): RoleMenuGroup[] => {
  if (!shouldGroupRoles(options)) {
    return [{ id: null, name: null, options: [...options] }];
  }
  const groups = new Map<string, RoleMenuGroup>();
  const ungrouped: RoleMenuOption[] = [];
  for (const option of options) {
    if (option.tenantTopId === null) {
      ungrouped.push(option);
      continue;
    }
    const group = groups.get(option.tenantTopId) ?? {
      id: option.tenantTopId,
      name: option.tenantTopName,
      options: [],
    };
    group.options.push(option);
    groups.set(option.tenantTopId, group);
  }
  return [
    ...groups.values(),
    ...(ungrouped.length === 0
      ? []
      : [{ id: null, name: null, options: ungrouped }]),
  ];
};
