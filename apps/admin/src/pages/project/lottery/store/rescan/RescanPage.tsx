import { useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, type ReactNode, useState } from "react";

import {
  STORE_BOARD_KEY,
  STORE_RESCAN_SCAN_PURPOSE,
} from "@repo/domain/project/lottery";
import {
  type LotteryRescanQuery,
  useCancelLotteryRescanMutation,
  useFinishLotteryRescanPlaceMutation,
  useLotteryRescanQuery,
  useScanLotteryRescanTicketMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useRealtimeBoard } from "@/hooks/base/useRealtime";
import { useScanner } from "@/hooks/base/useScanner/useScanner";
import { useSession } from "@/hooks/base/useSession";
import { readLocalCashPoint } from "@/lib/project/lottery/local-cash-point";

import { CameraScanDialog } from "../BoardTab/sales/CameraScanDialog";
import {
  RescanPlacesCard,
  RescanScanCard,
  RescanSummaryCard,
} from "./RescanPanels";
import { type RescanView, placeKeyOf } from "./rescan-model";
import { useRescanLabels } from "./useRescanLabels";
import { useRescanText } from "./useRescanText";

export interface RescanPageProps {
  orgId: string;
  rescanId: string;
  /** [回到看板] */
  onLeave: () => void;
}

/** 現在刷哪個位置的預設:本機收銀點 → 自己刷到一半的 → 第一個還沒刷完的(庫存 = 空字串)。 */
const defaultPlaceOf = (rescan: RescanView, local: string | null): string => {
  const open = rescan.places.filter((place) => place.state !== "done");
  const found =
    open.find((place) => place.cashPointId === local) ??
    open.find((place) => place.mine) ??
    open.at(0);
  return placeKeyOf(found?.cashPointId);
};

/** 上方的說明:進行中(已刷幾個位置、剩幾分鐘)/ 完成 / 取消(含 1 小時自動取消)。 */
const useBanner = (rescan: RescanView) => {
  const { t, clock } = useRescanText();
  const total = rescan.places.length;
  if (rescan.status === "in_progress") {
    return {
      severity: "info" as const,
      text: t("page.info", {
        done: rescan.doneCount,
        total,
        name: rescan.startedByName,
        time: clock(rescan.startedAt),
        minutes: rescan.minutesLeft,
        code: rescan.gameCode,
      }),
    };
  }
  if (rescan.status === "finished") {
    return {
      severity: "success" as const,
      text: t("done.info", {
        done: rescan.doneCount,
        total,
        time: rescan.finishedAt == null ? "" : clock(rescan.finishedAt),
        code: rescan.gameCode,
      }),
    };
  }
  return {
    severity: "warning" as const,
    text:
      rescan.cancelCause === "expired"
        ? t("done.expired", { code: rescan.gameCode })
        : t("done.cancelled", { code: rescan.gameCode }),
  };
};

type ScanCardProps = ComponentProps<typeof RescanScanCard>;

interface RescanBodyProps {
  rescan: RescanView;
  orgId: string;
  local: string | null;
  onLeave: () => void;
  header: ReactNode;
  scan: Omit<ScanCardProps, "orgId" | "rescan" | "labels" | "current"> & {
    current: ScanCardProps["current"] | null;
  };
  children: ReactNode;
}

/** 頁首、說明、左右兩欄(進行中:刷;結束:結果摘要)。 */
const RescanBody = ({
  rescan,
  orgId,
  local,
  onLeave,
  header,
  scan,
  children,
}: RescanBodyProps) => {
  const labels = useRescanLabels(rescan, local);
  const banner = useBanner(rescan);
  const { current, ...scanProps } = scan;
  let right: ReactNode = null;
  if (rescan.status !== "in_progress") {
    right = (
      <RescanSummaryCard
        orgId={orgId}
        rescan={rescan}
        labels={labels}
        onLeave={onLeave}
      />
    );
  } else if (current !== null) {
    right = (
      <RescanScanCard
        orgId={orgId}
        rescan={rescan}
        labels={labels}
        current={current}
        {...scanProps}
      />
    );
  }
  return (
    <Stack spacing={2}>
      {header}
      <Alert severity={banner.severity}>{banner.text}</Alert>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "320px 1fr" },
          alignItems: "start",
        }}
      >
        <RescanPlacesCard rescan={rescan} labels={labels} />
        {right}
      </Box>
      {children}
    </Stack>
  );
};

/**
 * 全店重刷頁(張數店規格 8.4、13.1;Figma CS-10b / 10c / 10d,電腦、平板、手機):頁首「全店重刷 · 遊戲」、誰幾點開始、
 * [取消重刷](開始的人或店長);上方說明已刷幾個位置、剩幾分鐘自動取消;左邊各位置的狀態;右邊「現在刷哪個位置」
 * (預設本機收銀點,任何裝置都能刷任何位置)、刷條碼 / 相機 / 手輸張號,刷到的每張即時列出結果(按 [這裡刷完了] 才寫進帳本);
 * 全部位置刷完 → 結果摘要。開著時宣告掃描用途 `store-rescan`;看板信號(別人刷完、取消)到了重抓。
 */
