import { type ReactNode, useState } from "react";

import {
  defaultCheckedPunchIds,
  punchSpanOf,
  unmatchedOfPersonDay,
} from "@/lib/project/schedule-attendance";
import { localPartsOf, monthDayOf } from "@/lib/project/schedule-roster";

import { UnmatchedPunchesBlock } from "./UnmatchedPunchesBlock";
import type { EntryFormState } from "./entry-dialog-state";
import { useRoster } from "./roster-context";

export interface EntryPunchesOptions {
  /** 目前的上下班時間(還沒填好 = null;預設勾選看它) */
  span: { startAt: string; endAt: string } | null;
  canEdit: boolean;
  /** 「上下班時間改用打卡時間」換掉上下班欄位(`HH:mm`) */
  setTimes: (startTime: string, endTime: string) => void;
}

export interface EntryPunches {
  /** 對話框裡的區塊(這個人那天沒有未對應的卡 = null) */
  block: ReactNode;
  /** 送出時附在 input 的部分(沒有卡 = 不附) */
  inputPart: { punchIds?: string[]; usePunchTime?: boolean };
}

/**
 * 排班對話框的「未對應排班的打卡」(規格 14.5;SC-04d / SC-04e ①):這個人那天在這家店未對應的卡、
 * 勾選狀態(使用者還沒動 = 預設:排班時間前後容許時間內、重複打卡不勾)、「上下班時間改用打卡時間」。
 */
export const useEntryPunches = (
  form: Pick<EntryFormState, "userId" | "date" | "startTime" | "endTime">,
  personName: string,
  { span, canEdit, setTimes }: EntryPunchesOptions,
): EntryPunches => {
  const { userId, date, startTime, endTime } = form;
  const { data, timezone } = useRoster();
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [usePunchTime, setUsePunchTime] = useState(false);
  const punches = unmatchedOfPersonDay(data.unmatchedPunches, userId, date);
  const checked =
    picked ??
    defaultCheckedPunchIds(
      punches,
      span,
      data.settings.entryMatchToleranceMinutes,
    );

  /** 上下班欄位換成勾選的最早上班卡 / 最晚下班卡(沒有那一種就不換) */
  const applyPunchTime = (next: ReadonlySet<string>) => {
    const times = punchSpanOf(punches, next);
    setTimes(
      times.startAt === null
        ? startTime
        : localPartsOf(times.startAt, timezone).time,
      times.endAt === null ? endTime : localPartsOf(times.endAt, timezone).time,
    );
  };

  if (punches.length === 0) {
    return { block: null, inputPart: {} };
  }
  return {
    block: (
      <UnmatchedPunchesBlock
        heading={`${personName} ${date === "" ? "" : monthDayOf(date, timezone)}`}
        punches={punches}
        checked={checked}
        disabled={!canEdit}
        timezone={timezone}
        canUsePunchTime={data.canUsePunchTime}
        usePunchTime={usePunchTime}
        onToggle={(punchId, isChecked) => {
          const next = new Set(checked);
          if (isChecked) {
            next.add(punchId);
          } else {
            next.delete(punchId);
          }
          setPicked(next);
          if (usePunchTime) {
            applyPunchTime(next);
          }
        }}
        onUsePunchTimeChange={(next) => {
          setUsePunchTime(next);
          // 時間換掉後預設勾選會跟著變:先把目前的勾選固定下來
          setPicked(checked);
          if (next) {
            applyPunchTime(checked);
          }
        }}
      />
    ),
    inputPart: {
      punchIds: punches
        .filter((punch) => checked.has(punch.id))
        .map((punch) => punch.id),
      ...(usePunchTime && { usePunchTime: true }),
    },
  };
};
