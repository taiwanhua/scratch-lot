import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { useScheduleRosterQuery } from "@repo/graphql";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";

import { DemandDialog } from "./DemandDialog";
import { EntryDialog } from "./EntryDialog";
import { RemoveDayDialog } from "./RemoveDayDialog";
import { RosterToolbar } from "./RosterToolbar";
import {
  type DemandPreset,
  type EntryPreset,
  type RosterCellTarget,
  RosterContext,
  type RosterContextValue,
  type RosterDemand,
  type RosterEntry,
  isDemand,
  isEntry,
  rosterCellKey,
} from "./roster-context";
import { ROSTER_TOOLBAR_ACTIONS } from "./roster-toolbar";
import { readRosterView, writeRosterView } from "./roster-view-memory";
import { ROSTER_VIEWS, type RosterViewEntry } from "./roster-views";
import { ROSTER_DATE_SCHEMA, useTenantToday } from "./views/useRosterDate";

const orgSchema = z.string().default("");
/** `?month=YYYY-MM`;空字串 / 格式不對 = 這個月。 */
const monthSchema = z.string().default("");
/** `?view=`:月 / 週 / 日 / 班表;空字串 = 這台裝置上次選的(沒有 = 電腦班表、手機日)。 */
const viewSchema = z.string().default("");
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

/** 閃爍多久(檢核 [查看] 捲到那一格)。 */
const FLASH_MS = 2000;
/** 要捲到的格子最多等多久出現。 */
const SCROLL_REQUEST_TTL_MS = 10_000;
/** 閃爍的樣子:外框亮兩下(主題的 warning 色以 CSS 變數取;沒有變數時退回 currentColor)。 */
const FLASH_FRAMES: Keyframe[] = [
  {
    boxShadow: "inset 0 0 0 2px var(--mui-palette-warning-main, currentColor)",
  },
  { boxShadow: "inset 0 0 0 2px transparent" },
];

