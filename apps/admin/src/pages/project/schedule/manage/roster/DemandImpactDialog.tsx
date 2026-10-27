import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { monthDayOf } from "@/lib/project/schedule-roster";

import type { RosterDemand, RosterEntry } from "./roster-context";

export interface DemandImpactDialogProps {
  /** `delete` = [刪除人力需求];`save` = 移除有人填的那一列後存檔 */
  mode: "delete" | "save";
  title: string;
  released: readonly RosterDemand["tasks"][number][];
  deleted: readonly RosterEntry[];
  blocked: readonly RosterEntry[];
  names: ReadonlyMap<string, string>;
  taskLabelOf: (taskKey: string) => string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 刪除人力需求 / 移除有人填的執行任務的確認(SC-21c;規格 14.5):列出會解除的人(「李小華 · 負責 · 店內事務與帳目負責」);
 * 照「排班至少要填進一筆」的原則,解除後變成零筆的排班另外列出、按鈕改成 [刪除人力需求並刪除這 N 筆排班];
 * 其中已被收銀班次綁定的擋下並列出(要先改那筆排班),確定鍵停用。手機也維持置中的小視窗。
 */
export const DemandImpactDialog = ({
  mode,
  title,
  released,
  deleted,
  blocked,
  names,
  taskLabelOf,
  isPending,
  onConfirm,
  onCancel,
}: DemandImpactDialogProps) => {
  const t = useTranslations("admin.schedule.roster.impact");
  const tCommon = useTranslations("admin.schedule.common");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const nameOf = (entry: RosterEntry) => names.get(entry.userId) ?? "";
  const withEntries = deleted.length > 0;
  const deleteLabel = withEntries
    ? t("deleteWithEntries", { count: deleted.length })
    : t("delete");
  const removeLabel = withEntries
    ? t("removeWithEntries", { count: deleted.length })
    : t("remove");
  const confirmLabel = mode === "delete" ? deleteLabel : removeLabel;
  return (
    <Dialog
      open
      maxWidth="xs"
      fullWidth
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button
            color="error"
            disabled={isPending || blocked.length > 0}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        {released.length > 0 && (
          <>
            <Typography variant="body2">{t("releasedTitle")}</Typography>
            <Box sx={{ bgcolor: "grey.50", borderRadius: 1, px: 1.5, py: 1 }}>
              {released.map((task) => (
                <Typography key={task.taskId} variant="body2">
                  {t("releasedLine", {
                    name: task.userName ?? "",
                    role: t(
                      `roles.${task.role === "leader" ? "leader" : "helper"}`,
                    ),
                    task: taskLabelOf(task.taskKey),
                  })}
                </Typography>
              ))}
            </Box>
          </>
        )}
        {deleted.map((entry) => (
          <Typography key={entry.id} variant="body2" color="textSecondary">
            {t("deletedLine", {
              name: nameOf(entry),
              date: monthDayOf(entry.date, timezone),
            })}
          </Typography>
        ))}
        {blocked.length > 0 && (
          <Alert severity="error">
            {t("blockedTitle")}
            {blocked.map((entry) => (
              <Box key={entry.id}>
                {t("blockedLine", {
                  name: nameOf(entry),
                  date: monthDayOf(entry.date, timezone),
                })}
              </Box>
            ))}
          </Alert>
        )}
        {mode === "delete" && released.length === 0 && (
          <Typography variant="body2">{t("deleteEmpty")}</Typography>
        )}
      </Stack>
    </Dialog>
  );
};
