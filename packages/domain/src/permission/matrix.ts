/**
 * 權限矩陣的純函式(前後端同一份,STRUCT-07;規則正本:ADR-0004、
 * docs/modules/role-manager.md「權限矩陣規則」):
 *
 * - 前端:矩陣勾選的即時連動(勾下層補上層、`*` 同層互斥、全選 / 清空整組)
 * - 後端:`saveRoleMatrix` 儲存前的正規化與 subset-only 防越權
 *
 * 不碰 Mongo / React,只吃「最小模組樹介面」({@link MatrixModuleNode}):
 * api 由 `modules` + `permissions` 組、admin 由 `roleMatrix` 的回應組,兩邊都餵得進來。
 * 樹本身要餵「操作者看得到的那棵」— 停用模組 / 停用權限的剔除是餵樹者的事(ADR-0011)。
 */
import { isWildcardKey, ownerModuleKey, wildcardKeyOf } from "./keys";

/** 模組樹節點上的一筆權限(矩陣只需要 key;顯示名等其他欄位由呼叫端自帶)。 */
export interface MatrixPermissionNode {
  key: string;
}

/** 模組樹節點(最小介面:key + 同層權限 + 子模組)。 */
export interface MatrixModuleNode {
  key: string;
  /**
   * 這個模組**自己這一層**的權限。列了個別權限時含不含 `<key>.*` 都可以,矩陣一律自行推導
   * wildcard;但**整層一筆都沒有就是真的沒有**:矩陣不會替它生一筆 `<key>.*`。
   * 餵顯示樹時尤其重要 —— 操作者搆不到的 `*` 列已被剪掉,推導出來的那一筆他根本授不出去。
   */
  permissions?: readonly MatrixPermissionNode[];
  children?: readonly MatrixModuleNode[];
}

/** 模組樹(森林:頂層可有多棵 — overview、system、demo、api)。 */
export type MatrixModuleTree = readonly MatrixModuleNode[];

/** 一份授予:綁的模組(role_module)與綁的權限(role_permission)。 */
export interface PermissionGrant {
  moduleKeys: readonly string[];
  permissionKeys: readonly string[];
}

interface FlatModule {
  node: MatrixModuleNode;
  /** 由根到父的祖先 key。 */
  ancestorKeys: readonly string[];
  /** 自己這一層的個別權限 key(不含 `<key>.*`),依宣告順序。 */
  individualKeys: readonly string[];
  /**
   * 這個模組**在這棵樹上**有沒有可授出的權限(個別筆或 `*` 列,兩者有其一即可)。
   *
   * 沒有 = 這一層根本沒有 `<key>.*` 這回事:可能是模組本來就不帶權限,
   * 也可能餵進來的是顯示樹、而那一列因為操作者搆不到被剪掉了。兩種情況都不得推導出
   * `<key>.*` —— 推出來的那一筆矩陣上看不到、取消不掉,送出必被 subset 檢查擋下。
   */
  hasPermissions: boolean;
}

/** 把樹攤平成「深度優先、父在前」的索引;順序即輸出順序(可預期的 diff 與斷言)。 */
function flatten(tree: MatrixModuleTree): Map<string, FlatModule> {
  const flat = new Map<string, FlatModule>();
  const visit = (
    nodes: MatrixModuleTree,
    ancestorKeys: readonly string[],
  ): void => {
    for (const node of nodes) {
      const permissionKeys = (node.permissions ?? []).map(
        (permission) => permission.key,
      );
      flat.set(node.key, {
        node,
        ancestorKeys,
        individualKeys: permissionKeys.filter((key) => !isWildcardKey(key)),
        hasPermissions: permissionKeys.length > 0,
      });
      visit(node.children ?? [], [...ancestorKeys, node.key]);
    }
  };
  visit(tree, []);
  return flat;
}

/** 子樹的模組 key(含自己),深度優先。 */
function subtreeKeys(node: MatrixModuleNode): string[] {
  return [
    node.key,
    ...(node.children ?? []).flatMap((child) => subtreeKeys(child)),
  ];
}

