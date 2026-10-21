import { HttpResponse } from "msw";

import type {
  MakeupPunchEntryExistsQueryVariables,
  MakeupPunchEntryOptionsQueryVariables,
  ReassignSchedulePunchMutationVariables,
  ScheduleAttendanceAbilitiesFieldsFragment,
  ScheduleAttendanceByPersonQueryVariables,
  ScheduleAttendanceByStoreQueryVariables,
  ScheduleAttendanceExportQueryVariables,
  ScheduleAttendancePunchFieldsFragment,
} from "@repo/graphql";

import { api } from "../server";
import {
  ATTENDANCE_ORG,
  ATTENDANCE_PEOPLE,
  personMonthRows,
  storeDayRows,
  storeDayUnmatched,
} from "./schedule-attendance-fixtures";
import { MAKEUP_ENTRY_DELETED_ID } from "./schedule-makeup-punch-fixtures";

export interface ScheduleAttendanceWorldOptions {
  /** 有 `view-all`(預設有;沒有 = 只看自己 = 王小明) */
  canViewAll?: boolean;
  canReassign?: boolean;
  canExport?: boolean;
  canCreate?: boolean;
  /** 我送出、審核中的補打卡申請對應的排班 */
  pendingEntryIds?: string[];
}

const SELF = "u-wang";

const at = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

/**
 * 出勤紀錄的假 api(有狀態):任何日期 / 月份都回同一組示範資料(SC-11 / SC-12);
 * 改對應排班把那張卡從「未對應排班」拿掉;記錄送出的 input 給測試斷言。
 */
export const scheduleAttendanceWorld = (
  options: ScheduleAttendanceWorldOptions = {},
) => {
  const abilities: ScheduleAttendanceAbilitiesFieldsFragment = {
    canViewAll: options.canViewAll ?? true,
    canReassign: options.canReassign ?? true,
    canExport: options.canExport ?? true,
    canCreate: options.canCreate ?? true,
  };
  const reassigned = new Map<string, string | null>();
  const inputs = {
    reassigned: [] as ReassignSchedulePunchMutationVariables["input"][],
    byStore: [] as ScheduleAttendanceByStoreQueryVariables["input"][],
    exports: [] as ScheduleAttendanceExportQueryVariables["input"][],
  };
  const isOwn = (userId: string) => abilities.canViewAll || userId === SELF;
  const stillUnmatched = (punch: ScheduleAttendancePunchFieldsFragment) =>
    !reassigned.has(punch.id) || reassigned.get(punch.id) === null;

  const handlers = [
    api.query("ScheduleAttendanceByStore", ({ variables }) => {
      const { input } = variables as ScheduleAttendanceByStoreQueryVariables;
      inputs.byStore.push(input);
      const rows = storeDayRows(input.date).filter((row) => isOwn(row.userId));
      const unmatched = storeDayUnmatched(input.date)
        .filter((punch) => isOwn(punch.userId))
        .filter((punch) => stillUnmatched(punch));
      return HttpResponse.json({
        data: {
          scheduleAttendanceByStore: {
            orgId: input.orgId ?? ATTENDANCE_ORG.id,
            orgName: ATTENDANCE_ORG.name,
            date: input.date,
            rows: input.unmatchedOnly === true ? [] : rows,
            unmatched,
            scheduledCount: rows.length,
            arrivedCount: rows.filter((row) => row.status === "arrived").length,
            absentCount: rows.filter((row) => row.status === "absent").length,
            abilities,
          },
        },
      });
    }),
    api.query("ScheduleAttendanceByPerson", ({ variables }) => {
      const { input } = variables as ScheduleAttendanceByPersonQueryVariables;
      const userId = input.userId ?? SELF;
      if (!abilities.canViewAll && userId !== SELF) {
        return HttpResponse.json({
          errors: [
            {
              message: "missing permission",
              extensions: { code: "FORBIDDEN", reason: "MISSING_PERMISSION" },
            },
          ],
        });
      }
      const person = ATTENDANCE_PEOPLE.find((item) => item.userId === userId);
      return HttpResponse.json({
        data: {
          scheduleAttendanceByPerson: {
            month: input.month,
            orgId: input.orgId ?? ATTENDANCE_ORG.id,
            userId,
            people: abilities.canViewAll
              ? ATTENDANCE_PEOPLE
              : ATTENDANCE_PEOPLE.filter((item) => item.userId === SELF),
            rows: personMonthRows(input.month).map((row) => ({
              ...row,
              userId,
              userName: person?.name ?? row.userName,
            })),
            unmatched: [],
            abilities,
          },
        },
      });
    }),
    api.query("ScheduleAttendanceExport", ({ variables }) => {
      const { input } = variables as ScheduleAttendanceExportQueryVariables;
      inputs.exports.push(input);
      return HttpResponse.json({
        data: {
          scheduleAttendanceExport: {
            month: input.month,
            sheets: [
              {
                orgId: ATTENDANCE_ORG.id,
                orgName: ATTENDANCE_ORG.name,
                rows: personMonthRows(input.month),
              },
            ],
          },
        },
      });
    }),
    api.query("ScheduleAttendancePunchEntryOptions", () =>
      HttpResponse.json({
        data: {
          scheduleAttendancePunchEntryOptions: [
            {
              id: "e-chang-temp",
              orgId: ATTENDANCE_ORG.id,
              orgName: ATTENDANCE_ORG.name,
              date: "2026-11-04",
              startAt: at("2026-11-04", "13:00"),
              endAt: at("2026-11-04", "17:00"),
              shortName: "補",
            },
          ],
        },
      }),
    ),
    api.mutation("ReassignSchedulePunch", ({ variables }) => {
      const { input } = variables as ReassignSchedulePunchMutationVariables;
      inputs.reassigned.push(input);
      reassigned.set(input.punchId, input.entryId ?? null);
      return HttpResponse.json({
        data: {
          reassignSchedulePunch: {
            id: input.punchId,
            userId: "u-chang",
            userName: "張小芳",
            orgId: ATTENDANCE_ORG.id,
            orgName: ATTENDANCE_ORG.name,
            type: "in",
            at: at("2026-11-04", "09:02"),
            entryId: input.entryId ?? null,
            source: "button",
            duplicate: false,
          },
        },
      });
    }),
    api.query("MakeupPunchEntryOptions", ({ variables }) => {
      const { input } = variables as MakeupPunchEntryOptionsQueryVariables;
      return HttpResponse.json({
        data: {
          makeupPunchEntryOptions: [
            {
              id: `e-wang-${input.date}`,
              orgId: input.orgId,
              orgName: "",
              date: input.date,
              startAt: at(input.date, "08:30"),
              endAt: at(input.date, "14:30"),
              shortName: "早",
            },
            {
              id: `e-wang-late-${input.date}`,
              orgId: input.orgId,
              orgName: "",
              date: input.date,
              startAt: at(input.date, "17:00"),
              endAt: at(input.date, "22:00"),
              shortName: "晚",
            },
          ],
        },
      });
    }),
    api.query("MyPendingMakeupPunchEntryIds", () =>
      HttpResponse.json({
        data: { myPendingMakeupPunchEntryIds: options.pendingEntryIds ?? [] },
      }),
    ),
    api.query("MakeupPunchEntryExists", ({ variables }) => {
      const { submissionId } =
        variables as MakeupPunchEntryExistsQueryVariables;
      return HttpResponse.json({
        data: {
          makeupPunchEntryExists: submissionId !== MAKEUP_ENTRY_DELETED_ID,
        },
      });
    }),
  ];

  return { handlers, inputs };
};
