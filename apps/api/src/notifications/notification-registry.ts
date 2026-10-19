import {
  AUDIENCE_ORG_RANGES,
  type Audience,
  type AudienceOptions,
  type AudienceOrgRange,
  validateAudience,
} from "@repo/domain/audience";

import type { UserPreferenceDefinition } from "../user-preferences/user-preference-registry";
import {
  NOTIFICATION_SCHEDULE_KINDS,
  type NotificationSchedule,
  validateSchedule,
} from "./notification-schedule";

/**
 * 通知的登記制:
 * 類型、管道、連結都在這裡定義型別與驗證;底座的登記在 `base-notification-types.ts`,
 * 專案的在 `src/project/notifications.ts`(固定入口,由 `app.module.ts` 經
 * `NotificationRegistryModule.forRoot` 組裝)。兩份合成時驗格式與不重複,不合就讓 app 起不來。
 */

/** 站內通知:寫進 `notifications`,並對收件人送 `notification` 信號。 */
export const IN_APP_CHANNEL = "in-app";

/** email:交易後經 `MailService` 寄出(總開關 `WORKFLOW_MAIL_ENABLED`)。 */
export const EMAIL_CHANNEL = "email";

/**
 * 已登記的管道(每個管道一個轉接器,見 `notification-channels.ts`)。新增管道(例:手機推播)=
 * 在這裡加 key、寫一個轉接器並加進 `NOTIFICATION_CHANNEL_ADAPTERS`;所有類型都能把它放進
 * `defaultChannels`,`notify()` 的呼叫方式不變。
 */
export const NOTIFICATION_CHANNELS: readonly string[] = [
  IN_APP_CHANNEL,
  EMAIL_CHANNEL,
];

/** 通知類別:`party` = 當事人通知(收件人由事件決定)、`responsible` = 負責人提醒(組織範圍 × 人員條件)。 */
export const NOTIFICATION_CATEGORIES = ["party", "responsible"] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** 範本收到的參數(呼叫 `notify` 時給;值一律字串,沒有就 null)。 */
export type NotificationParams = Readonly<Record<string, string | null>>;

/** 範本產生的標題與內容(純文字)。 */
export interface NotificationContent {
  title: string;
  body: string;
}

export type NotificationTemplate = (
  params: NotificationParams,
) => NotificationContent;

/** 範本一定要有的語系;收件人的語言找不到對應範本時也退回它。 */
export const NOTIFICATION_DEFAULT_LOCALE = "zh-TW";

/**
 * 負責人提醒的組織範圍(類型宣告、租戶不能改):從事件的組織(`event-org`)或租戶頂層(`tenant`)起算,
 * `range` 同人員條件的所屬組織範圍(本身 / 含下層 / 含上層)。
 */
export interface NotificationOrgScope {
  ref: "event-org" | "tenant";
  range: AudienceOrgRange;
}

/**
 * 類型的「可調時間」宣告(選填;沒宣告 = 一發生就寄):寫法與預設值由 `default` 決定,
 * 租戶只能改值、不能換寫法。
 */
export interface NotificationScheduleDeclaration {
  readonly default: NotificationSchedule;
  /**
   * `days-before` 才能給:日期的稱呼(例「到期」「繳費日」),通知設定頁的摘要寫成
   * 「到期前 30、7 天及當天 09:00」;沒給 = 「日期前 …」。
   */
  readonly dateLabel?: string;
}

