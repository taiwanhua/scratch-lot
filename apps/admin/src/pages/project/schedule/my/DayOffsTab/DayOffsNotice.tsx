import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";

export interface DayOffsNoticeProps {
  /** 早於目標月 = 過去的月份(只能看) */
  isPast: boolean;
  /** 開放期間的狀態(`open` / `closed` / `before`) */
  state: string;
  /** 開放期間(`M/D`) */
  range: { start: string; end: string };
  /** 「到畫休總覽代改」要去的網址;沒有代改權限 = null */
  overrideHref: string | null;
}

/**
 * 我的畫休頂部的提示(規格 14.6):過去的月份只說「只能查看」、沒有連結;
 * 目標月在開放期間外提示不能自己修改,有代改權限的人另有「到畫休總覽代改」;開放中不顯示。
 */
export const DayOffsNotice = ({
  isPast,
  state,
  range,
  overrideHref,
}: DayOffsNoticeProps) => {
  const t = useTranslations("admin.schedule.dayOffs");
  const navigate = useNavigate();
  if (isPast) {
    return <Alert severity="warning">{t("my.pastNotice")}</Alert>;
  }
  if (state === "open") {
    return null;
  }
  return (
    <Stack spacing={1}>
      <Alert severity="warning">
        {t(state === "closed" ? "my.closedNotice" : "my.beforeNotice", range)}
      </Alert>
      {overrideHref !== null && (
        <Button
          variant="text"
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => {
            void navigate(overrideHref);
          }}
        >
          {t("my.overrideLink")}
        </Button>
      )}
    </Stack>
  );
};
