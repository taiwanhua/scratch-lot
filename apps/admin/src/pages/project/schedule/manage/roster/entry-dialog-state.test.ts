import { describe, expect, it } from "@jest/globals";

import {
  type EntryCheckContext,
  type EntryFormState,
  entryCheckReasonsOf,
  leaderRuleOf,
} from "./entry-dialog-state";
import type { RosterDemand, RosterEntry } from "./roster-context";

const TZ = "Asia/Taipei";

const demand: RosterDemand = {
  id: "d-1",
  date: "2026-11-10",
  startAt: "2026-11-10T01:00:00.000Z",
  endAt: "2026-11-10T05:00:00.000Z",
  positionKey: "in-store-counter",
  positionNote: null,
  templateId: null,
  source: "manual",
  createdAt: "2026-10-01T00:00:00.000Z",
  tasks: [
    { taskId: "t1", role: "leader", taskKey: "lead", entryId: null },
    { taskId: "t2", role: "helper", taskKey: "help", entryId: null },
  ],
};

const form = (patch: Partial<EntryFormState> = {}): EntryFormState => ({
  userId: "u-1",
  date: "2026-11-10",
  startTime: "09:00",
  endTime: "13:00",
  breakText: "0",
  rows: [{ key: "r1", demandId: "d-1", taskId: "t2" }],
  ...patch,
});

const context = (
  patch: Partial<EntryCheckContext> = {},
): EntryCheckContext => ({
  calendarDays: [],
  unavailability: [],
  demands: [demand],
  rule: leaderRuleOf({ canLead: true }, null),
  timezone: TZ,
  ...patch,
});

const closed = (date: string) =>
  ({ date, type: "closed", name: null, paletteKey: null }) as const;

/**
 * 送出前就擋的規則要和 api(`schedule-roster-writes.service.ts`)一致,而且**不能比 api 嚴**:
 * 店休(含跨午夜的隔天)、畫休重疊(頭尾相接不算)、不能擔任負責人(編輯時原本填著的不擋)。
 */
describe("entryCheckReasonsOf", () => {
  it("沒有規則擋 → 空", () => {
    expect(entryCheckReasonsOf(form(), context())).toEqual({});
  });

  it("店休:這天 → 上班欄;跨午夜碰到隔天店休也擋;下班剛好在午夜不算隔天", () => {
    expect(
      entryCheckReasonsOf(
        form(),
        context({ calendarDays: [closed("2026-11-10")] }),
      ),
    ).toEqual({ startTime: "STORE_CLOSED" });
    const nextClosed = context({ calendarDays: [closed("2026-11-11")] });
    expect(
      entryCheckReasonsOf(
        form({ startTime: "20:00", endTime: "02:00" }),
        nextClosed,
      ),
    ).toEqual({ startTime: "STORE_CLOSED" });
    expect(
      entryCheckReasonsOf(
        form({ startTime: "20:00", endTime: "00:00" }),
        nextClosed,
      ),
    ).toEqual({});
  });

  it("畫休:整天 / 時段重疊擋;頭尾相接、別人的畫休不擋", () => {
    const fullDay = context({
      unavailability: [
        { userId: "u-1", date: "2026-11-10", fullDay: true, slots: [] },
      ],
    });
    expect(entryCheckReasonsOf(form(), fullDay)).toEqual({
      startTime: "DAY_OFF_CONFLICT",
    });
    expect(entryCheckReasonsOf(form({ userId: "u-2" }), fullDay)).toEqual({});
    // 前一天整天畫休、班從前一天以外開始 → 不擋;跨午夜碰到隔天整天畫休 → 擋
    const nextDayOff = context({
      unavailability: [
        { userId: "u-1", date: "2026-11-11", fullDay: true, slots: [] },
      ],
    });
    expect(entryCheckReasonsOf(form(), nextDayOff)).toEqual({});
    expect(
      entryCheckReasonsOf(
        form({ startTime: "20:00", endTime: "01:00" }),
        nextDayOff,
      ),
    ).toEqual({ startTime: "DAY_OFF_CONFLICT" });

    const slot = context({
      unavailability: [
        {
          userId: "u-1",
          date: "2026-11-10",
          fullDay: false,
          slots: [
            {
              startAt: "2026-11-10T13:00:00+08:00",
              endAt: "2026-11-10T17:00:00+08:00",
            },
          ],
        },
      ],
    });
    expect(entryCheckReasonsOf(form(), slot)).toEqual({});
    expect(
      entryCheckReasonsOf(form({ startTime: "12:00", endTime: "14:00" }), slot),
    ).toEqual({ startTime: "DAY_OFF_CONFLICT" });

    // 時段做到當天結束(結束 00:00 = 隔天 00:00):晚上的班擋;跨午夜的班碰到也擋;隔天 00:00 起的不擋
    const untilMidnight = context({
      unavailability: [
        {
          userId: "u-1",
          date: "2026-11-10",
          fullDay: false,
          // 結束 = 隔天 00:00(時點)
          slots: [
            {
              startAt: "2026-11-10T20:00:00+08:00",
              endAt: "2026-11-11T00:00:00+08:00",
            },
          ],
        },
      ],
    });
    expect(
      entryCheckReasonsOf(
        form({ startTime: "21:00", endTime: "23:00" }),
        untilMidnight,
      ),
    ).toEqual({ startTime: "DAY_OFF_CONFLICT" });
    expect(
      entryCheckReasonsOf(
        form({ startTime: "17:00", endTime: "20:00" }),
        untilMidnight,
      ),
    ).toEqual({});
    expect(
      entryCheckReasonsOf(
        form({ date: "2026-11-11", startTime: "00:00", endTime: "06:00" }),
        untilMidnight,
      ),
    ).toEqual({});
  });

  it("不能擔任負責人:填了負責任務才擋;還沒選人不擋;編輯時原本就填著的不擋", () => {
    const leaderRow = form({
      rows: [{ key: "r1", demandId: "d-1", taskId: "t1" }],
    });
    expect(
      entryCheckReasonsOf(
        leaderRow,
        context({ rule: leaderRuleOf({ canLead: false }, null) }),
      ),
    ).toEqual({ assignments: "CANNOT_LEAD" });
    expect(
      entryCheckReasonsOf(
        form(),
        context({ rule: leaderRuleOf({ canLead: false }, null) }),
      ),
    ).toEqual({});
    expect(
      entryCheckReasonsOf(
        leaderRow,
        context({ rule: leaderRuleOf(undefined, null) }),
      ),
    ).toEqual({});
    const entry = {
      id: "e-1",
      assignments: [{ demandId: "d-1", taskId: "t1", source: "manual" }],
    } as unknown as RosterEntry;
    expect(
      entryCheckReasonsOf(
        leaderRow,
        context({ rule: leaderRuleOf({ canLead: false }, entry) }),
      ),
    ).toEqual({});
  });
});
