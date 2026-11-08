import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { LOTTERY_SETTINGS_KEY } from "@repo/domain/project/lottery-settings";
import type { LotteryPeriodCloseCheckQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";

import { CheckLine } from "./CheckLine";

type RenumberStore =
  LotteryPeriodCloseCheckQuery["lotteryPeriodCloseCheck"]["renumberStores"][number];

/**
 * 關帳檢查清單第四項「張數店月底補點編號」(張數店規格第 10 節;Figma AC-07-2a~c):
 * 通過 / 擋下(設「必須」的店:「B 店本月最後一次日結前沒補點編號」,附 [到刮刮樂設定] 帶入那家店)/
 * 警告(設「只提醒」的店)。只列月底是張數或轉換中的店;沒有這種店 = 通過。
 */
export const RenumberCheckLine = ({
  stores,
}: {
  stores: readonly RenumberStore[];
}) => {
  const t = useTranslations("admin.lotteryAccounts.periodClose");
  const navigate = useNavigate();
  const routeOf = useModuleRoutes();
  const settingsRoute = routeOf(LOTTERY_SETTINGS_KEY);
  const blocked = stores.filter((store) => store.status === "blocked");
  const warned = stores.filter((store) => store.status === "warning");
  const names = (list: readonly RenumberStore[]) =>
    list.map((store) => store.orgName).join(t("listSeparator"));
  const first = blocked.at(0);
  if (first !== undefined) {
    return (
      <CheckLine state="blocked">
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "baseline" } }}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t("renumber.blocked", { stores: names(blocked) })}
          </Typography>
          {settingsRoute === null ? null : (
            <Button
              size="small"
              variant="text"
              onClick={() => {
                void navigate(
                  `${settingsRoute}?${new URLSearchParams({ org: first.orgId }).toString()}`,
                );
              }}
            >
              {t("renumber.toSettings")}
            </Button>
          )}
        </Stack>
      </CheckLine>
    );
  }
  if (warned.length > 0) {
    return (
      <CheckLine state="warning">
        <Typography variant="body2">
          {t("renumber.warning", { stores: names(warned) })}
        </Typography>
      </CheckLine>
    );
  }
  return (
    <CheckLine state="ok">
      <Typography variant="body2">{t("renumber.pass")}</Typography>
    </CheckLine>
  );
};
