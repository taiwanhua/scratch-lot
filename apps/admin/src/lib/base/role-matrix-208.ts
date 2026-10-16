import {
  type MatrixModuleNode,
  type MatrixModuleTree,
  type PermissionGrant,
  expandGrant,
  isWildcardKey,
  normalizeGrant,
  ownerModuleKey,
  wildcardKeyOf,
} from "@repo/domain/permission";

/**
 * 權限矩陣的畫面狀態換算(#208;規則正本 ADR-0004、`docs/modules/role-manager.md`「權限矩陣規則」)。
 *
 * **連動規則一律由 `@repo/domain/permission` 算**(前後端同一份):本檔只做兩件事 —
 * ①把一份授予換成 `Tree` 需要的三組 id(勾選 / 三態 / 不可取消)
 * ②把使用者「勾了哪一列」翻成新的授予,再交給 `normalizeGrant` 收斂。
 *
 * 樹一律用 `roleMatrix.modules` 回的那棵顯示樹(role-manager.md「矩陣的兩棵樹」):
 * 顯示與連動計算餵同一棵,前端不自己拼樹、也不自己算防越權。
 *
 * 列 id = 模組 key 或權限 key:ADR-0004 保證兩者永不同字串(動作禁用 `-page` 結尾),
 * 所以同一個命名空間可以直接當 `Tree` 的節點 id。
 */

interface FlatEntry {
  /** 自己這一層的個別權限 key(不含 `*`) */
  individualKeys: readonly string[];
  /** 子樹的模組 key(含自己),深度優先 */
  subtreeKeys: readonly string[];
  /** 直接子列 = 自己這層的權限列(含 `*`)+ 子模組列;三態看它 */
  childRowIds: readonly string[];
}

const subtreeOf = (node: MatrixModuleNode): string[] => [
  node.key,
  ...(node.children ?? []).flatMap((child) => subtreeOf(child)),
];

/** 攤平成「模組 key → 這個模組的列關係」;深度優先、父在前(輸出順序可預期)。 */
const flatten = (tree: MatrixModuleTree): Map<string, FlatEntry> => {
  const flat = new Map<string, FlatEntry>();
  const visit = (nodes: MatrixModuleTree): void => {
    for (const node of nodes) {
      const permissionKeys = (node.permissions ?? []).map(
        (permission) => permission.key,
      );
      flat.set(node.key, {
        individualKeys: permissionKeys.filter((key) => !isWildcardKey(key)),
        subtreeKeys: subtreeOf(node),
        childRowIds: [
          ...permissionKeys,
          ...(node.children ?? []).map((child) => child.key),
        ],
      });
      visit(node.children ?? []);
    }
  };
  visit(tree);
  return flat;
};

export interface MatrixSelection {
  /** 勾起來的列(已展開 `*`,所以同層各筆也會是勾的) */
  checkedIds: string[];
  /** 三態:自己勾了、但直接子列只勾了一部分 */
  indeterminateIds: string[];
  /** 勾選框不可動(仍可展開):有子孫模組被勾的上層,加上呼叫端鎖住的列 */
  disabledCheckIds: string[];
}

export interface MatrixSelectionOptions {
  /**
   * 額外鎖住的列:租戶副本(`shrinkOnly`)未持有的列、沒有 `edit-matrix` 權限時的全部列。
   */
  lockedIds?: readonly string[];
}

/** 一份授予 → `Tree` 的三組 id。 */
export const matrixSelectionOf = (
  tree: MatrixModuleTree,
  grant: PermissionGrant,
  { lockedIds = [] }: MatrixSelectionOptions = {},
): MatrixSelection => {
  const flat = flatten(tree);
  const expanded = expandGrant(tree, grant);
  const checked = new Set<string>([
    ...expanded.moduleKeys,
    ...expanded.permissionKeys,
  ]);

  const indeterminateIds: string[] = [];
  const disabledCheckIds = new Set<string>(lockedIds);
  for (const [key, entry] of flat) {
    if (checked.has(key) && entry.childRowIds.length > 0) {
      const checkedChildren = entry.childRowIds.filter((id) => checked.has(id));
      if (
        checkedChildren.length > 0 &&
        checkedChildren.length < entry.childRowIds.length
      ) {
        indeterminateIds.push(key);
      }
    }
    // ADR-0004:有子孫被勾的上層為「勾選且不可取消」— 先取消子孫才能收掉整棵
    if (entry.subtreeKeys.some((sub) => sub !== key && checked.has(sub))) {
      disabledCheckIds.add(key);
    }
  }

  return {
    checkedIds: [...checked],
    indeterminateIds,
    disabledCheckIds: [...disabledCheckIds],
  };
};

