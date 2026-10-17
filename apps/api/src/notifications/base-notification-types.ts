import { PRINT_JOB_ERRORS, type PrintJobError } from "@repo/domain/printing";

import {
  EMAIL_CHANNEL,
  IN_APP_CHANNEL,
  type NotificationLinkRegistration,
  type NotificationParams,
  type NotificationTypeDefinition,
} from "./notification-registry";

/** 審核流程:新任務給審核者(含代理人)。 */
export const WORKFLOW_TASK_CREATED = "workflow.task-created";
/** 審核流程:有結果(核准 / 駁回 / 退回)給申請人。 */
export const WORKFLOW_RESULT = "workflow.result";
/** 審核流程:逾時提醒給審核者 / 通知對象(B16)。 */
export const WORKFLOW_OVERDUE = "workflow.overdue";
/** 審核流程:知會對象(B17)。 */
export const WORKFLOW_CC = "workflow.cc";
/** 列印:列印失敗給列印要求人。 */
export const PRINTING_JOB_FAILED = "printing.job-failed";
/** 列印:代理程式離線(負責人提醒)。 */
export const PRINTING_AGENT_OFFLINE = "printing.agent-offline";

/** 申請中心詳情頁(流程實例)的連結種類。 */
export const WORKFLOW_INSTANCE_REF = "workflow-instance";

const text = (params: NotificationParams, key: string): string =>
  params[key] ?? "";

/** 有值才接上「前綴 + 值」(駁回理由、失敗原因這類可有可無的一句)。 */
const optional = (
  params: NotificationParams,
  key: string,
  prefix: string,
): string => {
  const value = params[key] ?? null;
  return value === null ? "" : prefix + value;
};

/** 有值才接上「前綴 + 值」。 */
const prefixed = (value: string | null, prefix: string): string =>
  value === null ? "" : prefix + value;

const RESULT_LABELS: Readonly<Record<string, { "zh-TW": string; en: string }>> =
  {
    approved: { "zh-TW": "已核准", en: "approved" },
    rejected: { "zh-TW": "已駁回", en: "rejected" },
    returned: { "zh-TW": "已退回修改", en: "returned for changes" },
  };

const resultLabel = (params: NotificationParams, locale: "zh-TW" | "en") =>
  RESULT_LABELS[text(params, "result")]?.[locale] ?? text(params, "result");

/** 知會的時機 → 各語言的一句話(關卡的兩種帶關卡名);不認得的時機只說「知會您」。 */
const ccEventText = (
  params: NotificationParams,
  locale: "zh-TW" | "en",
): string => {
  const step = text(params, "stepName");
  const labels: Readonly<Record<string, { "zh-TW": string; en: string }>> = {
    "step-passed": {
      "zh-TW": `的「${step}」關卡已通過`,
      en: `passed the step "${step}"`,
    },
    "step-skipped": {
      "zh-TW": `的「${step}」關卡已跳過`,
      en: `skipped the step "${step}"`,
    },
    completed: { "zh-TW": "已完成", en: "was completed" },
    rejected: { "zh-TW": "已駁回", en: "was rejected" },
    voided: { "zh-TW": "已作廢", en: "was voided" },
  };
  return (
    labels[text(params, "event")]?.[locale] ??
    (locale === "zh-TW" ? "知會您" : "was shared with you")
  );
};

/** 列印失敗原因(`@repo/domain/printing` 的 `PRINT_JOB_ERRORS`)→ 各語言的一句話;不認得的原樣顯示。 */
const PRINT_FAILURE_LABELS: Readonly<
  Record<PrintJobError, { "zh-TW": string; en: string }>
> = {
  "agent-offline": { "zh-TW": "代理程式離線", en: "print agent offline" },
  "agent-disabled": { "zh-TW": "代理程式已停用", en: "print agent disabled" },
  "no-result": { "zh-TW": "未收到列印結果", en: "no print result received" },
  "paper-out": { "zh-TW": "缺紙", en: "out of paper" },
  "printer-offline": { "zh-TW": "連不上印表機", en: "printer unreachable" },
  other: { "zh-TW": "其他錯誤", en: "other error" },
};

/** 列印的單據名稱:測試頁依語言組「測試頁 <印表機>」,其餘用 `documentName`。 */
const printDocument = (
  params: NotificationParams,
  locale: "zh-TW" | "en",
): string => {
  const printer = params.testPagePrinter ?? null;
  if (printer === null) {
    return text(params, "documentName");
  }
  return locale === "zh-TW" ? `測試頁 ${printer}` : `Test page ${printer}`;
};

const isPrintJobError = (value: string): value is PrintJobError =>
  (PRINT_JOB_ERRORS as readonly string[]).includes(value);

const printFailureLabel = (
  params: NotificationParams,
  locale: "zh-TW" | "en",
): string | null => {
  const reason = params.reason ?? null;
  if (reason === null) {
    return null;
  }
  return isPrintJobError(reason)
    ? PRINT_FAILURE_LABELS[reason][locale]
    : reason;
};

/**
 * 底座本輪登記的通知類型(底座規格第 5 章,2026-10-16 定;專案的類型見專案規格,登記在
 * `src/project/notifications.ts`)。範本參數:
 *
 * | 類型                     | 參數                                                              |
 * | ------------------------ | ----------------------------------------------------------------- |
 * | `workflow.task-created`  | `subject`(表單名:標題)、`stepName`                               |
 * | `workflow.result`        | `subject`、`result`(approved / rejected / returned)、`comment`    |
 * | `workflow.overdue`       | `subject`、`stepName`、`hours`(已超過的小時數 N 或 M)               |
 * | `workflow.cc`            | `subject`、`event`(`@repo/domain/workflow` 的 `CC_EVENTS`)、`stepName`(關卡的兩種才有) |
 * | `printing.job-failed`    | `documentName`、`reason`(失敗原因代碼,範本換成各語言的一句話);測試頁改給 `testPagePrinter` |
 * | `printing.agent-offline` | `agentName`、`orgName`                                            |
 */
