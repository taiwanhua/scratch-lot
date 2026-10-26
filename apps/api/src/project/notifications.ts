import type { Audience } from "@repo/domain/audience";

import {
  EMAIL_CHANNEL,
  IN_APP_CHANNEL,
  type NotificationParams,
  type NotificationTypeDefinition,
} from "../notifications/notification-registry";
import type { ProjectNotificationRegistrations } from "../notifications/notification-registry.module";

/**
 * 專案登記的通知類型與連結(`docs/modules/notification-settings.md`;STRUCT-12 api 的固定入口之一,只由 `app.module.ts` 經
 * `NotificationRegistryModule.forRoot` 組裝)。key / refType 不可與底座重複;每種類型的每個管道
 * 自動成為個人偏好的一個開關(`notification_<類型>_<管道>`)。
 *
 * 類型清單、範本參數與觸發的功能見 `docs/modules/project/lottery-notifications.md`(專案規格 3.4)。
 * 宣告了可調時間的類型見各筆的 `schedule`(排程在觸發的功能裡);觸發的功能呼叫 `notify()`。`links`:進貨單詳情(`LOTTERY_PURCHASE_REF`)、調貨單詳情(`LOTTERY_TRANSFER_REF`)。
 */

/** 刮刮樂:有已送出交班結帳的班還沒被日結涵蓋計算(B14,逾期後每天)。 */
export const LOTTERY_DAILY_CLOSE_OVERDUE = "lottery.daily-close-overdue";
/** 刮刮樂:調貨單第一關通過(含跳過),通知收貨店。 */
export const LOTTERY_TRANSFER_SHIPPED = "lottery.transfer-shipped";
/** 刮刮樂:經銷商證照到期(B14,到期日前 N 天)。 */
export const LOTTERY_LICENSE_EXPIRING = "lottery.license-expiring";
/** 刮刮樂:乙類牌租繳費日(B14,繳費日前 N 天)。 */
export const LOTTERY_STORE_RENT_DUE = "lottery.store-rent-due";
/** 刮刮樂:上個月還沒關帳(B14,每月第 N 天)。 */
export const LOTTERY_PERIOD_CLOSE_OVERDUE = "lottery.period-close-overdue";
/** 刮刮樂:分店刷到送錯的進貨,按 [通知總部更正] → 給進貨單建立者。 */
export const LOTTERY_PURCHASE_WRONG_STORE = "lottery.purchase-wrong-store";
/** 通知連結:進貨單詳情頁(送錯分店的通知點進去是那張進貨單)。 */
export const LOTTERY_PURCHASE_REF = "lottery-purchase";
/** 刮刮樂:收貨店刷到送錯的調貨,按 [通知總部更正] → 給調貨單建立者。 */
export const LOTTERY_TRANSFER_WRONG_STORE = "lottery.transfer-wrong-store";
/** 通知連結:調貨單詳情頁(送錯分店的通知點進去是那張調貨單)。 */
export const LOTTERY_TRANSFER_REF = "lottery-transfer";
/** 排班:這家店的畫休開放日(B14)。 */
export const SCHEDULE_DAY_OFF_OPEN = "schedule.day-off-open";
/** 排班:這家店的畫休截止日前(B14)。 */
export const SCHEDULE_DAY_OFF_CLOSING = "schedule.day-off-closing";
/** 排班:發布排班 → 給被排到的人。 */
export const SCHEDULE_PUBLISHED = "schedule.published";
/** 排班:發布後的異動 → 給異動牽涉的人。 */
export const SCHEDULE_CHANGED = "schedule.changed";
/** 排班:別人代改(新增 / 刪除)我的畫休 → 給被代改的那位員工(自己改自己的不送)。 */
export const SCHEDULE_DAY_OFF_OVERRIDDEN = "schedule.day-off-overridden";

const permissionHolders = (permissionKey: string): Audience => ({
  mode: "match",
  filter: {
    field: "permission",
    cond: "in",
    value: { kind: "static", values: [permissionKey] },
  },
});

/**
 * 規格 3.4 的「角色 店長」:開通時建立的角色是各租戶各自的一般角色(規格 3.3),類型宣告寫不了角色 id,
 * 所以預設用「持有 `store.bank-deposit`」—— 3.3 只有店長與總部管理有、店員沒有。租戶可在通知設定頁改成角色。
 */
export const STORE_MANAGER_AUDIENCE: Audience =
  permissionHolders("store.bank-deposit");