const currentMonth = (): string => {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

type DialogState =
  | { kind: "demand"; demand: RosterDemand | null; preset: DemandPreset }
  | { kind: "entry"; entry: RosterEntry | null; preset: EntryPreset }
  | { kind: "removeDay"; date: string }
  | null;

const pickView = (value: string, isMobile: boolean): RosterViewEntry => {
  const fallback =
    ROSTER_VIEWS.find((item) =>
      isMobile ? item.isMobileDefault === true : item.isDesktopDefault === true,
    ) ??
    ROSTER_VIEWS.find((item) => item.isDesktopDefault === true) ??
    ROSTER_VIEWS.at(0);
  if (fallback === undefined) {
    throw new Error("排班表至少要登記一個檢視");
  }
  return ROSTER_VIEWS.find((item) => item.value === value) ?? fallback;
};

/**
 * 排班作業 → 排班表(SC-03;規格 14.5「排班表」)的頁殼:工具列、檢視切換(`roster-views.ts`)、
 * 檢視與月份放網址參數、每台裝置記住上次選的檢視;同一份資料、同一套對話框(人力需求 / 排班 /
 * 移除這天所有排班),經 `RosterContext` 給各檢視與工具列功能;`scrollToCell(target)` 給檢核 [查看]。
 *
 * - 這個月還沒有人力需求 → 「11 月還沒有人力需求」與 [套用範本](套用範本的功能登記後才出現)
 * - 沒有 `edit`:看不到新增類按鈕、日期欄 [⋯];點格子 / 人力需求開唯讀對話框
 */
export const RosterPage = () => {
  const t = useTranslations("admin.schedule.roster");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const isMobile = useBreakpointDown("sm");
  const { hasPermission } = usePermissions();
  const [orgId, setOrgId] = useUrlState("org", orgSchema);
  const [monthParam, setMonth] = useUrlState("month", monthSchema);
  const [viewParam, setView] = useUrlState("view", viewSchema);
  const month = MONTH_PATTERN.test(monthParam) ? monthParam : currentMonth();
  const view = pickView(
    viewParam === "" ? (readRosterView() ?? "") : viewParam,
    isMobile,
  );
  // 週 / 日檢視的日期(`?date=`);週檢視跨月時多讀那幾天(`readRangeOf`)
  const [dateParam] = useUrlState("date", ROSTER_DATE_SCHEMA);
  const today = useTenantToday();
  const readRange = view.readRangeOf?.(dateParam, month, today) ?? null;
  const [dialog, setDialog] = useState<DialogState>(null);
  /**
   * 要捲到的格子(`scrollToCell`):`scrolled` = 已經找到格子捲過去、正在閃爍。還沒在畫面上
   * (換月等資料、週 / 日檢視還在帶到那一天)時留著,每次重畫再找一次;閃完清掉。
   */
  const [scrollRequest, setScrollRequest] = useState<{
    target: RosterCellTarget;
    key: string;
  } | null>(null);
  /** 已經捲過的那一次請求(同一個物件就不再捲;新的請求是新物件) */
  const handledRequest = useRef<object | null>(null);

  const query = useScheduleRosterQuery(session.client, {
    input: {
      month,
      ...(orgId === "" ? {} : { orgId }),
      ...readRange,
    },
  });
  const data = query.data?.scheduleRoster;

  // 目標格子畫出來之後才捲並閃爍(直接在元素上播動畫,不經狀態)
  useEffect(() => {
    if (scrollRequest === null || handledRequest.current === scrollRequest) {
      return;
    }
    // 先找 `userId|date`;這個檢視沒有人的格子(例:月檢視)就改找那一天 `|date`
    const find = (key: string) =>
      globalThis.document.querySelector<HTMLElement>(
        `[data-roster-cell="${CSS.escape(key)}"]`,
      );
    const element =
      find(scrollRequest.key) ??
      find(rosterCellKey({ date: scrollRequest.target.date }));
    if (element === null) {
      return;
    }
    handledRequest.current = scrollRequest;
    element.scrollIntoView({ block: "center", inline: "center" });
    if (typeof element.animate === "function") {
      element.animate(FLASH_FRAMES, { duration: FLASH_MS / 2, iterations: 2 });
    }
  });

  // 請求最多留 10 秒(等換月的資料、等檢視帶到那一天);之後清掉,`scrollTarget` 回 null
  useEffect(() => {
    if (scrollRequest === null) {
      return;
    }
    const timer = setTimeout(() => {
      setScrollRequest(null);
    }, SCROLL_REQUEST_TTL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [scrollRequest]);

  /**
   * 捲到那一格並閃爍(檢核面板 [查看]):頁殼先切到目標日期的月份;其餘由**目前的檢視**負責把目標帶進畫面
   * (週 / 日檢視讀 `scrollTarget` 切到那一週 / 那一天),並在格子上帶 `data-roster-cell`
   * (`rosterCellKey`)。找到元素就捲過去並閃爍。
   */
  const scrollToCell = (target: RosterCellTarget) => {
    const targetMonth = target.date.slice(0, 7);
    if (targetMonth !== month) {
      setMonth(targetMonth);
    }
    setScrollRequest({ target, key: rosterCellKey(target) });
  };

  const context: RosterContextValue | null =
    data === undefined
      ? null
      : {
          data,
          timezone,
          canEdit: data.canEdit,
          openDemand: (target) => {
            setDialog(
              isDemand(target)
                ? { kind: "demand", demand: target, preset: {} }
                : { kind: "demand", demand: null, preset: target },
            );
          },
          openEntry: (target) => {
            setDialog(
              isEntry(target)
                ? { kind: "entry", entry: target, preset: {} }
                : { kind: "entry", entry: null, preset: target },
            );
          },
          removeDay: (date) => {
            setDialog({ kind: "removeDay", date });
          },
          scrollToCell,
          scrollTarget: scrollRequest?.target ?? null,
        };

  const applyTemplates = ROSTER_TOOLBAR_ACTIONS.find(
    (action) =>
      action.key === "apply-templates" && hasPermission(action.permission),
  );
  const closeDialog = () => {
    setDialog(null);
  };
  const { Content } = view;
  const [, monthNumber = ""] = month.split("-");

  return (
    <Stack spacing={2}>
      <RosterToolbar
        data={data}
        month={month}
        view={view}
        onOrgChange={setOrgId}
        onMonthChange={setMonth}
        onViewChange={(next) => {
          writeRosterView(next);
          setView(next);
        }}
        onAddDemand={() => {
          setDialog({ kind: "demand", demand: null, preset: {} });
        }}
        onAddEntry={() => {
          setDialog({ kind: "entry", entry: null, preset: {} });
        }}
      />
      {context === null && (
        <Stack sx={{ alignItems: "center", py: 4 }}>
          {query.isError ? (
            <Typography color="text.secondary">{t("loadError")}</Typography>
          ) : (
            <CircularProgress size={24} aria-label={t("loading")} />
          )}
        </Stack>
      )}
      {context !== null && (
        <RosterContext value={context}>
          {context.data.demands.length === 0 ? (
            <Card variant="outlined">
              <Stack spacing={1.5} sx={{ alignItems: "center", py: 4, px: 2 }}>
                <Typography variant="h6">
                  {t("empty.title", { month: Number(monthNumber) })}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", maxWidth: 360 }}
                >
                  {t("empty.description")}
                </Typography>
                {applyTemplates !== undefined && context.canEdit && (
                  <applyTemplates.Action
                    variant="toolbar"
                    onDone={closeDialog}
                  />
                )}
              </Stack>
            </Card>
          ) : (
            <Content />
          )}
          {dialog?.kind === "demand" && (
            <DemandDialog
              demand={dialog.demand}
              preset={dialog.preset}
              onClose={closeDialog}
            />
          )}
          {dialog?.kind === "entry" && (
            <EntryDialog
              entry={dialog.entry}
              preset={dialog.preset}
              onClose={closeDialog}
            />
          )}
          {dialog?.kind === "removeDay" && (
            <RemoveDayDialog date={dialog.date} onClose={closeDialog} />
          )}
        </RosterContext>
      )}
    </Stack>
  );
};
