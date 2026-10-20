import type { PortableLookupProvider } from "@repo/domain/seed";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `seedLookupProviders` 的形狀檢查(逐筆):來源 key → `{ filters: { 條件 key: (字串 | 布林)[] } }`。
 * 不合就拋錯並指出哪一筆、哪一欄;沒有給(`undefined`)= 空。
 */
export function portableLookupProvidersOf(
  value: unknown,
  registryPath: string,
): Readonly<Record<string, PortableLookupProvider>> {
  if (value === undefined) {
    return {};
  }
  const where = `registry 檔 ${registryPath} 的 seedLookupProviders`;
  if (!isPlainObject(value)) {
    throw new TypeError(`${where} 必須是物件(來源 key → { filters })`);
  }
  for (const [key, provider] of Object.entries(value)) {
    if (!isPlainObject(provider) || !isPlainObject(provider.filters)) {
      throw new TypeError(`${where}.${key} 必須是 { filters: 物件 }`);
    }
    for (const [name, allowed] of Object.entries(provider.filters)) {
      if (
        !Array.isArray(allowed) ||
        !allowed.every(
          (item) => typeof item === "string" || typeof item === "boolean",
        )
      ) {
        throw new TypeError(
          `${where}.${key}.filters.${name} 必須是字串或布林的陣列`,
        );
      }
    }
  }
  return value as Readonly<Record<string, PortableLookupProvider>>;
}