/** 關帳逾期:持有 `accounts.close-period`(規格 3.4;照 3.3 只有總部管理有)。 */
const PERIOD_CLOSER_AUDIENCE: Audience = permissionHolders(
  "accounts.close-period",
);

/** 站內 + email,兩個管道收件人都能在個人偏好關掉。 */
const CHANNELS = {
  defaultChannels: [IN_APP_CHANNEL, EMAIL_CHANNEL],
  canDisable: { [IN_APP_CHANNEL]: true, [EMAIL_CHANNEL]: true },
} as const;

const text = (params: NotificationParams, key: string): string =>
  params[key] ?? "";

/** 有值才接上「前綴 + 值」。 */
const optional = (
  params: NotificationParams,
  key: string,
  prefix: string,
): string => {
  const value = params[key] ?? null;
  return value === null ? "" : prefix + value;
};

const isToday = (params: NotificationParams): boolean =>
  params.daysLeft === "0";

/** 代改畫休的時段參數:`HH:mm–HH:mm` 以 `,` 串起(各語系用自己的分隔字)。 */
const slotsOf = (params: NotificationParams, separator: string): string =>
  text(params, "slots").split(",").filter(Boolean).join(separator);

/** 代改畫休那筆是什麼:整天畫休,或時段不可排(附時段)。 */
const dayOffDetail = (
  params: NotificationParams,
  labels: {
    fullDay: string;
    timeRange: (slots: string) => string;
    separator: string;
  },
): string =>
  params.kind === "time-range"
    ? labels.timeRange(slotsOf(params, labels.separator))
    : labels.fullDay;

