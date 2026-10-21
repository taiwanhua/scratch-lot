import { useTranslations } from "use-intl";

import type { LotteryPeriodSnapshotFieldsFragment } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../accounts-config";

const Line = ({ label, value }: { label: string; value: string }) => (
  <Stack
    direction="row"
    spacing={2}
    sx={{ justifyContent: "space-between", alignItems: "baseline" }}
  >
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
      {value}
    </Typography>
  </Stack>
);

/**
 * 關帳快照(Figma AC-07「快照預覽」):每個帳戶月底餘額;每家分店 小金庫 / 抽屜;沒有被日結涵蓋計算的班數;
 * 月底跨月的班(抽屜不計)另列一行。關帳彈窗與 [快照] 共用。
 */
export const PeriodSnapshotList = ({
  snapshot,
  title,
}: {
  snapshot: LotteryPeriodSnapshotFieldsFragment;
  title: string;
}) => {
  const t = useTranslations("admin.lotteryAccounts.periodClose.dialog");
  return (
    <Box
      component="section"
      aria-label={title}
      sx={{ bgcolor: "action.hover", borderRadius: 2, p: 2 }}
    >
      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Stack spacing={1}>
        {snapshot.bankAccounts.map((account) => (
          <Line
            key={account.accountId}
            label={t("bankBalance", { label: account.label })}
            value={moneyText(account.balance)}
          />
        ))}
        {snapshot.stores.map((store) => (
          <Stack key={store.orgId} spacing={1}>
            <Line
              label={t("storeCash", { store: store.name })}
              value={t("storeCashValue", {
                vault: moneyText(store.vault),
                drawers: moneyText(store.drawerTotal),
              })}
            />
            {store.drawers
              .filter((drawer) => drawer.spanningShiftLabel != null)
              .map((drawer) => (
                <Typography
                  key={drawer.cashPointId}
                  variant="caption"
                  color="text.secondary"
                >
                  {t("spanning", {
                    store: store.name,
                    cashPoint: drawer.name,
                    shift: drawer.spanningShiftLabel ?? "",
                  })}
                </Typography>
              ))}
            {store.uncoveredShifts.length > 0 && (
              <Line
                label={t("uncovered", { store: store.name })}
                value={t("uncoveredValue", {
                  count: store.uncoveredShifts.length,
                })}
              />
            )}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
};
