import { weekdayOfLocalDate } from "@repo/domain/form";

import { localDateOfKey, shiftDateKey } from "../shared/schedule-dates";

/**
 * 套用範本的規劃(規格 14.4「套用範本」;純函式,預覽與實際套用用同一個):
 *
 * - **人力需求範本**:加到選取的每一天(即使那天已經有其他人力需求);同一天**時間和崗位都相同**的
 *   (不論來自哪個範本,含這次前面已經產生的)直接略過,只是時間重疊的照常產生
 * - **人力需求週範本**:只補**完全沒有人力需求**的日子(依星期幾用週範本那一格的範本);已有任何人力需求的日子不動
 * - 店休的日子不產生(畫面上不能選;送來了也略過);跨午夜做進隔天、隔天店休的那個範本也不產生(同排班「這天或跨午夜的隔天」)
 * - 範本的時間是 `HH:mm`:結束不晚於開始 = 跨午夜(結束在隔天;結束 00:00 = 隔天 00:00)
 * - 日期是租戶時區的日期鍵 `YYYY-MM-DD`(存值是時點,由呼叫端換算)
 */

/** 套用時用到的範本內容。 */
export interface ApplyTemplateLike {
  id: string;
  startTime: string;
  endTime: string;
  positionKey: string;
  tasks: readonly { role: string; taskKey: string }[];
}

/** 那天已經有的人力需求(判斷相同時段、那天有沒有人力需求)。 */
export interface ExistingDemandLike {
  date: string;
  startAt: Date;
  endAt: Date;
  positionKey: string;
}

export type TemplateApplyRequest =
  | { kind: "template"; templates: readonly ApplyTemplateLike[] }
  | {
      kind: "week-template";
      /** 星期(0 = 星期日)→ 那天用的範本 */
      days: readonly (readonly ApplyTemplateLike[])[];
    };

export interface PlannedDemand {
  date: string;
  startAt: Date;
  endAt: Date;
  positionKey: string;
  templateId: string;
  tasks: { role: string; taskKey: string }[];
}

export interface TemplateApplyPlan {
  created: PlannedDemand[];
  /** 略過的相同時段(時間和崗位都相同) */
  skippedSlots: number;
  /** 補上人力需求的天數(週範本) */
  filledDays: number;
  /** 已經有人力需求而略過的天數(週範本) */
  skippedDays: number;
}

const slotKey = (startAt: Date, endAt: Date, positionKey: string) =>
  `${String(startAt.getTime())}|${String(endAt.getTime())}|${positionKey}`;

/** 跨午夜而且做進隔天(結束不晚於開始、結束不是 00:00;結束 00:00 = 剛好做到當天結束,不碰隔天)。 */
const touchesNextDay = (template: ApplyTemplateLike) =>
  template.endTime <= template.startTime && template.endTime !== "00:00";

/** 那天能產生的範本:隔天店休時拿掉做進隔天的。 */
const openTemplates = (
  templates: readonly ApplyTemplateLike[],
  date: string,
  closedDates: ReadonlySet<string>,
): readonly ApplyTemplateLike[] =>
  closedDates.has(shiftDateKey(date, 1))
    ? templates.filter((template) => !touchesNextDay(template))
    : templates;

/** 那天要套的範本:人力需求範本 = 選的那幾個;週範本 = 那天星期的那一格(那天已有人力需求 → null)。 */
function templatesOfDay(
  request: TemplateApplyRequest,
  date: string,
  hasDemands: boolean,
): readonly ApplyTemplateLike[] | null {
  if (request.kind === "template") {
    return request.templates;
  }
  const templates =
    request.days[weekdayOfLocalDate(localDateOfKey(date))] ?? [];
  if (templates.length === 0) {
    return [];
  }
  return hasDemands ? null : templates;
}

export function planTemplateApply(input: {
  request: TemplateApplyRequest;
  dates: readonly string[];
  existing: readonly ExistingDemandLike[];
  closedDates: ReadonlySet<string>;
  /** 某天某範本的開始 / 結束時點(租戶時區;跨午夜的結束在隔天) */
  spanOf: (
    date: string,
    startTime: string,
    endTime: string,
  ) => { startAt: Date; endAt: Date };
}): TemplateApplyPlan {
  const plan: TemplateApplyPlan = {
    created: [],
    skippedSlots: 0,
    filledDays: 0,
    skippedDays: 0,
  };
  const slotsOf = new Map<string, Set<string>>();
  const demandDays = new Set<string>();
  for (const demand of input.existing) {
    demandDays.add(demand.date);
    const slots = slotsOf.get(demand.date) ?? new Set();
    slots.add(slotKey(demand.startAt, demand.endAt, demand.positionKey));
    slotsOf.set(demand.date, slots);
  }
  const dates = [...new Set(input.dates)].toSorted((left, right) =>
    left.localeCompare(right),
  );
  for (const date of dates) {
    if (input.closedDates.has(date)) {
      continue;
    }
    const templates = templatesOfDay(input.request, date, demandDays.has(date));
    if (templates === null) {
      plan.skippedDays += 1;
      continue;
    }
    const slots = slotsOf.get(date) ?? new Set();
    slotsOf.set(date, slots);
    let created = 0;
    for (const template of openTemplates(templates, date, input.closedDates)) {
      const span = input.spanOf(date, template.startTime, template.endTime);
      const key = slotKey(span.startAt, span.endAt, template.positionKey);
      if (slots.has(key)) {
        plan.skippedSlots += 1;
        continue;
      }
      slots.add(key);
      created += 1;
      plan.created.push({
        date,
        ...span,
        positionKey: template.positionKey,
        templateId: template.id,
        tasks: template.tasks.map((task) => ({
          role: task.role,
          taskKey: task.taskKey,
        })),
      });
    }
    if (input.request.kind === "week-template" && created > 0) {
      plan.filledDays += 1;
    }
  }
  return plan;
}
