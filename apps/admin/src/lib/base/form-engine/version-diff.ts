import type { FieldDef } from "@repo/domain/form";

/**
 * 版本面板的「與上一版差異」(Spec 6a §8 畫面 3):以欄位 key 比對兩版定義 ——
 * 新增 / 移除 / 定義有變(型別、顯示名、規則、條件…任一處不同)。版面與摘要槽的差異另列一旗標。
 */
export interface VersionDiff {
  added: FieldDef[];
  removed: FieldDef[];
  changed: FieldDef[];
}

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).toSorted(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : item,
  );

export const versionDiff = (
  previous: readonly FieldDef[],
  current: readonly FieldDef[],
): VersionDiff => {
  const before = new Map(previous.map((field) => [field.key, field]));
  const after = new Map(current.map((field) => [field.key, field]));
  return {
    added: current.filter((field) => !before.has(field.key)),
    removed: previous.filter((field) => !after.has(field.key)),
    changed: current.filter((field) => {
      const old = before.get(field.key);
      return old !== undefined && stable(old) !== stable(field);
    }),
  };
};
