import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import { useLotteryRedemptionQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText } from "../store-text";
import type { RedemptionRow } from "./redemption-shared";

export interface RedemptionDetailDialogProps {
  id: string;
  /**
   * 已經讀到的那一筆(進貨單的兌獎區 / 檢視頁:讀取依據是讀得到那張進貨單,不另查 `lotteryRedemption`,
   * 那要店面管理的 `store.view`);不給 = 依 `id` 讀
   */
  item?: RedemptionRow;
  onClose: () => void;
  /** [撤銷兌獎](依 `revokeMode` 開自己撤銷或店長撤銷的視窗);不給 = 這個入口不能撤銷 */
  onRevoke?: (row: RedemptionRow) => void;
}

const Line = ({ label, value }: { label: string; value: ReactNode }) => (
  <Stack
    direction="row"
    spacing={2}
    sx={{ justifyContent: "space-between", alignItems: "baseline" }}
  >
    <Typography variant="body2" color="textSecondary">
      {label}
    </Typography>
    <Typography color="textPrimary" sx={{ textAlign: "right" }}>
      {value}
    </Typography>
  </Stack>
);

/**
 * 兌獎紀錄詳情(規格 6.5;Figma ST-39a / ST-39c):標題列右側是單號(`RD-0218`;舊資料沒有 → 「—」),
 * 內容 刮刮樂、獎金、收銀點 / 班(已交班)、登記、狀態;已撤銷另列撤銷人與原因。[撤銷兌獎] 只在操作者能撤銷時出現(`revokeMode`,沒有權限不顯示);
 * 已送兌 → 按鈕停用、提示先撤回或退回進貨單。各入口(兌獎紀錄分頁、[最近兌獎]、進貨單的兌獎區與檢視頁)共用;
 * 進貨單的入口傳入已讀到的那一筆(`item`),不能撤銷。
 */
export const RedemptionDetailDialog = ({
  id,
  item,
  onClose,
  onRevoke,
}: RedemptionDetailDialogProps) => {
  const t = useTranslations("admin.lotteryStore.redemption");
  const { session } = useSession();
  const temporal = useTemporalText();
  const isMobile = useBreakpointDown("sm");
  const query = useLotteryRedemptionQuery(
    session.client,
    { id },
    { enabled: item === undefined },
  );
  const row = item ?? query.data?.lotteryRedemption.item ?? null;
  const serial = row?.purchase?.serialNo ?? "—";

  const statusText = (item: RedemptionRow): string =>
    item.status === "sent"
      ? t("sentValue", { serial })
      : t(`status.${item.status}`);

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
      title={
        <Stack
          component="span"
          direction="row"
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: "baseline" }}
        >
          <span>{t("detailTitle")}</span>
          {row === null ? null : (
            <Typography component="span" variant="body2" color="textSecondary">
              {row.serialNo ?? "—"}
            </Typography>
          )}
        </Stack>
      }
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("close")}
          </Button>
          {row?.revokeMode == null || onRevoke === undefined ? null : (
            <Button
              color="error"
              variant="outlined"
              disabled={row.revokeBlockedBySent}
              onClick={() => {
                onRevoke(row);
              }}
            >
              {t("revokeRedemption")}
            </Button>
          )}
        </>
      }
    >
      {row === null ? null : (
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Line
            label={t("detail.ticket")}
            value={t("ticketValue", {
              game:
                row.gameName == null
                  ? row.gameCode
                  : `${row.gameCode} ${row.gameName}`,
              bookNo: displayBookNo(row.bookNo),
              ticketNo: row.ticketNo,
            })}
          />
          <Line
            label={t("detail.prize")}
            value={t("money", { amount: moneyText(row.prizeAmount) })}
          />
          <Line
            label={t("detail.shift")}
            value={t(row.shift.closed ? "shiftClosed" : "shiftValue", {
              cashPoint: row.cashPoint.name,
              name: row.shift.openedBy.name,
              time: temporal(row.shift.openedAt, "monthDayTime"),
            })}
          />
          <Line
            label={t("detail.redeemed")}
            value={t("personTime", {
              name: row.redeemedBy.name,
              time: temporal(row.redeemedAt, "monthDayTime"),
            })}
          />
          <Line
            label={t("detail.status")}
            value={
              row.isPostClose
                ? `${statusText(row)} · ${t("postClose")}`
                : statusText(row)
            }
          />
          {row.revokedAt == null ? null : (
            <>
              <Line
                label={t("detail.revoked")}
                value={t("personTime", {
                  name: row.revokedBy?.name ?? "",
                  time: temporal(row.revokedAt, "monthDayTime"),
                })}
              />
              <Line
                label={t("detail.reason")}
                value={[row.revokeReason ?? t("immediate"), row.revokeNote]
                  .filter((part) => part != null && part !== "")
                  .join(" · ")}
              />
            </>
          )}
          {row.revokeMode != null && row.revokeBlockedBySent ? (
            <Alert severity="warning">{t("sentBlocked", { serial })}</Alert>
          ) : null}
        </Stack>
      )}
    </Dialog>
  );
};
