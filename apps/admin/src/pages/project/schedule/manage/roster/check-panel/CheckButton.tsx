import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { CheckIcon } from "@repo/ui/icons";

import { useRosterCheck } from "./roster-check-context";

/**
 * 工具列第二列最右邊的檢核按鈕(規格 14.5):「限制 1 · 提醒 3」,有限制紅色、只有提醒橘色;
 * 沒有問題時是灰色的勾。點一下展開 / 收合檢核面板。
 */
export const CheckButton = () => {
  const t = useTranslations("admin.schedule.roster.check");
  const { check, isOpen, setOpen } = useRosterCheck();
  if (check === undefined) {
    return null;
  }
  const isClear = check.limitCount === 0 && check.reminderCount === 0;
  const toggle = () => {
    setOpen(!isOpen);
  };
  if (isClear) {
    return (
      <Button
        variant="outlined"
        color="inherit"
        size="small"
        aria-label={t("buttonClear")}
        aria-pressed={isOpen}
        onClick={toggle}
        sx={{ minWidth: 0, color: "text.disabled" }}
      >
        <CheckIcon fontSize="small" />
      </Button>
    );
  }
  return (
    <Button
      variant="outlined"
      size="small"
      color={check.limitCount > 0 ? "error" : "warning"}
      aria-pressed={isOpen}
      onClick={toggle}
    >
      {t("button", {
        limit: check.limitCount,
        reminder: check.reminderCount,
      })}
    </Button>
  );
};
