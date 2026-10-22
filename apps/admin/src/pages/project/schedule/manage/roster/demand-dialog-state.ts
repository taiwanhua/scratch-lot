import type { ScheduleTaskRole } from "@repo/domain/project/schedule-settings";

import type { FieldErrorTexts } from "@/lib/base/field-errors";
import { localPartsOf } from "@/lib/project/schedule-roster";

import { scheduleErrorTextsOf } from "../../schedule-field-errors";
import type {
  DemandPreset,
  RosterDemand,
  RosterTemplate,
} from "./roster-context";

/** 人力需求對話框的一列執行任務。 */
export interface DemandTaskRow {
  /** 既有的執行任務;新的一列為 null */
  taskId: string | null;
  key: string;
  role: ScheduleTaskRole;
  taskKey: string;
  /** 填的人(只有既有的任務才有) */
  userName: string | null;
}

export interface DemandValues {
  date: string;
  startTime: string;
  endTime: string;
  positionKey: string;
  tasks: DemandTaskRow[];
  saveAsTemplate: boolean;
  templateName: string;
  templateShortName: string;
}

export type DemandField =
  | "date"
  | "startTime"
  | "endTime"
  | "positionKey"
  | "tasks"
  | "templateName"
  | "templateShortName";

/** 欄位 → 寫在欄位正下方的原因(REACT-18)。 */
export type DemandFieldErrors = FieldErrorTexts<DemandField>;

/** 對話框上的欄位(錯誤標回的範圍)。 */
export const DEMAND_FIELDS: readonly DemandField[] = [
  "date",
  "startTime",
  "endTime",
  "positionKey",
  "tasks",
  "templateName",
  "templateShortName",
];

/** api 標回的欄位 → 對話框的欄位。 */
export const DEMAND_API_FIELDS: Readonly<Partial<Record<string, DemandField>>> =
  {
    startAt: "startTime",
    endAt: "endTime",
    positionKey: "positionKey",
    tasks: "tasks",
  };

let rowSequence = 0;

export const nextTaskKey = (): string => {
  rowSequence += 1;
  return `new-${String(rowSequence)}`;
};

export const asRole = (role: string): ScheduleTaskRole =>
  role === "leader" ? "leader" : "helper";

const NO_TEMPLATE_COPY = {
  saveAsTemplate: false,
  templateName: "",
  templateShortName: "",
};

/** 初始值:編輯 = 這筆;新增 = 帶入的日期 / 時間,有範本時帶入範本的時間、崗位、執行任務。 */
export const initialDemandValues = (
  demand: RosterDemand | null,
  preset: DemandPreset,
  template: RosterTemplate | undefined,
  timezone: string,
): DemandValues => {
  if (demand !== null) {
    return {
      date: demand.date,
      startTime: localPartsOf(demand.startAt, timezone).time,
      endTime: localPartsOf(demand.endAt, timezone).time,
      positionKey: demand.positionKey,
      tasks: demand.tasks.map((task) => ({
        taskId: task.taskId,
        key: task.taskId,
        role: asRole(task.role),
        taskKey: task.taskKey,
        userName: task.userName ?? null,
      })),
      ...NO_TEMPLATE_COPY,
    };
  }
  return {
    date: preset.date ?? "",
    startTime: template?.startTime ?? preset.startTime ?? "",
    endTime: template?.endTime ?? preset.endTime ?? "",
    positionKey: template?.positionKey ?? "",
    tasks: (template?.tasks ?? []).map((task) => ({
      taskId: null,
      key: nextTaskKey(),
      role: asRole(task.role),
      taskKey: task.taskKey,
      userName: null,
    })),
    ...NO_TEMPLATE_COPY,
  };
};

/** 必填但沒填的欄位(勾了「同時存成人力需求範本」才要範本名稱與簡稱)。 */
export const missingDemandFields = (values: DemandValues): DemandField[] => {
  const required: [DemandField, boolean][] = [
    ["date", values.date === ""],
    ["startTime", values.startTime === ""],
    ["endTime", values.endTime === ""],
    ["positionKey", values.positionKey === ""],
    [
      "templateName",
      values.saveAsTemplate && values.templateName.trim() === "",
    ],
    [
      "templateShortName",
      values.saveAsTemplate && values.templateShortName.trim() === "",
    ],
  ];
  return required.filter(([, isMissing]) => isMissing).map(([key]) => key);
};

/** api 錯誤 → 對話框欄位下的原因與提示(REACT-18;api 的 `startAt` / `endAt` 對到開始 / 結束時間)。 */
export const demandErrorTextsOf = (
  error: unknown,
  t: (key: string, values?: Record<string, string>) => string,
) =>
  scheduleErrorTextsOf(
    error,
    DEMAND_FIELDS,
    t,
    (field) => DEMAND_API_FIELDS[field],
  );