const lotteryTypes: NotificationTypeDefinition[] = [
  {
    key: LOTTERY_DAILY_CLOSE_OVERDUE,
    name: "日結逾期",
    ...CHANNELS,
    category: "responsible",
    orgScope: { ref: "event-org", range: "self" },
    defaultAudience: STORE_MANAGER_AUDIENCE,
    // 這家店最早一張還沒被涵蓋的交班結帳,送出日的隔天起每天 09:00(規格 3.4、3.5;排程在 lottery/daily-close)
    schedule: { default: { kind: "daily-overdue", time: "09:00" } },
    template: {
      "zh-TW": (params) => ({
        title: `日結逾期:${text(params, "orgName")}`,
        body: `「${text(params, "orgName")}」有 ${text(params, "since")} 送出的交班結帳還沒被日結涵蓋計算,請盡快日結。`,
      }),
      en: (params) => ({
        title: `Daily close overdue: ${text(params, "orgName")}`,
        body: `"${text(params, "orgName")}" has shift checkouts submitted on ${text(params, "since")} not yet covered by a daily close.`,
      }),
    },
  },
  {
    key: LOTTERY_TRANSFER_SHIPPED,
    name: "調貨出貨通知",
    ...CHANNELS,
    category: "responsible",
    orgScope: { ref: "event-org", range: "self" },
    defaultAudience: STORE_MANAGER_AUDIENCE,
    template: {
      "zh-TW": (params) => ({
        title: `調貨出貨:${text(params, "subject")}`,
        body: `「${text(params, "fromOrgName")}」已出貨調貨單「${text(params, "subject")}」,請在收到時點收。`,
      }),
      en: (params) => ({
        title: `Transfer shipped: ${text(params, "subject")}`,
        body: `"${text(params, "fromOrgName")}" has shipped the transfer "${text(params, "subject")}". Please receive it on arrival.`,
      }),
    },
  },
  {
    key: LOTTERY_LICENSE_EXPIRING,
    name: "證照到期",
    ...CHANNELS,
    category: "responsible",
    // 乙類:對應分店含上層;甲類或沒有對應分店:觸發時以租戶頂層當事件的組織
    orgScope: { ref: "event-org", range: "ancestors" },
    defaultAudience: STORE_MANAGER_AUDIENCE,
    // 到期日前 30、7、0 天 09:00 各一次;過期後不再寄(規格 3.4、3.5;排程在經銷商管理)
    schedule: {
      default: { kind: "days-before", daysBefore: [30, 7, 0], time: "09:00" },
      dateLabel: "到期",
    },
    template: {
      "zh-TW": (params) => ({
        title: `證照到期:${text(params, "dealerName")}`,
        body: isToday(params)
          ? `${text(params, "dealerType")}「${text(params, "dealerName")}」的證照今天(${text(params, "expiresOn")})到期。`
          : `${text(params, "dealerType")}「${text(params, "dealerName")}」的證照將於 ${text(params, "expiresOn")} 到期(還有 ${text(params, "daysLeft")} 天)。`,
      }),
      en: (params) => ({
        title: `License expiring: ${text(params, "dealerName")}`,
        body: isToday(params)
          ? `The license of "${text(params, "dealerName")}" expires today (${text(params, "expiresOn")}).`
          : `The license of "${text(params, "dealerName")}" expires on ${text(params, "expiresOn")} (in ${text(params, "daysLeft")} days).`,
      }),
    },
  },
  {
    key: LOTTERY_STORE_RENT_DUE,
    name: "牌租繳費提醒",
    ...CHANNELS,
    category: "responsible",
    // 乙類對應分店含上層;沒有對應分店:觸發時以租戶頂層當事件的組織
    orgScope: { ref: "event-org", range: "ancestors" },
    defaultAudience: STORE_MANAGER_AUDIENCE,
    // 每期繳費日前 3、0 天 09:00(規格 3.4、3.5;排程在經銷商管理)
    schedule: {
      default: { kind: "days-before", daysBefore: [3, 0], time: "09:00" },
      dateLabel: "繳費日",
    },
    template: {
      "zh-TW": (params) => ({
        title: `牌租繳費:${text(params, "dealerName")}`,
        body: `乙類「${text(params, "dealerName")}」的牌租繳費日是 ${text(params, "dueOn")}。${optional(params, "amount", "金額:")}`,
      }),
      en: (params) => ({
        title: `Store rent due: ${text(params, "dealerName")}`,
        body: `The store rent for "${text(params, "dealerName")}" is due on ${text(params, "dueOn")}.${optional(params, "amount", " Amount: ")}`,
      }),
    },
  },
  {
    key: LOTTERY_PERIOD_CLOSE_OVERDUE,
    name: "關帳逾期",
    ...CHANNELS,
    category: "responsible",
    orgScope: { ref: "tenant", range: "self" },
    defaultAudience: PERIOD_CLOSER_AUDIENCE,
    // 每月第 3 天 09:00 檢查上個月(規格 3.4、3.5;排程在 lottery/period-close)
    schedule: { default: { kind: "monthly", dayOfMonth: 3, time: "09:00" } },
    template: {
      "zh-TW": (params) => ({
        title: `關帳逾期:${text(params, "period")}`,
        body: `${text(params, "period")} 還沒關帳,請盡快完成關帳。`,
      }),
      en: (params) => ({
        title: `Period close overdue: ${text(params, "period")}`,
        body: `The period ${text(params, "period")} has not been closed yet.`,
      }),
    },
  },
  {
    key: LOTTERY_PURCHASE_WRONG_STORE,
    name: "進貨送錯分店",
    ...CHANNELS,
    category: "party",
    template: {
      "zh-TW": (params) => ({
        title: `進貨送錯分店:${text(params, "subject")}`,
        body: `「${text(params, "orgName")}」回報進貨單「${text(params, "subject")}」送錯分店,請更正。`,
      }),
      en: (params) => ({
        title: `Purchase sent to the wrong store: ${text(params, "subject")}`,
        body: `"${text(params, "orgName")}" reported that the purchase "${text(params, "subject")}" was sent to the wrong store. Please correct it.`,
      }),
    },
  },
  {
    key: LOTTERY_TRANSFER_WRONG_STORE,
    name: "調貨送錯分店",
    ...CHANNELS,
    category: "party",
    template: {
      "zh-TW": (params) => ({
        title: `調貨送錯分店:${text(params, "subject")}`,
        body: `「${text(params, "orgName")}」回報調貨單「${text(params, "subject")}」送錯分店,請更正。`,
      }),
      en: (params) => ({
        title: `Transfer sent to the wrong store: ${text(params, "subject")}`,
        body: `"${text(params, "orgName")}" reported that the transfer "${text(params, "subject")}" was sent to the wrong store. Please correct it.`,
      }),
    },
  },
];

