import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMakeupPunchLink } from "./makeup-punch";
import { type MyEntry, useMyEntryText } from "./useMyEntryText";

/**
 * 打卡不完整提醒(SC-01 頂部;規格 14.6):最近 7 天已結束、缺上班或下班卡的班,一班一列,
 * 每列附 [申請補卡](帶入日期、分店、類型、對應排班);已送出的顯示「補卡審核中」。不能手動關閉。
 */
export const IncompletePunchAlert = ({
  entries,
}: {
  entries: readonly MyEntry[];
}) => {
  const t = useTranslations("admin.schedule.mySchedule.incomplete");
  const text = useMyEntryText();
  const makeup = useMakeupPunchLink();
  if (entries.length === 0) {
    return null;
  }
  return (
    <Alert severity="warning" data-incomplete-punches>
      <Stack spacing={0.75}>
        <Typography variant="subtitle2">
          {t("title", { count: entries.length })}
        </Typography>
        {entries.map((entry) => (
          <Stack
            key={entry.id}
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="body2">
              {t("row", {
                date: text.dateTitle(entry.date),
                org: entry.orgName,
                time: `${text.shortName(entry)} ${text.time(entry)}`,
              })}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {text.missing(entry)}
            </Typography>
            {makeup !== null &&
              (makeup.isPending(entry.id) ? (
                <Typography variant="caption" color="textSecondary">
                  {t("pending")}
                </Typography>
              ) : (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => {
                    makeup.open({
                      date: entry.date,
                      orgId: entry.orgId,
                      type: entry.missing.includes("in") ? "in" : "out",
                      entryId: entry.id,
                    });
                  }}
                >
                  {t("apply")}
                </Button>
              ))}
          </Stack>
        ))}
      </Stack>
    </Alert>
  );
};