export const RescanPage = ({ orgId, rescanId, onLeave }: RescanPageProps) => {
  const { t, gameOf, clock, errorText } = useRescanText();
  const { session } = useSession();
  const queryClient = useQueryClient();
  useRealtimeBoard(STORE_BOARD_KEY, orgId === "" ? null : orgId);
  const variables = { input: { orgId, rescanId } };
  const query = useLotteryRescanQuery(session.client, variables, {
    enabled: orgId !== "" && rescanId !== "",
    retry: false,
  });
  const loaded = query.data?.lotteryRescan ?? null;
  const [chosen, setChosen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCamera, setIsCamera] = useState(false);
  const setRescan = (next: RescanView) => {
    queryClient.setQueryData<LotteryRescanQuery>(
      useLotteryRescanQuery.getKey(variables),
      { lotteryRescan: next },
    );
  };
  const scan = useScanLotteryRescanTicketMutation(session.client);
  const finish = useFinishLotteryRescanPlaceMutation(session.client);
  const cancel = useCancelLotteryRescanMutation(session.client);
  const local = readLocalCashPoint(orgId);
  const placeKey =
    chosen ?? (loaded === null ? "" : defaultPlaceOf(loaded, local));
  const current =
    loaded?.places.find(
      (place) => placeKeyOf(place.cashPointId) === placeKey,
    ) ?? null;
  const placeInput =
    current?.cashPointId == null ? {} : { cashPointId: current.cashPointId };
  const placeName =
    current?.cashPointId == null ? t("page.stock") : current.name;
  const gameCode = loaded?.gameCode ?? "";

  const add = (code: string) => {
    const trimmed = code.trim();
    if (trimmed === "" || current === null) {
      return;
    }
    scan.mutate(
      { input: { orgId, rescanId, code: trimmed, ...placeInput } },
      {
        onSuccess: (data) => {
          const payload = data.scanLotteryRescanTicket;
          setRescan(payload.rescan);
          setText("");
          setMessage(
            payload.duplicate
              ? t("errors.duplicate", { no: payload.item.ticketNo })
              : null,
          );
        },
        onError: (error) => {
          setMessage(errorText(error, gameCode));
        },
      },
    );
  };
  useScanner(STORE_RESCAN_SCAN_PURPOSE, ({ code }) => {
    setText(code);
    add(code);
  });

  if (query.isError) {
    return <Alert severity="error">{t("page.loadFailed")}</Alert>;
  }
  if (loaded === null) {
    return null;
  }
  return (
    <RescanBody
      rescan={loaded}
      orgId={orgId}
      local={local}
      onLeave={onLeave}
      header={
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "baseline", flexWrap: "wrap", rowGap: 0.5 }}
        >
          <Typography variant="h6" component="h1">
            {t("page.title", { game: gameOf(loaded) })}
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
            {t("page.started", {
              name: loaded.startedByName,
              time: clock(loaded.startedAt),
            })}
          </Typography>
          <Button
            variant="text"
            color={loaded.canCancel ? "error" : "primary"}
            onClick={() => {
              if (loaded.canCancel) {
                setIsCancelling(true);
              } else {
                onLeave();
              }
            }}
          >
            {loaded.canCancel ? t("page.cancel") : t("page.backToBoard")}
          </Button>
        </Stack>
      }
      scan={{
        current,
        placeKey,
        text,
        message,
        isScanning: scan.isPending,
        onPlace: (key) => {
          setChosen(key);
          setMessage(null);
        },
        onText: setText,
        onAdd: () => {
          add(text);
        },
        onCamera: () => {
          setIsCamera(true);
        },
        onFinish: () => {
          setIsFinishing(true);
        },
      }}
    >
      {/* CS-10c 這裡刷完了? */}
      <Dialog
        open={isFinishing && current !== null}
        onClose={() => {
          setIsFinishing(false);
        }}
        fullWidth
        maxWidth="xs"
        title={t("finish.title", {
          place: placeName,
          count: current?.scannedCount ?? 0,
        })}
        actions={
          <>
            <Button
              variant="text"
              onClick={() => {
                setIsFinishing(false);
              }}
            >
              {t("finish.continue")}
            </Button>
            <Button
              variant="contained"
              disabled={finish.isPending}
              onClick={() => {
                finish.mutate(
                  { input: { orgId, rescanId, ...placeInput } },
                  {
                    onSuccess: (data) => {
                      setRescan(data.finishLotteryRescanPlace);
                      setChosen(null);
                      setMessage(null);
                    },
                    onError: (error) => {
                      setMessage(errorText(error, gameCode));
                    },
                    onSettled: () => {
                      setIsFinishing(false);
                    },
                  },
                );
              }}
            >
              {t("finish.confirm")}
            </Button>
          </>
        }
      >
        <Typography variant="body2" color="textSecondary">
          {t("finish.body", { place: placeName, code: gameCode })}
        </Typography>
      </Dialog>
      {/* [取消重刷]? */}
      <Dialog
        open={isCancelling}
        onClose={() => {
          setIsCancelling(false);
        }}
        fullWidth
        maxWidth="xs"
        title={t("cancelDialog.title")}
        actions={
          <>
            <Button
              variant="text"
              onClick={() => {
                setIsCancelling(false);
              }}
            >
              {t("cancelDialog.keep")}
            </Button>
            <Button
              variant="contained"
              color="error"
              disabled={cancel.isPending}
              onClick={() => {
                cancel.mutate(variables, {
                  onSuccess: (data) => {
                    setRescan(data.cancelLotteryRescan);
                  },
                  onError: (error) => {
                    setMessage(errorText(error, gameCode));
                  },
                  onSettled: () => {
                    setIsCancelling(false);
                  },
                });
              }}
            >
              {t("cancelDialog.confirm")}
            </Button>
          </>
        }
      >
        <Typography variant="body2" color="textSecondary">
          {t("cancelDialog.body", { code: gameCode })}
        </Typography>
      </Dialog>
      {isCamera ? (
        <CameraScanDialog
          onClose={() => {
            setIsCamera(false);
          }}
        />
      ) : null}
    </RescanBody>
  );
};