const scheduleTypes: NotificationTypeDefinition[] = [
  {
    key: SCHEDULE_DAY_OFF_OPEN,
    name: "畫休開放",
    ...CHANNELS,
    category: "party",
    recipientNote: "可以排這家店的排班人員",
    // 開放日當天 09:00(規格 3.4、3.5;日期照各店規則「畫休開放期間」,排程在 schedule/day-offs)
    schedule: {
      default: { kind: "days-before", daysBefore: [0], time: "09:00" },
      dateLabel: "開放日",
    },
    template: {
      "zh-TW": (params) => ({
        title: `畫休開放:${text(params, "orgName")}`,
        body: `「${text(params, "orgName")}」${text(params, "month")} 的畫休已開放登記,${text(params, "closesOn")} 截止。`,
      }),
      en: (params) => ({
        title: `Day-off requests open: ${text(params, "orgName")}`,
        body: `Day-off requests for ${text(params, "month")} at "${text(params, "orgName")}" are open until ${text(params, "closesOn")}.`,
      }),
    },
  },
  {
    key: SCHEDULE_DAY_OFF_CLOSING,
    name: "畫休即將截止",
    ...CHANNELS,
    category: "party",
    recipientNote: "可以排這家店的排班人員",
    // 截止日前 1 天 09:00(規格 3.4、3.5;日期照各店規則「畫休開放期間」,排程在 schedule/day-offs)
    schedule: {
      default: { kind: "days-before", daysBefore: [1], time: "09:00" },
      dateLabel: "截止日",
    },
    template: {
      "zh-TW": (params) => ({
        title: `畫休即將截止:${text(params, "orgName")}`,
        body: `「${text(params, "orgName")}」${text(params, "month")} 的畫休將於 ${text(params, "closesOn")} 截止。`,
      }),
      en: (params) => ({
        title: `Day-off requests closing: ${text(params, "orgName")}`,
        body: `Day-off requests for ${text(params, "month")} at "${text(params, "orgName")}" close on ${text(params, "closesOn")}.`,
      }),
    },
  },
  {
    key: SCHEDULE_PUBLISHED,
    name: "排班發布",
    ...CHANNELS,
    category: "party",
    template: {
      "zh-TW": (params) => ({
        title: `排班發布:${text(params, "orgName")}`,
        body: `「${text(params, "orgName")}」${text(params, "month")} 的排班已發布。`,
      }),
      en: (params) => ({
        title: `Schedule published: ${text(params, "orgName")}`,
        body: `The ${text(params, "month")} schedule at "${text(params, "orgName")}" has been published.`,
      }),
    },
  },
  {
    key: SCHEDULE_CHANGED,
    name: "排班異動",
    ...CHANNELS,
    category: "party",
    template: {
      "zh-TW": (params) => ({
        title: `排班異動:${text(params, "orgName")}`,
        body: `「${text(params, "orgName")}」${text(params, "date")} 的排班有異動。${optional(params, "reason", "原因:")}`,
      }),
      en: (params) => ({
        title: `Schedule changed: ${text(params, "orgName")}`,
        body: `The schedule on ${text(params, "date")} at "${text(params, "orgName")}" has changed.${optional(params, "reason", " Reason: ")}`,
      }),
    },
  },
  {
    key: SCHEDULE_DAY_OFF_OVERRIDDEN,
    name: "畫休被代改",
    ...CHANNELS,
    category: "party",
    template: {
      "zh-TW": (params) => {
        const detail = dayOffDetail(params, {
          fullDay: "整天畫休",
          timeRange: (slots) => `時段不可排(${slots})`,
          separator: "、",
        });
        const reason = optional(params, "reason", "原因:");
        return {
          title: `畫休被代改:${text(params, "date")}`,
          body:
            params.action === "delete"
              ? `${text(params, "byName")} 在「${text(params, "orgName")}」刪除了你 ${text(params, "date")} 的${detail}。${reason}`
              : `${text(params, "byName")} 在「${text(params, "orgName")}」替你登記了 ${text(params, "date")} 的${detail}。${reason}`,
        };
      },
      en: (params) => {
        const detail = dayOffDetail(params, {
          fullDay: "full day",
          timeRange: (slots) => `unavailable hours (${slots})`,
          separator: ", ",
        });
        const reason = optional(params, "reason", " Reason: ");
        return {
          title: `Day off changed for you: ${text(params, "date")}`,
          body:
            params.action === "delete"
              ? `${text(params, "byName")} deleted your day off on ${text(params, "date")} at "${text(params, "orgName")}": ${detail}.${reason}`
              : `${text(params, "byName")} registered a day off for you on ${text(params, "date")} at "${text(params, "orgName")}": ${detail}.${reason}`,
        };
      },
    },
  },
];

export const PROJECT_NOTIFICATIONS: ProjectNotificationRegistrations = {
  types: [...lotteryTypes, ...scheduleTypes],
  links: [
    {
      refType: LOTTERY_PURCHASE_REF,
      path: "/purchasing/purchase/view-page/{refId}",
    },
    {
      refType: LOTTERY_TRANSFER_REF,
      path: "/purchasing/transfer/view-page/{refId}",
    },
  ],
};