/**
 * 正規化一份授予,得到**可直接落庫**的形狀(ADR-0004「儲存」段):
 *
 * 1. 樹外的 key 一律丟棄(模組樹是權限的命名空間)
 * 2. 勾下層自動補上層:勾了權限 → 補它的擁有模組;勾了模組 → 補全部祖先模組
 *    (= 矩陣「有子孫被勾的上層為勾選且不可取消」的存檔面:硬把上層拿掉也會被補回來)
 * 3. 同層權限全勾 → 只存該模組的 `*` 一筆;取消其中一筆 → 刪 `*`、存其餘個別筆
 *    (`*` 代表含未來新增,所以輸入已持有 `*` 時恆維持 `*`)
 * 4. 群組列不另存:群組是模組樹上的一個節點,沒有額外的「整組」記錄
 *
 * 輸出依樹的深度優先順序排序,冪等(`normalizeGrant(t, normalizeGrant(t, g))` 相同)。
 */
export function normalizeGrant(
  moduleTree: MatrixModuleTree,
  grant: PermissionGrant,
): PermissionGrant {
  const flat = flatten(moduleTree);
  const knownPermissionKeys = new Set(
    [...flat.values()].flatMap((entry) => [
      ...entry.individualKeys,
      // 這一層有權限可給才推導得出 `*`;整層沒有權限的模組不存在 `<key>.*`(規則 1 的一種)
      ...(entry.hasPermissions ? [wildcardKeyOf(entry.node.key)] : []),
    ]),
  );
  const requested = new Set(
    grant.permissionKeys.filter((key) => knownPermissionKeys.has(key)),
  );

  // 勾下層補上層:勾了權限補它的擁有模組,勾了模組補全部祖先模組
  const moduleKeys = new Set<string>();
  const addModuleWithAncestors = (key: string): void => {
    const entry = flat.get(key);
    if (!entry) {
      return;
    }
    moduleKeys.add(key);
    for (const ancestorKey of entry.ancestorKeys) {
      moduleKeys.add(ancestorKey);
    }
  };
  for (const key of grant.moduleKeys) {
    addModuleWithAncestors(key);
  }
  for (const key of requested) {
    addModuleWithAncestors(ownerModuleKey(key));
  }

  const permissionKeys: string[] = [];
  for (const [key, entry] of flat) {
    const wildcardKey = wildcardKeyOf(key);
    const hasWildcard = requested.has(wildcardKey);
    const held = entry.individualKeys.filter(
      (individualKey) => hasWildcard || requested.has(individualKey),
    );
    // `*` 含未來新增 → 持有 `*`,或同層每一筆都勾了(且這層有權限可勾),都收斂成單筆 `*`
    if (
      hasWildcard ||
      (entry.individualKeys.length > 0 &&
        held.length === entry.individualKeys.length)
    ) {
      permissionKeys.push(wildcardKey);
    } else {
      permissionKeys.push(...held);
    }
  }

  return {
    moduleKeys: [...flat.keys()].filter((key) => moduleKeys.has(key)),
    permissionKeys,
  };
}

/**
 * 展開一份授予給 UI 顯示(ADR-0011 的 `me.modules.permissions` 同形狀):
 * `<模組>.*` → 該模組**自己這一層**的全部權限,且 `*` 本身保留(矩陣的「全部」列要顯示勾選)。
 * 同層語意:父模組的 `*` 不展開到子模組。模組清單只做「樹內過濾 + 依樹排序」(展開只管權限,
 * 不做補上層 — 那是 {@link normalizeGrant} 的事)。
 *
 * **與 {@link normalizeGrant} 同一條 M-10**:只有這棵樹上列得出權限的模組才有
 * `<模組>.*` 可展開。餵顯示樹時,整層被剪掉的模組即使角色實際持有 `<模組>.*` 也不輸出 ——
 * 矩陣上沒有那一列,輸出了只會是一筆看不到、取消不掉的勾選。
 */
export function expandGrant(
  moduleTree: MatrixModuleTree,
  grant: PermissionGrant,
): PermissionGrant {
  const flat = flatten(moduleTree);
  const requested = new Set(grant.permissionKeys);
  const grantedModuleKeys = new Set(grant.moduleKeys);

  const permissionKeys: string[] = [];
  for (const [key, entry] of flat) {
    const wildcardKey = wildcardKeyOf(key);
    if (entry.hasPermissions && requested.has(wildcardKey)) {
      permissionKeys.push(wildcardKey, ...entry.individualKeys);
      continue;
    }
    permissionKeys.push(
      ...entry.individualKeys.filter((individualKey) =>
        requested.has(individualKey),
      ),
    );
  }

  return {
    moduleKeys: [...flat.keys()].filter((key) => grantedModuleKeys.has(key)),
    permissionKeys,
  };
}