export interface NotificationTypeDefinition {
  /** 例 `workflow.task-created`:`<領域>.<名稱>`,小寫英數與 `-`,以 `.` 分段(至少兩段) */
  readonly key: string;
  /** 顯示名稱(繁中預設;前端可依 key 從訊息檔覆寫) */
  readonly name: string;
  /** 預設送出的管道:多選、至少一個,必須是已登記的管道 */
  readonly defaultChannels: readonly string[];
  /** `defaultChannels` 每個管道可否由收件人在個人偏好關閉(key 必須與 `defaultChannels` 相同) */
  readonly canDisable: Readonly<Record<string, boolean>>;
  /** 標題 / 內容範本(語系 → 範本;一定要有 `NOTIFICATION_DEFAULT_LOCALE`) */
  readonly template: Readonly<Record<string, NotificationTemplate>>;
  readonly category: NotificationCategory;
  /** 負責人提醒才有(且必填):組織範圍 */
  readonly orgScope?: NotificationOrgScope;
  /** 負責人提醒才有(且必填):預設人員條件(只能用使用者、角色、權限;組織範圍由 `orgScope` 決定) */
  readonly defaultAudience?: Audience;
  /** 當事人通知才能給:收件人說明(通知設定頁顯示「由事件決定(<說明>)」),例「可排這家店的排班人員」 */
  readonly recipientNote?: string;
  /** 選填:可調時間(三種寫法之一與預設值);當事人通知也可以宣告 */
  readonly schedule?: NotificationScheduleDeclaration;
}

/**
 * 連結登記表(`refType` → 頁面路由,登記方式同 lookup 登錄表):`path` 是 admin 的站內路徑,
 * 以 `{refId}` 代入通知的 `refId`,例 `/apply-center/view-page/{refId}`。
 */
export interface NotificationLinkRegistration {
  readonly refType: string;
  readonly path: string;
}

/** 登記不合契約時拋出;屬程式錯誤,讓 app 起不來。 */
export class NotificationRegistryError extends Error {
  override name = "NotificationRegistryError";
}

/**
 * 負責人提醒的人員條件能用什麼(通知設定頁與類型的預設條件共用):不能選「所有人」;
 * **不含所屬組織欄** —— 組織範圍由類型宣告,租戶不能改。
 */
export const NOTIFICATION_AUDIENCE_OPTIONS: AudienceOptions = {
  allowAll: false,
  fields: ["user", "role", "permission"],
  orgSources: [],
};

const TYPE_KEY_PATTERN = /^[a-z][\da-z-]*(?:\.[a-z][\da-z-]*)+$/;
const CHANNEL_KEY_PATTERN = /^[a-z][\da-z-]*$/;
const REF_TYPE_PATTERN = /^[a-z][\da-z-]*$/;
const REF_ID_PLACEHOLDER = "{refId}";

/** 個人偏好裡通知管道開關的 key 前綴。 */
export const NOTIFICATION_PREFERENCE_PREFIX = "notification";

/**
 * 「類型 × 管道」開關在個人偏好(`user_preferences.settings`)裡的 key:
 * `notification_<類型 key 的 . 換成 _>_<管道>`,例 `workflow.task-created` × `in-app` →
 * `notification_workflow_task-created_in-app`。偏好 key 不能含 `.`;類型 key 與管道 key 都不含 `_`,
 * 所以以 `_` 切開就能還原(第一段是前綴、最後一段是管道、中間是類型的各段)。
 */
export function notificationPreferenceKey(
  typeKey: string,
  channel: string,
): string {
  return `${NOTIFICATION_PREFERENCE_PREFIX}_${typeKey.replaceAll(".", "_")}_${channel}`;
}

/**
 * 由通知類型推導的個人偏好登記:每種類型的每個 `defaultChannels` 一個布林開關,預設開;
 * `canDisable` 為否的管道只收 `true`(要關 → `VALIDATION_FAILED` / `INVALID_VALUE`)。
 */
export function notificationPreferenceDefinitions(
  types: ReadonlyMap<string, NotificationTypeDefinition>,
): UserPreferenceDefinition[] {
  return [...types.values()].flatMap((type) =>
    type.defaultChannels.map((channel): UserPreferenceDefinition => ({
      key: notificationPreferenceKey(type.key, channel),
      type: "boolean",
      defaultValue: true,
      ...(type.canDisable[channel] === false && { allowedValues: [true] }),
    })),
  );
}

