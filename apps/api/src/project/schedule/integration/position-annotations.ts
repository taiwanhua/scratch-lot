/**
 * 給刮刮樂的登記接縫:崗位旁的註記(規格 14.9「排班表上崗位旁顯示對應的收銀點名稱(由刮刮樂登記提供)」)。
 *
 * 依賴方向是刮刮樂 → 排班:排班不知道刮刮樂存在,只開這個登記介面;刮刮樂在自己的模組裡呼叫
 * `registerPositionAnnotationProvider`,排班畫面要顯示時呼叫 `positionAnnotationsOf`。
 * 沒有任何登記時回空物件(崗位旁不顯示註記)。
 */

/** 某租戶某家店:崗位 key → 註記文字(例:`{ "in-store-counter": "櫃台 A" }`)。 */
export type PositionAnnotationProvider = (
  tenantId: string,
  orgId: string,
) => Promise<Record<string, string>>;

const providers: PositionAnnotationProvider[] = [];

/** 登記一個提供者(多個提供者的結果依登記順序合併,後登記的蓋過同一個崗位)。 */
export function registerPositionAnnotationProvider(
  provider: PositionAnnotationProvider,
): void {
  providers.push(provider);
}

/** 某家店各崗位的註記。 */
export async function positionAnnotationsOf(
  tenantId: string,
  orgId: string,
): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const provider of providers) {
    Object.assign(merged, await provider(tenantId, orgId));
  }
  return merged;
}

/** 只給測試用:清空登記。 */
export function clearPositionAnnotationProvidersForTest(): void {
  providers.length = 0;
}