/**
 * 防越權(ADR-0004「操作者只能授出自身有效權限集的子集」):
 * candidate 的每個模組都要在 holder 的模組內;每筆權限要嘛 holder 精確持有,
 * 要嘛 holder 持有該權限**擁有模組**的 `*`(`X.*` 可授出 X 這層任何權限與 `X.*` 本身;
 * 子模組的 `*` 要自己持有)。兩份都當已正規化或已展開皆可,判斷不依賴形狀。
 *
 * 超級管理員的 bypass 不在這裡(ADR-0004:解析時直接全權放行,不靠權限記錄)。
 */
export function isSubsetOf(
  candidate: PermissionGrant,
  holder: PermissionGrant,
): boolean {
  const holderModuleKeys = new Set(holder.moduleKeys);
  if (!candidate.moduleKeys.every((key) => holderModuleKeys.has(key))) {
    return false;
  }
  const holderPermissionKeys = new Set(holder.permissionKeys);
  return candidate.permissionKeys.every(
    (key) =>
      holderPermissionKeys.has(key) ||
      holderPermissionKeys.has(wildcardKeyOf(ownerModuleKey(key))),
  );
}

/**
 * 頂層模組列的「全選整組 / 清空整組」(role-manager.md):
 * 開 = 對子樹**每個模組**(含群組本身)寫入一筆 `*` 並勾上模組;
 * 關 = 清掉整個子樹的模組與權限(子樹以外不受影響)。結果為正規化後的授予。
 *
 * `*` 只寫給**這棵樹上真的有權限可給**的模組:群組節點本身常常一層權限都沒有,
 * 餵顯示樹時那一列更可能是因為操作者搆不到而被剪掉 —— 硬寫一筆 `<key>.*` 會產出
 * 矩陣上看不到、使用者也取消不掉的授予,送出後只會換來 `ROLE_OUT_OF_REACH`。
 */
export function toggleWholeGroup(
  moduleTree: MatrixModuleTree,
  grant: PermissionGrant,
  groupKey: string,
  on: boolean,
): PermissionGrant {
  const flat = flatten(moduleTree);
  const group = flat.get(groupKey);
  if (!group) {
    return normalizeGrant(moduleTree, grant);
  }
  const keys = new Set(subtreeKeys(group.node));

  if (!on) {
    return normalizeGrant(moduleTree, {
      moduleKeys: grant.moduleKeys.filter((key) => !keys.has(key)),
      permissionKeys: grant.permissionKeys.filter(
        (key) => !keys.has(ownerModuleKey(key)),
      ),
    });
  }
  return normalizeGrant(moduleTree, {
    moduleKeys: [...grant.moduleKeys, ...keys],
    permissionKeys: [
      ...grant.permissionKeys,
      ...[...keys].flatMap((key) =>
        flat.get(key)?.hasPermissions === true ? [wildcardKeyOf(key)] : [],
      ),
    ],
  });
}

/**
 * 群組列的勾選狀態是**衍生**的(ADR-0004:子樹每個模組都有 `*` 才顯示勾,不另存記錄)。
 * 這一層沒有權限可給的模組只看模組本身有沒有勾(它沒有 `*` 可以持有,
 * 要求一筆不存在的 `<key>.*` 會讓整組開關永遠顯示成沒開)。
 */
export function isWholeGroupGranted(
  moduleTree: MatrixModuleTree,
  grant: PermissionGrant,
  groupKey: string,
): boolean {
  const flat = flatten(moduleTree);
  const group = flat.get(groupKey);
  if (!group) {
    return false;
  }
  const normalized = normalizeGrant(moduleTree, grant);
  const moduleKeys = new Set(normalized.moduleKeys);
  const permissionKeys = new Set(normalized.permissionKeys);
  return subtreeKeys(group.node).every(
    (key) =>
      moduleKeys.has(key) &&
      (flat.get(key)?.hasPermissions !== true ||
        permissionKeys.has(wildcardKeyOf(key))),
  );
}