/**
 * 使用者勾 / 取消一列後的新授予。取消的三種語意(ADR-0004「儲存」段):
 *
 * - 取消模組 → 清掉整個子樹的模組與它們的權限(上層有子孫被勾時本來就不可取消)
 * - 取消「全部(`*`)」→ 清掉該模組這一層(`*` 是「這層全給」,收掉就是整層收掉)
 * - 取消同層任一筆 → 連 `*` 一起解除,其餘改存個別筆(由 `normalizeGrant` 收斂)
 *
 * 勾的方向不必特別處理:`normalizeGrant` 會補上層、同層全勾時收斂回 `*`。
 */
export const nextGrantFromSelection = (
  tree: MatrixModuleTree,
  currentIds: readonly string[],
  nextIds: readonly string[],
): PermissionGrant => {
  const flat = flatten(tree);
  const nextSet = new Set(nextIds);
  const removed = currentIds.filter((id) => !nextSet.has(id));

  const moduleKeys = new Set([...nextSet].filter((id) => flat.has(id)));
  const permissionKeys = new Set([...nextSet].filter((id) => !flat.has(id)));

  const dropModuleSubtree = (entry: FlatEntry): void => {
    const dropped = new Set(entry.subtreeKeys);
    for (const key of dropped) {
      moduleKeys.delete(key);
    }
    // Set 在迭代中刪除目前這一筆是安全的(不影響尚未走到的元素)
    for (const key of permissionKeys) {
      if (dropped.has(ownerModuleKey(key))) {
        permissionKeys.delete(key);
      }
    }
  };

  for (const id of removed) {
    const moduleEntry = flat.get(id);
    if (moduleEntry !== undefined) {
      dropModuleSubtree(moduleEntry);
      continue;
    }
    const owner = ownerModuleKey(id);
    permissionKeys.delete(id);
    if (isWildcardKey(id)) {
      for (const key of flat.get(owner)?.individualKeys ?? []) {
        permissionKeys.delete(key);
      }
    } else {
      permissionKeys.delete(wildcardKeyOf(owner));
    }
  }

  return normalizeGrant(tree, {
    moduleKeys: [...moduleKeys],
    permissionKeys: [...permissionKeys],
  });
};

/** 樹上的全部列 id(模組 + 權限);沒有 `edit-matrix` 權限時整份鎖住。 */
export const allMatrixRowIds = (tree: MatrixModuleTree): string[] => {
  const flat = flatten(tree);
  return [...flat.keys()].flatMap((key) => [
    key,
    ...(flat.get(key)?.childRowIds ?? []).filter((id) => !flat.has(id)),
  ]);
};

/**
 * 一份授予**涵蓋不到**的列。兩個呼叫端、同一種算法:
 * - `ungrantedMatrixRowIds`:目前沒有勾的列(`shrinkOnly` 只能縮不能擴)
 * - `outOfCeilingMatrixRowIds`:天花板外的列(`ceiling`,#283)
 *
 * 兩者都是防呆不是把關:api 仍會回 `ROLE_OUT_OF_REACH`,前端先鎖住免得送出才吃錯誤。
 */
const rowIdsOutside = (
  tree: MatrixModuleTree,
  grant: PermissionGrant,
): string[] => {
  const expanded = expandGrant(tree, grant);
  const covered = new Set([...expanded.moduleKeys, ...expanded.permissionKeys]);
  return allMatrixRowIds(tree).filter((id) => !covered.has(id));
};

/**
 * 目前**沒有**授予的列(租戶副本只能縮不能擴,`RoleMatrixPayload.shrinkOnly`):
 * 前端直接把這些列設成不可勾,免得送出後才吃到 `ROLE_OUT_OF_REACH`。
 */
export const ungrantedMatrixRowIds = rowIdsOutside;

/**
 * **天花板之外**的列(`RoleMatrixPayload.ceiling`,#283):預設角色的矩陣上限是
 * 內建「租戶管理員」模板角色目前的授予,模板沒有的項目 root 與租戶都勾不動。
 */
export const outOfCeilingMatrixRowIds = rowIdsOutside;

const byKey = (left: string, right: string): number =>
  left.localeCompare(right);

const signatureOf = (grant: PermissionGrant): string =>
  JSON.stringify([
    grant.moduleKeys.toSorted(byKey),
    grant.permissionKeys.toSorted(byKey),
  ]);

/** 兩份授予正規化後是否相同(判斷「有未儲存的變更」)。 */
export const isSameGrant = (
  tree: MatrixModuleTree,
  left: PermissionGrant,
  right: PermissionGrant,
): boolean =>
  signatureOf(normalizeGrant(tree, left)) ===
  signatureOf(normalizeGrant(tree, right));
