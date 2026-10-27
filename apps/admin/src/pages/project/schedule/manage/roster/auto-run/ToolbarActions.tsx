import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { MenuItem } from "@repo/ui/menu";
import { Tooltip } from "@repo/ui/tooltip";

import { useRosterCheck } from "../check-panel/roster-check-context";
import type { RosterToolbarActionProps } from "../roster-toolbar";
import { useAutoRunStatus } from "./auto-run-status";

/** 工具列對話框的 key(`roster-toolbar-dialogs.ts`)。 */
export const APPLY_TEMPLATES_DIALOG = "apply-templates";
export const AUTO_RUN_DIALOG = "auto-run";

/**
 * 工具列的 [套用範本](規格 14.4;要 `schedule.manage.edit`,權限由工具列依登記過濾,
 * 另看 api 的 `canEdit`):打開右側抽屜(手機全螢幕)。這個月還沒有人力需求的畫面也放它。
 */
export const ApplyTemplatesAction = ({
  variant,
  onDone,
}: RosterToolbarActionProps) => {
  const t = useTranslations("admin.schedule.roster.applyTemplates");
  const { data, openDialog } = useRosterCheck();
  if (data?.canEdit !== true) {
    return null;
  }
  const open = () => {
    onDone();
    openDialog(APPLY_TEMPLATES_DIALOG);
  };
  return variant === "menu" ? (
    <MenuItem onClick={open}>{t("button")}</MenuItem>
  ) : (
    <Button variant="outlined" size="small" onClick={open}>
      {t("button")}
    </Button>
  );
};

/**
 * 工具列的 [自動排班](規格 14.5;要 `schedule.manage.auto-run`):已發布的月份不顯示;
 * 別人的自動排班執行中 → 停用並提示「自動排班執行中」。
 */
export const AutoRunAction = ({
  variant,
  onDone,
}: RosterToolbarActionProps) => {
  const t = useTranslations("admin.schedule.roster.autoRun");
  const { data, openDialog } = useRosterCheck();
  const status = useAutoRunStatus();
  if (
    data === undefined ||
    data.period.status === "published" ||
    status?.canAutoRun !== true
  ) {
    return null;
  }
  const open = () => {
    onDone();
    openDialog(AUTO_RUN_DIALOG);
  };
  const label = status.running ? t("running") : t("button");
  if (variant === "menu") {
    return (
      <MenuItem disabled={status.running} onClick={open}>
        {label}
      </MenuItem>
    );
  }
  const button = (
    <Button
      variant="outlined"
      size="small"
      disabled={status.running}
      onClick={open}
    >
      {label}
    </Button>
  );
  return status.running ? (
    <Tooltip title={t("runningHint")}>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
  );
};
