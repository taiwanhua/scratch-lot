import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type MyScheduleQuery,
  type PunchMyScheduleMutation,
  usePunchMyScheduleMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Collapse } from "@repo/ui/collapse";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronDownIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { scheduleErrorOf } from "../../schedule-error";
import { type MyEntry, useMyEntryText } from "./useMyEntryText";

type Page = MyScheduleQuery["mySchedule"];

/** codegen 的 query key 第一段是 operation 名稱(`useMyScheduleQuery.getKey`)。 */
export const MY_SCHEDULE_QUERY_KEY = "MySchedule";

type Punch = (type: "in" | "out", entryId: string | null) => void;

/** 打卡:成功後重讀我的班表(打卡區、月曆的打卡紀錄一起更新)。 */
const usePunch = (): { punch: Punch; isPending: boolean } => {
  const t = useTranslations("admin.schedule.mySchedule.punch");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const mutation = usePunchMyScheduleMutation(
    session.client,
    useMutationFeedback<PunchMyScheduleMutation>({
      success: (data) =>
        data.punchMySchedule.type === "in"
          ? t("clockInSuccess")
          : t("clockOutSuccess"),
      error: (error) => tErrors(scheduleErrorOf(error).code),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: [MY_SCHEDULE_QUERY_KEY],
        });
      },
    }),
  );
  return {
    punch: (type, entryId) => {
      mutation.mutate({ input: { type, entryId } });
    },
    isPending: mutation.isPending,
  };
};

interface EntryLineProps {
  entry: MyEntry;
  /** 「晚 14:30–22:00」也寫在這一行(昨天的卡片) */
  withTime?: boolean;
}

/** 「中山店 · 店內櫃台 ☕30 [負責人]」。 */
const EntryLine = ({ entry, withTime = false }: EntryLineProps) => {
  const t = useTranslations("admin.schedule.mySchedule");
  const text = useMyEntryText();
  const position = text.position(entry);
  const head = withTime
    ? `${entry.orgName} ${text.shortName(entry)} ${text.time(entry)}`
    : entry.orgName;
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: "center", flexWrap: "wrap" }}
    >
      <Typography variant="body2" color="textSecondary">
        {[head, position].filter((part) => part !== "").join(" · ")}
      </Typography>
      {entry.breakMinutes > 0 && (
        <Typography
          variant="caption"
          color="textSecondary"
          aria-label={t("punch.breakAria", { minutes: entry.breakMinutes })}
        >
          ☕{entry.breakMinutes}
        </Typography>
      )}
      <Tag
        tone={entry.isLead ? "success" : "grey"}
        label={entry.isLead ? t("role.leader") : t("role.helper")}
      />
    </Stack>
  );
};

interface PunchCardProps {
  day: "today" | "yesterday";
  entry: MyEntry;
  canPunch: boolean;
  onPunch: Punch;
  disabled: boolean;
}

/** 一張排班卡片:今天的班上下班按鈕同時顯示;昨天未打下班卡的班只有 [打下班卡]。 */
const PunchCard = ({
  day,
  entry,
  canPunch,
  onPunch,
  disabled,
}: PunchCardProps) => {
  const t = useTranslations("admin.schedule.mySchedule.punch");
  const text = useMyEntryText();
  const clockIn = text.punchTime(entry.clockIn);
  const clockOut = text.punchTime(entry.clockOut);

  if (day === "yesterday") {
    return (
      <Card variant="outlined" sx={{ p: 2 }} data-punch-card={entry.id}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" sx={{ color: "warning.dark" }}>
            {t("yesterdayTitle", { date: text.dateTitle(entry.date) })}
          </Typography>
          <EntryLine entry={entry} withTime />
          {clockIn !== null && (
            <Typography variant="body2" color="success">
              {t("clockedIn", { time: clockIn })}
            </Typography>
          )}
          {canPunch && (
            <Button
              variant="outlined"
              fullWidth
              disabled={disabled}
              onClick={() => {
                onPunch("out", entry.id);
              }}
            >
              {t("clockOut")}
            </Button>
          )}
        </Stack>
      </Card>
    );
  }

  // 還沒打上班卡 → 上班卡是主要按鈕;打了之後換下班卡
  const nextIsIn = clockIn === null;
  return (
    <Card variant="outlined" sx={{ p: 2 }} data-punch-card={entry.id}>
      <Stack spacing={1.5}>
        <Typography variant="h6">
          {t("todayTitle", {
            date: text.dateTitle(entry.date),
            time: text.time(entry),
          })}
        </Typography>
        <EntryLine entry={entry} />
        {(clockIn !== null || clockOut !== null) && (
          <Stack spacing={0.25}>
            {clockIn !== null && (
              <Typography variant="body2" color="success">
                {t("clockedIn", { time: clockIn })}
              </Typography>
            )}
            {clockOut !== null && (
              <Typography variant="body2" color="success">
                {t("clockedOut", { time: clockOut })}
              </Typography>
            )}
          </Stack>
        )}
        {canPunch && (
          <Stack direction="row" spacing={1.5}>
            <Button
              fullWidth
              variant={nextIsIn ? "contained" : "outlined"}
              disabled={disabled}
              onClick={() => {
                onPunch("in", entry.id);
              }}
            >
              {t("clockIn")}
            </Button>
            <Button
              fullWidth
              variant={nextIsIn ? "outlined" : "contained"}
              disabled={disabled}
              onClick={() => {
                onPunch("out", entry.id);
              }}
            >
              {t("clockOut")}
            </Button>
          </Stack>
        )}
      </Stack>
    </Card>
  );
};

