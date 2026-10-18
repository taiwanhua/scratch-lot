/**
 * 流程設計器裡「選出一群人」的三個用途:
 * 審核者(關卡的審核者來源)、知會對象(關卡 / 整個流程的知會,B17)、通知對象(逾時提醒的第 2 級,B16)。
 * 來源下拉、條件摘要框、條件對話框共用同一組元件,只換標題與說明(`admin.workflows.assignee.purposes.<用途>`)。
 */
export type PeoplePurpose = "approver" | "cc" | "overdue";

/** 有「來源下拉」(人員條件 / 表單欄位 / 主管)的用途:審核者、知會對象;通知對象只有人員條件,沒有來源下拉。 */
export type SourcePurpose = Exclude<PeoplePurpose, "overdue">;
