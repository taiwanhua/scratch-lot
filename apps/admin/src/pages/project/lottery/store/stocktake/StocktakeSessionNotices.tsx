import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { useBlockedText, useSessionScopeText } from "./session-text";
import type {
  StocktakeSessionLink,
  StocktakeSessionView,
} from "./useStocktakeSession";

export interface ResumeSessionDialogProps {
  session: StocktakeSessionView | null;
  isPending: boolean;
  onResume: (session: StocktakeSessionView) => void;
  onAbandon: (session: StocktakeSessionView) => void;
}

/**
 * 你有一個進行中的盤點 [放棄] [繼續](張數店規格 8.5a;Figma ST-13-2b、ST-17a-2b):重新整理、關掉瀏覽器或換裝置後回來,
 * [繼續] 回到原本的畫面(已數的組與 `countedAt` 都還在),[放棄] 解除這次盤點。
 */
export const ResumeSessionDialog = ({
  session,
  isPending,
  onResume,
  onAbandon,
}: ResumeSessionDialogProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.session");
  const temporal = useTemporalText();
  const scopeText = useSessionScopeText();
  if (session === null) {
    return null;
  }
  return (
    <Dialog
      open
      onClose={() => {
        // 一定要選一個(放棄或繼續)
      }}
      fullWidth
      maxWidth="xs"
      title={t("resumeTitle")}
      actions={
        <>
          <Button
            variant="text"
            disabled={isPending}
            onClick={() => {
              onAbandon(session);
            }}
          >
            {t("abandon")}
          </Button>
          <Button
            variant="contained"
            disabled={isPending}
            onClick={() => {
              onResume(session);
            }}
          >
            {t("resume")}
          </Button>
        </>
      }
    >
      <Typography variant="body2">
        {t("resumeBody", {
          scope: scopeText(session),
          time:
            temporal(session.startedAt, "monthDayTime").split(" ").at(-1) ?? "",
        })}
      </Typography>
    </Dialog>
  );
};

export interface StocktakeSessionNoticesProps {
  link: StocktakeSessionLink;
}

/**
 * 盤點頁上方的盤點中登記(張數店規格 8.5a;Figma ST-13-2a / 2c):
 * 登記中 → 「你從 10:05 開始盤點 · 剩 58 分鐘自動結束(有操作就重算)」;被別人擋住 → 誰、幾點開始、剩幾分鐘,
 * 店長看得到 [結束這個盤點];登記已解除(店長結束、失效後被別人接手)→ 提示進度保留、可重新進入後 [繼續]。
 */
export const StocktakeSessionNotices = ({
  link,
}: StocktakeSessionNoticesProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.session");
  const temporal = useTemporalText();
  const blockedText = useBlockedText();
  if (link.blocked !== null) {
    return (
      <Alert
        severity="warning"
        action={
          link.blocked.canEnd ? (
            <Button
              size="small"
              variant="text"
              color="error"
              disabled={link.isEnding}
              onClick={link.endBlocked}
            >
              {t("end")}
            </Button>
          ) : undefined
        }
      >
        {blockedText(link.blocked)}
      </Alert>
    );
  }
  if (link.ended) {
    return <Alert severity="warning">{t("ended")}</Alert>;
  }
  if (link.active === null) {
    return null;
  }
  return (
    <Alert severity="info">
      {t("active", {
        time:
          temporal(link.active.startedAt, "monthDayTime").split(" ").at(-1) ??
          "",
        minutes: link.minutesLeft,
      })}
    </Alert>
  );
};
