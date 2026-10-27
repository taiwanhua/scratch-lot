/**
 * 給刮刮樂的登記接縫:哪些排班不能刪(規格 14.9「已被收銀班次綁定的排班不能刪除」)。
 *
 * 依賴方向是刮刮樂 → 排班:刮刮樂呼叫 `registerEntryDeletionGuard` 登記「這些排班裡哪些已被綁定」,
 * 排班作業刪除排班(含「移除這天所有排班」、刪除人力需求連帶刪排班)前呼叫 `blockedEntryIdsOf`,
 * 被擋的擋下並列出。沒有任何登記時回空集合(都能刪)。
 */

/** 某租戶的這些排班 id 中,不能刪的那幾筆。 */
export type EntryDeletionGuard = (
  tenantId: string,
  entryIds: readonly string[],
) => Promise<Set<string>>;

const guards: EntryDeletionGuard[] = [];

export function registerEntryDeletionGuard(guard: EntryDeletionGuard): void {
  guards.push(guard);
}

/** 所有登記的聯集。 */
export async function blockedEntryIdsOf(
  tenantId: string,
  entryIds: readonly string[],
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (entryIds.length === 0) {
    return blocked;
  }
  for (const guard of guards) {
    for (const id of await guard(tenantId, entryIds)) {
      blocked.add(id);
    }
  }
  return blocked;
}

/** 只給測試用:清空登記。 */
export function clearEntryDeletionGuardsForTest(): void {
  guards.length = 0;
}