interface NoScheduleBlockProps {
  page: Page;
  onPunch: Punch;
  disabled: boolean;
}

/**
 * 「沒有排班」區塊:今天有班時收合成一行連結「沒有排到班但臨時來上班?」;今天沒班時展開;
 * 已經打了未對應排班的上班卡時展開並醒目顯示 [打下班卡]。打的卡記在當前組織、未對應排班。
 */
const NoScheduleBlock = ({ page, onPunch, disabled }: NoScheduleBlockProps) => {
  const t = useTranslations("admin.schedule.mySchedule.noSchedule");
  const tPunch = useTranslations("admin.schedule.mySchedule.punch");
  const text = useMyEntryText();
  const open = page.openUnmatchedClockIn ?? null;
  const [expanded, setExpanded] = useState(
    !page.hasEntryToday || open !== null,
  );
  const isExpanded = expanded || open !== null;
  return (
    <Card variant="outlined" sx={{ p: 2 }} data-no-schedule>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", cursor: "pointer" }}
        onClick={() => {
          setExpanded((value) => !value);
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t("title")}
        </Typography>
        <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
          {t("hint")}
        </Typography>
        <IconButton
          size="small"
          aria-label={t("toggleAria")}
          aria-expanded={isExpanded}
        >
          <ChevronDownIcon
            sx={{ transform: isExpanded ? "rotate(180deg)" : "none" }}
          />
        </IconButton>
      </Stack>
      <Collapse in={isExpanded}>
        <Stack spacing={1.5} sx={{ pt: 1.5 }}>
          <Typography variant="body2" color="textSecondary">
            {t("org", { name: page.currentOrg.name })}
          </Typography>
          {open !== null && (
            <Typography variant="body2" sx={{ color: "warning.dark" }}>
              {t("openClockIn", { time: text.punchTime(open.at) ?? "" })}
            </Typography>
          )}
          <Stack direction="row" spacing={1.5}>
            <Button
              fullWidth
              variant={open === null ? "contained" : "outlined"}
              disabled={disabled}
              onClick={() => {
                onPunch("in", null);
              }}
            >
              {tPunch("clockIn")}
            </Button>
            <Button
              fullWidth
              variant={open === null ? "outlined" : "contained"}
              disabled={disabled}
              onClick={() => {
                onPunch("out", null);
              }}
            >
              {tPunch("clockOut")}
            </Button>
          </Stack>
        </Stack>
      </Collapse>
    </Card>
  );
};

/**
 * 班表分頁最上方的打卡區(SC-01 / SC-25 / SC-32;規格 14.6 打卡):今天的班 + 昨天未打下班卡的班的卡片,
 * 下面是「沒有排班」區塊。沒有 `schedule.my.punch` → 卡片照常顯示(班與打卡紀錄)但沒有 [打上班卡] [打下班卡],
 * 「沒有排班」區塊不顯示。
 */
export const PunchArea = ({ page }: { page: Page }) => {
  const t = useTranslations("admin.schedule.mySchedule.punch");
  const { punch, isPending } = usePunch();
  return (
    <Box component="section" aria-label={t("regionAria")}>
      <Stack spacing={1.5}>
        {page.punchCards.map((card) => (
          <PunchCard
            key={`${card.day}-${card.entry.id}`}
            day={card.day === "yesterday" ? "yesterday" : "today"}
            entry={card.entry}
            canPunch={page.canPunch}
            onPunch={punch}
            disabled={isPending}
          />
        ))}
        {page.canPunch && (
          <NoScheduleBlock page={page} onPunch={punch} disabled={isPending} />
        )}
      </Stack>
    </Box>
  );
};