export const BASE_NOTIFICATION_TYPES: readonly NotificationTypeDefinition[] = [
  {
    key: WORKFLOW_TASK_CREATED,
    name: "待你審核",
    defaultChannels: [IN_APP_CHANNEL, EMAIL_CHANNEL],
    canDisable: { [IN_APP_CHANNEL]: false, [EMAIL_CHANNEL]: true },
    category: "party",
    template: {
      "zh-TW": (params) => ({
        title: `待審核:${text(params, "subject")}`,
        body: `您有一筆待審核的申請「${text(params, "subject")}」(關卡:${text(params, "stepName")})。`,
      }),
      en: (params) => ({
        title: `Pending review: ${text(params, "subject")}`,
        body: `A request "${text(params, "subject")}" is waiting for your review (step: ${text(params, "stepName")}).`,
      }),
    },
  },
  {
    key: WORKFLOW_RESULT,
    name: "申請結果",
    defaultChannels: [IN_APP_CHANNEL, EMAIL_CHANNEL],
    canDisable: { [IN_APP_CHANNEL]: true, [EMAIL_CHANNEL]: true },
    category: "party",
    template: {
      "zh-TW": (params) => ({
        title: `申請${resultLabel(params, "zh-TW")}:${text(params, "subject")}`,
        body: `您的申請「${text(params, "subject")}」${resultLabel(params, "zh-TW")}。${optional(params, "comment", "理由:")}`,
      }),
      en: (params) => ({
        title: `Request ${resultLabel(params, "en")}: ${text(params, "subject")}`,
        body: `Your request "${text(params, "subject")}" was ${resultLabel(params, "en")}.${optional(params, "comment", " Reason: ")}`,
      }),
    },
  },
  {
    key: WORKFLOW_OVERDUE,
    name: "審核逾時",
    defaultChannels: [IN_APP_CHANNEL, EMAIL_CHANNEL],
    canDisable: { [IN_APP_CHANNEL]: true, [EMAIL_CHANNEL]: true },
    category: "party",
    template: {
      "zh-TW": (params) => ({
        title: `審核逾時:${text(params, "subject")}`,
        body: `申請「${text(params, "subject")}」在「${text(params, "stepName")}」關卡已超過 ${text(params, "hours")} 小時未處理。`,
      }),
      en: (params) => ({
        title: `Review overdue: ${text(params, "subject")}`,
        body: `The request "${text(params, "subject")}" has been waiting at step "${text(params, "stepName")}" for over ${text(params, "hours")} hours.`,
      }),
    },
  },
  {
    key: WORKFLOW_CC,
    name: "知會",
    defaultChannels: [IN_APP_CHANNEL],
    canDisable: { [IN_APP_CHANNEL]: true },
    category: "party",
    template: {
      "zh-TW": (params) => ({
        title: `知會:${text(params, "subject")}`,
        body: `申請「${text(params, "subject")}」${ccEventText(params, "zh-TW")}。`,
      }),
      en: (params) => ({
        title: `FYI: ${text(params, "subject")}`,
        body: `The request "${text(params, "subject")}" ${ccEventText(params, "en")}.`,
      }),
    },
  },
  {
    key: PRINTING_JOB_FAILED,
    name: "列印失敗",
    defaultChannels: [IN_APP_CHANNEL],
    canDisable: { [IN_APP_CHANNEL]: true },
    category: "party",
    template: {
      "zh-TW": (params) => ({
        title: `列印失敗:${printDocument(params, "zh-TW")}`,
        body: `「${printDocument(params, "zh-TW")}」列印失敗。${prefixed(printFailureLabel(params, "zh-TW"), "原因:")}`,
      }),
      en: (params) => ({
        title: `Print failed: ${printDocument(params, "en")}`,
        body: `"${printDocument(params, "en")}" failed to print.${prefixed(printFailureLabel(params, "en"), " Reason: ")}`,
      }),
    },
  },
  {
    key: PRINTING_AGENT_OFFLINE,
    name: "列印代理程式離線",
    defaultChannels: [IN_APP_CHANNEL],
    canDisable: { [IN_APP_CHANNEL]: true },
    category: "responsible",
    // 代理程式的分店含上層:分店與它上層組織裡、符合人員條件的人
    orgScope: { ref: "event-org", range: "ancestors" },
    defaultAudience: {
      mode: "match",
      filter: {
        field: "permission",
        cond: "in",
        value: { kind: "static", values: ["system.printers.edit"] },
      },
    },
    template: {
      "zh-TW": (params) => ({
        title: `列印代理程式離線:${text(params, "agentName")}`,
        body: `「${text(params, "orgName")}」的列印代理程式「${text(params, "agentName")}」已離線。`,
      }),
      en: (params) => ({
        title: `Print agent offline: ${text(params, "agentName")}`,
        body: `The print agent "${text(params, "agentName")}" at "${text(params, "orgName")}" is offline.`,
      }),
    },
  },
];

/** 底座的連結登記(refType → admin 站內路徑)。 */
export const BASE_NOTIFICATION_LINKS: readonly NotificationLinkRegistration[] =
  [
    {
      // 申請中心的隱藏詳情頁:不經業務模組權限,審核者與申請人都打得開
      refType: WORKFLOW_INSTANCE_REF,
      path: "/apply-center/view-page/{refId}",
    },
  ];
