import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_REASONS,
  STORE_KEY,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";
import {
  useEndLotteryStocktakeSessionMutation,
  useLotteryStocktakeSessionsQuery,
  useLotteryStocktakeStatusQuery,
  useStartLotteryStocktakeSessionMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { RescanEnterNotice } from "../rescan/RescanEnterNotice";
import { type RescanBrief, rescansToNotice } from "../rescan/rescan-model";
import { RenumberNotices } from "./RenumberNotices";
import { ResumeSessionDialog } from "./StocktakeSessionNotices";
import { useBlockedText, useSessionPlaceText } from "./session-text";
import {
  type StocktakeSessionView,
  sessionFailureOf,
} from "./useStocktakeSession";

export interface StocktakeEntry {
  /** 頂部 [盤點](沒有 `store.stocktake` = null) */
  button: ReactNode;
  /** 距離上次盤點超過 24 小時的提醒;全店盤點中(各台不能交班) */
  reminder: ReactNode;
  /** 盤點範圍視窗、被擋 / 接續 / 結束這個盤點的視窗 */
  element: ReactNode;
  /** 全店盤點中:[交班結帳] 停用(張數店規格 8.5a;Figma ST-01-2) */
  blocksCheckout: boolean;
}

/**
 * 看板的盤點入口(規格 6.1、6.2、6.8;Figma ST-01、ST-16;盤點中登記 ST-13-2b~d、ST-01-2):頂部 [盤點](`store.stocktake`)
 * → 選範圍(全店 / 單一收銀點)→ **先登記盤點中**(張數店規格 8.5a)→ 盤點頁(盤點確認申請的新增頁,`?org=` `?scope=` `?session=`)。
 * 被擋 → 「不能開始盤點」(誰、幾點開始、剩幾分鐘;店長 [結束這個盤點]);自己有一個進行中的臨時盤點 → [繼續] [放棄];
 * 全店盤點中 → 頂部提示、[交班結帳] 停用。距離上次盤點超過 24 小時提醒「建議盤點一次」。
 */
export const useStocktakeEntry = (
  orgId: string,
  cashPoints: readonly { id: string; name: string }[],
  /** 進行中的全店重刷:按 [開始盤點] 先跳 8.5a 的提醒(只提醒、不擋;Figma ST-16-2) */
  rescans: readonly RescanBrief[] = [],
): StocktakeEntry => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const { session } = useSession();
  const navigate = useNavigate();
  const temporal = useTemporalText();
  const blockedText = useBlockedText();
  const placeText = useSessionPlaceText();
  const { hasPermission } = usePermissions();
  const access = useFormModuleAccess(STORE_KEY);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"store" | "cashPoint">("store");
  const [cashPointId, setCashPointId] = useState("");
  const [blocked, setBlocked] = useState<StocktakeSessionView | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const status = useLotteryStocktakeStatusQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const sessions = useLotteryStocktakeSessionsQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const startSession = useStartLotteryStocktakeSessionMutation(session.client);
  const endSession = useEndLotteryStocktakeSessionMutation(session.client);
  const canStocktake =
    hasPermission(STORE_PERMISSIONS.stocktake) && access.createRoute !== null;
  const remind = status.data?.lotteryStocktakeStatus.remind === true;
  const items = sessions.data?.lotteryStocktakeSessions.items ?? [];
  const wholeStore = items.find((item) => item.wholeStore && item.live) ?? null;
  // 自己有一個進行中(或失效、被結束)的臨時盤點 → 先問 [繼續] [放棄](交班 / 日結在精靈裡問)
  const resumable = canStocktake
    ? (items.find(
        (item) =>
          item.mine && item.type === "adhoc" && item.sessionId !== dismissed,
      ) ?? null)
    : null;

  const goTo = (target: StocktakeSessionView) => {
    const params = new URLSearchParams({
      org: orgId,
      session: target.sessionId,
    });
    if (!target.wholeStore && target.cashPointId != null) {
      params.set("scope", target.cashPointId);
    }
    // 補點編號(張數店規格 9.3):接續時回到補點編號的盤點頁
    params.set("purpose", target.purpose);
    void navigate(
      `${access.createRoute ?? ""}/${STOCKTAKE_CONFIRM_FORM_KEY}?${params.toString()}`,
    );
  };
  const start = () => {
    setFailed(false);
    startSession.mutate(
      {
        input: {
          orgId,
          type: "adhoc",
          cashPointId:
            mode === "cashPoint" && cashPointId !== "" ? cashPointId : null,
        },
      },
      {
        onSuccess: (data) => {
          setOpen(false);
          goTo(data.startLotteryStocktakeSession);
        },
        onError: (error) => {
          const failure = sessionFailureOf(error);
          setOpen(false);
          if (failure.reason === STOCKTAKE_REASONS.sessionOwn) {
            setDismissed(null);
            void sessions.refetch();
          } else if (failure.session === null) {
            setFailed(true);
          } else {
            setBlocked(failure.session);
          }
        },
      },
    );
  };
  const end = (target: StocktakeSessionView) =>
    endSession
      .mutateAsync({ input: { orgId, sessionId: target.sessionId } })
      .then(() => sessions.refetch());

  const rescanNotices = rescansToNotice(
    rescans,
    mode === "cashPoint" && cashPointId !== "" ? cashPointId : null,
  );

  const startedText = (target: StocktakeSessionView) =>
    temporal(target.startedAt, "monthDayTime").split(" ").at(-1) ?? "";

  return {
    button: canStocktake ? (
      <Button
        variant="outlined"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t("entry.button")}
      </Button>
    ) : null,
    reminder: (
      <>
        {wholeStore === null ? null : (
          <Alert severity="warning">
            {t("session.wholeStoreBlocksCheckout", {
              name: wholeStore.byName,
              time: startedText(wholeStore),
            })}
          </Alert>
        )}
        {remind ? (
          <Alert severity="warning">{t("entry.reminder")}</Alert>
        ) : null}
        <RenumberNotices orgId={orgId} />
      </>
    ),
    blocksCheckout: wholeStore !== null,
    element: (
      <>
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          fullWidth
          maxWidth="xs"
          title={t("scope.title")}
          actions={
            <>
              <Button
                variant="text"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t("scope.cancel")}
              </Button>
              <Button
                variant="contained"
                disabled={
                  (mode === "cashPoint" && cashPointId === "") ||
                  startSession.isPending
                }
                onClick={() => {
                  if (rescanNotices.length > 0) {
                    setOpen(false);
                    setNoticeOpen(true);
                  } else {
                    start();
                  }
                }}
              >
                {t("scope.start")}
              </Button>
            </>
          }
        >
          <Stack spacing={2}>
            <RadioGroup
              aria-label={t("scope.title")}
              value={mode}
              onChange={(event) => {
                setMode(
                  event.target.value === "cashPoint" ? "cashPoint" : "store",
                );
              }}
            >
              <FormControlLabel
                value="store"
                control={<Radio />}
                label={t("scope.store")}
              />
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <FormControlLabel
                  value="cashPoint"
                  control={<Radio />}
                  label={t("scope.cashPoint")}
                />
                <SelectField
                  label={t("scope.cashPointLabel")}
                  size="small"
                  value={cashPointId}
                  disabled={mode !== "cashPoint"}
                  options={cashPoints.map((point) => ({
                    value: point.id,
                    label: point.name,
                  }))}
                  onChange={(next: string) => {
                    setCashPointId(next);
                  }}
                  sx={{ minWidth: 160 }}
                />
              </Stack>
            </RadioGroup>
            <Typography variant="body2" color="textSecondary">
              {t("scope.hint")}
            </Typography>
            {failed ? (
              <Alert severity="error">{t("session.startFailed")}</Alert>
            ) : null}
          </Stack>
        </Dialog>
        {/* ST-16-2 全店重刷進行中的提醒(只提醒、不擋) */}
        <RescanEnterNotice
          notices={rescanNotices}
          open={noticeOpen}
          onCancel={() => {
            setNoticeOpen(false);
          }}
          onContinue={() => {
            setNoticeOpen(false);
            start();
          }}
        />
        {/* ST-13-2c 不能開始盤點 */}
        <Dialog
          open={blocked !== null && !confirmEnd}
          onClose={() => {
            setBlocked(null);
          }}
          fullWidth
          maxWidth="xs"
          title={t("session.blockedTitle")}
          actions={
            <>
              <Button
                variant="text"
                onClick={() => {
                  setBlocked(null);
                }}
              >
                {t("session.gotIt")}
              </Button>
              {blocked?.canEnd === true ? (
                <Button
                  variant="contained"
                  color="error"
                  onClick={() => {
                    setConfirmEnd(true);
                  }}
                >
                  {t("session.end")}
                </Button>
              ) : null}
            </>
          }
        >
          <Typography variant="body2">
            {blocked === null ? "" : blockedText(blocked)}
          </Typography>
        </Dialog>
        {/* ST-13-2d 結束這個盤點?(店長;留紀錄) */}
        <Dialog
          open={blocked !== null && confirmEnd}
          onClose={() => {
            setConfirmEnd(false);
          }}
          fullWidth
          maxWidth="xs"
          title={t("session.endTitle", { name: blocked?.byName ?? "" })}
          actions={
            <>
              <Button
                variant="text"
                onClick={() => {
                  setConfirmEnd(false);
                }}
              >
                {t("session.cancel")}
              </Button>
              <Button
                variant="contained"
                color="error"
                disabled={endSession.isPending}
                onClick={() => {
                  if (blocked !== null) {
                    void end(blocked).then(() => {
                      setBlocked(null);
                      setConfirmEnd(false);
                    });
                  }
                }}
              >
                {t("session.end")}
              </Button>
            </>
          }
        >
          <Typography variant="body2">
            {t("session.endBody", {
              place: blocked === null ? "" : placeText(blocked),
              name: blocked?.byName ?? "",
            })}
          </Typography>
        </Dialog>
        {/* ST-13-2b 你有一個進行中的盤點 */}
        <ResumeSessionDialog
          session={resumable}
          isPending={endSession.isPending}
          onResume={goTo}
          onAbandon={(target) => {
            setDismissed(target.sessionId);
            void end(target);
          }}
        />
      </>
    ),
  };
};