/** 依收件人的語言挑範本:完全相同 → 同語言(`en-US` → `en`)→ 預設語系。 */
export function templateFor(
  type: NotificationTypeDefinition,
  locale: string | null,
): NotificationTemplate {
  const templates = type.template;
  if (locale !== null) {
    const exact = templates[locale];
    if (exact) {
      return exact;
    }
    const [language] = locale.split("-", 1);
    const sameLanguage = Object.entries(templates).find(
      ([candidate]) => candidate.split("-", 1)[0] === language,
    );
    if (sameLanguage) {
      return sameLanguage[1];
    }
  }
  const fallback = templates[NOTIFICATION_DEFAULT_LOCALE];
  if (!fallback) {
    throw new NotificationRegistryError(
      `通知類型「${type.key}」沒有 ${NOTIFICATION_DEFAULT_LOCALE} 範本`,
    );
  }
  return fallback;
}

/** 連結登記表 → 站內路徑;沒有登記這個 `refType` 或沒有 ref → null。 */
export function notificationLinkOf(
  links: ReadonlyMap<string, NotificationLinkRegistration>,
  refType: string | null,
  refId: string | null,
): string | null {
  if (refType === null || refId === null) {
    return null;
  }
  const link = links.get(refType);
  return link
    ? link.path.replace(REF_ID_PLACEHOLDER, encodeURIComponent(refId))
    : null;
}

function assertTypeDefinition(
  source: string,
  type: NotificationTypeDefinition,
): void {
  const label = `${source} 的通知類型「${type.key}」`;
  if (!TYPE_KEY_PATTERN.test(type.key)) {
    throw new NotificationRegistryError(
      `${label} key 格式不對:小寫英數與 -,以 . 分段(至少兩段)`,
    );
  }
  if (type.name.trim() === "") {
    throw new NotificationRegistryError(`${label} 沒有名稱`);
  }
  if (type.defaultChannels.length === 0) {
    throw new NotificationRegistryError(`${label} 的 defaultChannels 至少一個`);
  }
  if (new Set(type.defaultChannels).size !== type.defaultChannels.length) {
    throw new NotificationRegistryError(`${label} 的 defaultChannels 重複`);
  }
  const unknown = type.defaultChannels.filter(
    (channel) => !NOTIFICATION_CHANNELS.includes(channel),
  );
  if (unknown.length > 0) {
    throw new NotificationRegistryError(
      `${label} 用了沒有登記的管道:${unknown.join(", ")}`,
    );
  }
  const declared = Object.keys(type.canDisable).toSorted((a, b) =>
    a.localeCompare(b),
  );
  if (
    declared.join(",") !==
    [...type.defaultChannels].toSorted((a, b) => a.localeCompare(b)).join(",")
  ) {
    throw new NotificationRegistryError(
      `${label} 的 canDisable 必須逐一宣告 defaultChannels 的每個管道`,
    );
  }
  if (!type.template[NOTIFICATION_DEFAULT_LOCALE]) {
    throw new NotificationRegistryError(
      `${label} 沒有 ${NOTIFICATION_DEFAULT_LOCALE} 範本`,
    );
  }
  assertCategory(label, type);
  assertSchedule(label, type);
}

function assertSchedule(label: string, type: NotificationTypeDefinition): void {
  const declaration = type.schedule;
  if (declaration === undefined) {
    return;
  }
  if (!NOTIFICATION_SCHEDULE_KINDS.includes(declaration.default.kind)) {
    throw new NotificationRegistryError(
      `${label} 的 schedule.default.kind 不認得(只收 ${NOTIFICATION_SCHEDULE_KINDS.join("、")})`,
    );
  }
  const validation = validateSchedule(
    declaration.default,
    declaration.default.kind,
  );
  if (!validation.ok) {
    throw new NotificationRegistryError(
      `${label} 的 schedule.default 不合法(${validation.issue.path}):${validation.issue.message}`,
    );
  }
  if (
    declaration.dateLabel !== undefined &&
    (declaration.default.kind !== "days-before" ||
      declaration.dateLabel.trim() === "")
  ) {
    throw new NotificationRegistryError(
      `${label} 的 schedule.dateLabel 只能給 days-before,且不可空白`,
    );
  }
}

