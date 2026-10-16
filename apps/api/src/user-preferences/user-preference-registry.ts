/**
 * 個人偏好的登記制(規格 10.6):`user_preferences.settings` 只收**登記過**的 key,
 * 每個 key 宣告型別與預設值。底座的登記在本檔 `BASE_USER_PREFERENCES`,
 * 專案的在 `src/project/user-preferences.ts`(固定入口,由 `app.module.ts` 經
 * `UserPreferenceRegistryModule.forRoot` 組裝);兩份合成時驗 key 格式與不重複,不合就讓 app 起不來。
 */

/** 偏好值的型別(值一律是 JSON 純量;要多個值就登記多個 key)。 */
export type UserPreferenceType = "string" | "boolean" | "number";

export type UserPreferenceValue = string | boolean | number;

export interface UserPreferenceDefinition {
  /** 存進 `settings` 的 key:英數開頭、只含英數與 `-` / `_`(不可含 `.` 與 `$`,它們在 Mongo 的更新路徑有意義) */
  readonly key: string;
  readonly type: UserPreferenceType;
  /** 使用者沒設定過時讀到的值;`null` = 「沒有設定」(由前端決定怎麼退回,例:語言用本機快取) */
  readonly defaultValue: UserPreferenceValue | null;
  /** `string` 型別的格式限制(整段比對) */
  readonly pattern?: RegExp;
  /** `string` 型別的長度上限 */
  readonly maxLength?: number;
  /**
   * 只收這幾個值(任何型別都可用;例:不能關的通知管道開關只收 `true`)。
   * 由登記決定、不能由使用者放寬;值不在其中 → `VALIDATION_FAILED` / `INVALID_VALUE`。
   */
  readonly allowedValues?: readonly UserPreferenceValue[];
}

/** 登記不合契約(key 格式不對、重複、預設值型別不符)時拋出;屬程式錯誤,讓 app 起不來。 */
export class UserPreferenceRegistryError extends Error {
  override name = "UserPreferenceRegistryError";
}

const KEY_PATTERN = /^[A-Za-z][\w-]*$/;

/** BCP 47 語言標籤的寬鬆形狀(`zh-TW`、`en`):api 不列支援的語系,前端認不得的值視同沒有設定。 */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z\d]{2,8})*$/;

/** 語言:跟著帳號走(規格 10.6;規範 I18N-05);前端另存一份本機快取供登入前與第一個畫面使用。 */
export const LOCALE_PREFERENCE_KEY = "locale";

/**
 * 底座登記的偏好。通知管道開關不寫在這裡:由通知類型登記推導(`notificationPreferenceDefinitions`,
 * `apps/api/src/notifications/notification-registry.ts`),經 `forRoot` 的第二個參數合成(規格 10.6)。
 */
export const BASE_USER_PREFERENCES: readonly UserPreferenceDefinition[] = [
  {
    key: LOCALE_PREFERENCE_KEY,
    type: "string",
    defaultValue: null,
    pattern: LANGUAGE_TAG,
    maxLength: 35,
  },
];

/** 值符不符合這個 key 的登記(`null` 不在這裡判斷:它一律代表「拿掉、回到預設」)。 */
export function isValidPreferenceValue(
  definition: UserPreferenceDefinition,
  value: unknown,
): value is UserPreferenceValue {
  if (
    definition.allowedValues !== undefined &&
    !definition.allowedValues.includes(value as UserPreferenceValue)
  ) {
    return false;
  }
  switch (definition.type) {
    case "boolean": {
      return typeof value === "boolean";
    }
    case "number": {
      return typeof value === "number" && Number.isFinite(value);
    }
    case "string": {
      return (
        typeof value === "string" &&
        (definition.maxLength === undefined ||
          value.length <= definition.maxLength) &&
        (definition.pattern === undefined || definition.pattern.test(value))
      );
    }
  }
}

/**
 * 合成底座、專案與推導出的登記:key → 定義。key 格式不對、重複、預設值不合型別一律拋錯。
 * `derived` 是由其他登記推導的偏好(通知類型 × 管道的開關),與手寫的登記同樣驗證、不可撞 key。
 */
export function composeUserPreferences(
  base: readonly UserPreferenceDefinition[],
  project: readonly UserPreferenceDefinition[],
  derived: readonly UserPreferenceDefinition[] = [],
): ReadonlyMap<string, UserPreferenceDefinition> {
  const registry = new Map<string, UserPreferenceDefinition>();
  const sourced = [
    ...base.map((definition) => ["base", definition] as const),
    ...project.map((definition) => ["project", definition] as const),
    ...derived.map((definition) => ["derived", definition] as const),
  ];
  for (const [source, definition] of sourced) {
    if (!KEY_PATTERN.test(definition.key)) {
      throw new UserPreferenceRegistryError(
        `${source} 的偏好 key「${definition.key}」格式不對:英數開頭,只能有英數、- 與 _`,
      );
    }
    if (registry.has(definition.key)) {
      throw new UserPreferenceRegistryError(
        `偏好 key「${definition.key}」重複登記(${source})`,
      );
    }
    if (
      definition.defaultValue !== null &&
      !isValidPreferenceValue(definition, definition.defaultValue)
    ) {
      throw new UserPreferenceRegistryError(
        `${source} 的偏好「${definition.key}」預設值不符合登記的型別`,
      );
    }
    registry.set(definition.key, definition);
  }
  return registry;
}
