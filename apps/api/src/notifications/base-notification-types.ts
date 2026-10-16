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

const RESULT_LABELS: Readonly<Record<string, { "zh-TW": string; en: string }>> =
  {
    approved: { "zh-TW": "已核准", en: "approved" },
    rejected: { "zh-TW": "已駁回", en: "rejected" },
    returned: { "zh-TW": "已退回修改", en: "returned for changes" },
  };

const resultLabel = (params: NotificationParams, locale: "zh-TW" | "en") =>
  RESULT_LABELS[text(params, "result")]?.[locale] ?? text(params, "result");

/**
 * 底座本輪登記的通知類型(底座規格第 5 章,2026-10-16 定;專案的類型見專案規格,登記在
 * `src/project/notifications.ts`)。範本參數:
 *
 * | 類型                     | 參數                                                              |
 * | ------------------------ | ----------------------------------------------------------------- |
 * | `workflow.task-created`  | `subject`(表單名:標題)、`stepName`                               |
 * | `workflow.result`        | `subject`、`result`(approved / rejected / returned)、`comment`    |
 * | `workflow.overdue`       | `subject`、`stepName`                                             |
 * | `workflow.cc`            | `subject`                                                         |
 * | `printing.job-failed`    | `documentName`、`reason`                                          |
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
        body: `申請「${text(params, "subject")}」在「${text(params, "stepName")}」關卡已逾時。`,
      }),
      en: (params) => ({
        title: `Review overdue: ${text(params, "subject")}`,
        body: `The request "${text(params, "subject")}" is overdue at step "${text(params, "stepName")}".`,
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
        body: `申請「${text(params, "subject")}」知會您。`,
      }),
      en: (params) => ({
        title: `FYI: ${text(params, "subject")}`,
        body: `You were copied on the request "${text(params, "subject")}".`,
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
        title: `列印失敗:${text(params, "documentName")}`,
        body: `「${text(params, "documentName")}」列印失敗。${optional(params, "reason", "原因:")}`,
      }),
      en: (params) => ({
        title: `Print failed: ${text(params, "documentName")}`,
        body: `"${text(params, "documentName")}" failed to print.${optional(params, "reason", " Reason: ")}`,
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