function assertCategory(label: string, type: NotificationTypeDefinition): void {
  if (type.category === "party") {
    if (type.recipientNote?.trim() === "") {
      throw new NotificationRegistryError(`${label} 的 recipientNote 不可空白`);
    }
    if (type.orgScope !== undefined || type.defaultAudience !== undefined) {
      throw new NotificationRegistryError(
        `${label} 是當事人通知,不能宣告 orgScope / defaultAudience`,
      );
    }
    return;
  }
  if (type.recipientNote !== undefined) {
    throw new NotificationRegistryError(
      `${label} 是負責人提醒,收件人由人員條件決定,不能宣告 recipientNote`,
    );
  }
  const { orgScope, defaultAudience } = type;
  if (orgScope === undefined || defaultAudience === undefined) {
    throw new NotificationRegistryError(
      `${label} 是負責人提醒,orgScope 與 defaultAudience 必填`,
    );
  }
  if (!AUDIENCE_ORG_RANGES.includes(orgScope.range)) {
    throw new NotificationRegistryError(`${label} 的 orgScope.range 不合法`);
  }
  const validation = validateAudience(
    defaultAudience,
    NOTIFICATION_AUDIENCE_OPTIONS,
  );
  if (!validation.ok) {
    throw new NotificationRegistryError(
      `${label} 的 defaultAudience 不合法(${validation.issue.path}):${validation.issue.message}`,
    );
  }
}

/** 合成底座與專案的通知類型:key → 定義。格式不對、重複一律拋錯。 */
export function composeNotificationTypes(
  base: readonly NotificationTypeDefinition[],
  project: readonly NotificationTypeDefinition[],
): ReadonlyMap<string, NotificationTypeDefinition> {
  for (const channel of NOTIFICATION_CHANNELS) {
    if (!CHANNEL_KEY_PATTERN.test(channel)) {
      throw new NotificationRegistryError(
        `管道 key「${channel}」格式不對:小寫英數與 -`,
      );
    }
  }
  const registry = new Map<string, NotificationTypeDefinition>();
  const sourced = [
    ...base.map((definition) => ["base", definition] as const),
    ...project.map((definition) => ["project", definition] as const),
  ];
  for (const [source, definition] of sourced) {
    assertTypeDefinition(source, definition);
    if (registry.has(definition.key)) {
      throw new NotificationRegistryError(
        `通知類型「${definition.key}」重複登記(${source})`,
      );
    }
    registry.set(definition.key, definition);
  }
  return registry;
}

/** 合成底座與專案的連結登記:refType → 登記。格式不對、重複一律拋錯。 */
export function composeNotificationLinks(
  base: readonly NotificationLinkRegistration[],
  project: readonly NotificationLinkRegistration[],
): ReadonlyMap<string, NotificationLinkRegistration> {
  const registry = new Map<string, NotificationLinkRegistration>();
  const sourced = [
    ...base.map((link) => ["base", link] as const),
    ...project.map((link) => ["project", link] as const),
  ];
  for (const [source, link] of sourced) {
    const label = `${source} 的通知連結「${link.refType}」`;
    if (!REF_TYPE_PATTERN.test(link.refType)) {
      throw new NotificationRegistryError(
        `${label} refType 格式不對:小寫英數與 -`,
      );
    }
    if (
      !link.path.startsWith("/") ||
      link.path.split(REF_ID_PLACEHOLDER).length !== 2
    ) {
      throw new NotificationRegistryError(
        `${label} 的 path 要以 / 開頭、含一個 ${REF_ID_PLACEHOLDER}`,
      );
    }
    if (registry.has(link.refType)) {
      throw new NotificationRegistryError(
        `通知連結「${link.refType}」重複登記(${source})`,
      );
    }
    registry.set(link.refType, link);
  }
  return registry;
}
