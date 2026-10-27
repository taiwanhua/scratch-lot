import { type MouseEvent, useState } from "react";
import { useTranslations } from "use-intl";

import { SCHEDULE_ROSTER_STAT_COLUMNS } from "@repo/domain/project/schedule-settings";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SettingsIcon } from "@repo/ui/icons";
import { Popover } from "@repo/ui/popover";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useRosterColumns } from "@/hooks/project/schedule/useRosterColumns/useRosterColumns";

/**
 * 班表檢視的 [⚙ 顯示欄位](SC-47;規格 14.5):勾選統計欄要顯示哪幾欄。存個人偏好
 * (跟著帳號,換一台裝置登入也一樣);只在班表檢視出現、沒有權限控管。
 */
export const RosterColumnPicker = () => {
  const t = useTranslations("admin.schedule.roster");
  const { columns, setColumns } = useRosterColumns();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button
        variant="text"
        size="small"
        startIcon={<SettingsIcon />}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(event: MouseEvent<HTMLElement>) => {
          setAnchor(event.currentTarget);
        }}
      >
        {t("columnPicker.button")}
      </Button>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Stack spacing={0.5} sx={{ p: 2, minWidth: 220 }}>
          <Typography variant="subtitle2">{t("columnPicker.title")}</Typography>
          {SCHEDULE_ROSTER_STAT_COLUMNS.map((column) => (
            <FormControlLabel
              key={column}
              label={t(`columnPicker.options.${column}`)}
              control={
                <Checkbox
                  checked={columns.includes(column)}
                  onChange={(event) => {
                    setColumns(
                      event.target.checked
                        ? [...columns, column]
                        : columns.filter((item) => item !== column),
                    );
                  }}
                />
              }
            />
          ))}
          <Typography variant="caption" color="textSecondary">
            {t("columnPicker.hint")}
          </Typography>
        </Stack>
      </Popover>
    </>
  );
};
