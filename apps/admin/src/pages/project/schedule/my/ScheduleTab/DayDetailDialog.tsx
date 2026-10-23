import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Drawer } from "@repo/ui/drawer";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useMakeupPunchLink } from "./makeup-punch";
import { type MyEntry, useMyEntryText } from "./useMyEntryText";

export interface DayDetailDialogProps {
  date: string;
  /** 那天我的班(可能跨店多筆) */
  entries: readonly MyEntry[];
  /** 那天整天畫休 */
  isDayOff: boolean;
  onClose: () => void;
}

/** 一筆班的詳情:分店 · 簡稱 時間 · 崗位、職責與任務內容、打卡紀錄表、缺卡說明。 */
const EntryDetail = ({ entry }: { entry: MyEntry }) => {
  const t = useTranslations("admin.schedule.mySchedule.detail");
  const tMissing = useTranslations("admin.schedule.mySchedule.missing");
  const text = useMyEntryText();
  const rows = [
    { key: "in", label: t("in"), value: text.punchTime(entry.clockIn) },
    { key: "out", label: t("out"), value: text.punchTime(entry.clockOut) },
  ];
  const missing = text.missing(entry);
  return (
    <Stack spacing={1.5} data-day-detail-entry={entry.id}>
      <Stack spacing={0.5}>
        <Typography variant="body2" color="textPrimary">
          {[
            entry.orgName,
            `${text.shortName(entry)} ${text.time(entry)}`,
            text.position(entry),
          ]
            .filter((part) => part !== "")
            .join(" · ")}
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          {entry.tasks.map((task) => (
            <Tag
              key={`${task.positionKey}-${task.taskKey}-${task.role}`}
              tone={task.role === "leader" ? "success" : "grey"}
              label={text.taskLine(task)}
            />
          ))}
          {entry.breakMinutes > 0 && (
            <Typography variant="caption" color="textSecondary">
              {t("breakMinutes", { minutes: entry.breakMinutes })}
            </Typography>
          )}
        </Stack>
      </Stack>
      <Box
        component="table"
        sx={{
          width: "100%",
          borderCollapse: "collapse",
          "& th, & td": {
            textAlign: "left",
            py: 1,
            px: 1.5,
            borderBottom: 1,
            borderColor: "divider",
            typography: "body2",
          },
          "& th": { bgcolor: "action.hover", fontWeight: 600 },
        }}
      >
        <thead>
          <tr>
            <th scope="col">{t("punch")}</th>
            <th scope="col">{t("time")}</th>
            <th scope="col" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{row.value ?? "—"}</td>
              <td style={{ textAlign: "right" }}>
                {row.value === null && entry.missing.includes(row.key) && (
                  <Tag
                    tone="error"
                    label={
                      row.key === "in"
                        ? tMissing("missingIn")
                        : tMissing("missingOut")
                    }
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Box>
      {missing !== null && (
        <Typography variant="caption" color="textSecondary">
          {t("missingNote", { cards: missing })}
        </Typography>
      )}
    </Stack>
  );
};

/**
 * 點一天 → 當天詳情(SC-39;規格 14.6「月曆」):排班、職責與任務內容、打卡紀錄;缺卡時說明缺了哪張卡並附
 * [申請補卡](補打卡申請併回前不顯示,見 `makeup-punch.ts`)。電腦 / 平板置中小視窗,手機底部面板。
 */
export const DayDetailDialog = ({
  date,
  entries,
  isDayOff,
  onClose,
}: DayDetailDialogProps) => {
  const t = useTranslations("admin.schedule.mySchedule.detail");
  const text = useMyEntryText();
  const isMobile = useBreakpointDown("sm");
  const makeup = useMakeupPunchLink();
  const title = t("title", { date: text.dateTitle(date) });
  const missingEntry = entries.find(
    (entry) => entry.missing.length > 0 && makeup?.isPending(entry.id) !== true,
  );
  const applyButton =
    makeup !== null && missingEntry !== undefined ? (
      <Button
        fullWidth={isMobile}
        onClick={() => {
          makeup.open(missingEntry);
        }}
      >
        {t("apply")}
      </Button>
    ) : null;
  const body = (
    <Stack spacing={2.5}>
      {entries.length === 0 && (
        <Typography variant="body2" color="textSecondary">
          {isDayOff ? t("dayOff") : t("none")}
        </Typography>
      )}
      {entries.map((entry) => (
        <EntryDetail key={entry.id} entry={entry} />
      ))}
    </Stack>
  );

  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open
        title={title}
        closeLabel={t("close")}
        onClose={onClose}
      >
        <Stack spacing={2} sx={{ px: 2, pb: 2 }}>
          {body}
          {applyButton}
        </Stack>
      </Drawer>
    );
  }
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={title}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("close")}
          </Button>
          {applyButton}
        </>
      }
    >
      {body}
    </Dialog>
  );
};
