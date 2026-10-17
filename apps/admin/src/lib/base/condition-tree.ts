/**
 * 條件樹的**通用純模型**:資料範圍的「條件組合」與人員條件(AudiencePicker)共用同一種樹 ——
 * 群組 `op` + `children`、條件列由各自的模型定義(`kind: "condition"`)。
 * 畫面在 `components/base/condition-tree/`,兩棵樹只差欄位清單與條件列的內容。
 *
 * 節點不帶自產的 id:位置(從根群組往下的 `childPath`)就是身分 ——
 * 與 api 回的 `path`(`children[i]`)同一套座標,錯誤標記不必再配對。
 */

/** 群組運算子(JSON 值,每層可切)。 */
export type ConditionGroupOp = "AND" | "OR";

export const CONDITION_GROUP_OPS: readonly ConditionGroupOp[] = ["AND", "OR"];

/**
 * UI 上的巢狀上限(根群組算第 1 層;ADR-0008「任意深、UI 建議 3 層」、人員條件
 * `AUDIENCE_MAX_DEPTH`):`childPath.length` 到 2 的群組不再能加群組。
 */
export const CONDITION_TREE_MAX_DEPTH = 3;

/** 條件列只要求帶 `kind: "condition"`,其餘欄位由使用處決定。 */
export interface ConditionLeaf {
  kind: "condition";
}

export interface ConditionTreeGroup<L extends ConditionLeaf> {
  kind: "group";
  op: ConditionGroupOp;
  children: ConditionTreeNode<L>[];
}

export type ConditionTreeNode<L extends ConditionLeaf> =
  ConditionTreeGroup<L> | L;

/** 這個位置的群組還能不能再加一層子群組(第 3 層不行)。 */
export const canAddGroupAt = (childPath: readonly number[]): boolean =>
  childPath.length < CONDITION_TREE_MAX_DEPTH - 1;

const replaceAt = <T>(items: readonly T[], index: number, next: T): T[] =>
  items.map((item, position) => (position === index ? next : item));

/** 依 `childPath` 取節點;空路徑就是根群組,路徑走不到回 `undefined`。 */
export const nodeAt = <L extends ConditionLeaf>(
  group: ConditionTreeGroup<L>,
  childPath: readonly number[],
): ConditionTreeNode<L> | undefined => {
  let current: ConditionTreeNode<L> = group;
  for (const index of childPath) {
    if (current.kind !== "group" || index >= current.children.length) {
      return undefined;
    }
    current = current.children[index];
  }
  return current;
};

/** 依 `childPath` 換掉一個節點(回傳新的根群組);`next` 為 null 代表刪除該節點。 */
export const replaceNode = <L extends ConditionLeaf>(
  group: ConditionTreeGroup<L>,
  childPath: readonly number[],
  next: ConditionTreeNode<L> | null,
): ConditionTreeGroup<L> => {
  if (childPath.length === 0) {
    return next !== null && next.kind === "group" ? next : group;
  }
  const [index, ...rest] = childPath;
  if (index >= group.children.length) {
    return group;
  }
  if (rest.length === 0) {
    return {
      ...group,
      children:
        next === null
          ? group.children.filter((_, position) => position !== index)
          : replaceAt(group.children, index, next),
    };
  }
  const child = group.children[index];
  return child.kind === "group"
    ? {
        ...group,
        children: replaceAt(
          group.children,
          index,
          replaceNode(child, rest, next),
        ),
      }
    : group;
};

/** 在 `childPath` 指到的群組尾端加一個節點。 */
export const appendChild = <L extends ConditionLeaf>(
  group: ConditionTreeGroup<L>,
  childPath: readonly number[],
  node: ConditionTreeNode<L>,
): ConditionTreeGroup<L> => {
  const target = nodeAt(group, childPath);
  if (target?.kind !== "group") {
    return group;
  }
  return replaceNode(group, childPath, {
    ...target,
    children: [...target.children, node],
  });
};

/** 新群組帶一條條件列:空群組不合法,不讓它先出現在畫面上。 */
export const groupOf = <L extends ConditionLeaf>(
  condition: L,
): ConditionTreeGroup<L> => ({
  kind: "group",
  op: "AND",
  children: [condition],
});

/** 錯誤標記與 React key 共用的座標字串。 */
export const childPathKey = (childPath: readonly number[]): string =>
  childPath.join(".");

const CHILD_INDEX = /\.?children\[(\d+)]/g;

/**
 * api 錯誤路徑裡的條件樹那一段(如 `children[1].children[0].value.values[0]`)→
 * `childPath` + 指到的那一格(`children[...]` 之後剩下的第一段;沒有剩下 = 節點本身)。
 */
export const locateInTree = (
  treePath: string,
): { childPath: number[]; rest: string } => {
  const childPath = [...treePath.matchAll(CHILD_INDEX)].map((matched) =>
    Number(matched[1]),
  );
  const lastIndex = treePath.lastIndexOf("children[");
  const after =
    lastIndex === -1
      ? treePath
      : treePath.slice(treePath.indexOf("]", lastIndex) + 1);
  return { childPath, rest: after.replace(/^\./, "") };
};
