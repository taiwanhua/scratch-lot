import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  STORE_BOARD_KEY,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";
import { useLotteryStoreBoardQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { CashPointHeaderAction } from "@/components/project/lottery/CashPointHeader/CashPointHeader";
import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useRealtimeBoard } from "@/hooks/base/useRealtime";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  readLocalCashPoint,
  writeLocalCashPoint,
} from "@/lib/project/lottery/local-cash-point";

import { type BoardDialog, BoardDialogs } from "./BoardDialogs";
import { BoardTopBar } from "./BoardTopBar";
import { type BoardCashPoint, CashPointSection } from "./CashPointSection";

const orgSchema = z.string().default("");

/**
 * 看板分頁(專案規格 6.1、6.2;Figma ST-01 / 02 / 03 / 34a/b/c):頂部(分店 `?org=`、本機收銀點、
 * 你開著的班、連線狀態)、每個收銀點一條標題列 + 檯面上的本。打開時訂閱 `board:<分店>`,
 * 信號到了重抓看板(`app/project/realtime-signals.ts`)。上次日結、[盤點] [存銀行] [日結]、
 * 距上次盤點的提醒、卡片展開與其他標題列按鈕由各自的功能加上。
 */
export const BoardTab = () => {
  const t = useTranslations("admin.lotteryStore");
  const { session } = useSession();
  const me = useMe();
  const { hasPermission } = usePermissions();
  const [orgParam, setOrgParam] = useUrlState("org", orgSchema);
  const orgId = orgParam === "" ? (me.data?.me.currentOrg?.id ?? "") : orgParam;
  useRealtimeBoard(STORE_BOARD_KEY, orgId === "" ? null : orgId);

  const query = useLotteryStoreBoardQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const board = query.data?.lotteryStoreBoard.item ?? null;
  const cashPoints = board?.cashPoints ?? [];

  // 這次在畫面上選的本機收銀點(依分店);沒選過 = 讀這台瀏覽器記住的
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const localId = chosen[orgId] ?? readLocalCashPoint(orgId);
  const local = cashPoints.find((point) => point.id === localId) ?? null;
  const [dialog, setDialog] = useState<BoardDialog | null>(null);

  const applyLocal = (cashPointId: string) => {
    writeLocalCashPoint(orgId, cashPointId);
    setChosen((current) => ({ ...current, [orgId]: cashPointId }));
  };
  /** 切換本機收銀點:目前的本機收銀點是自己開著的班 → 先確認。 */
  const requestSwitch = (to: BoardCashPoint) => {
    if (to.id === local?.id) {
      return;
    }
    if (local?.shift?.isMine === true) {
      setDialog({ kind: "switch", to });
      return;
    }
    applyLocal(to.id);
  };
  const switchById = (cashPointId: string) => {
    const target = cashPoints.find((point) => point.id === cashPointId);
    if (target !== undefined) {
      requestSwitch(target);
    }
  };

  /** 標題列的按鈕(依狀態、本機與否、權限;沒有權限不放)。 */
  const actionsOf = (point: BoardCashPoint): CashPointHeaderAction[] => {
    const shift = point.shift ?? null;
    if (shift === null) {
      return hasPermission(STORE_PERMISSIONS.openShift)
        ? [
            {
              key: "open-shift",
              label: t("header.openShift"),
              emphasis: "primary",
              onClick: () => {
                setDialog({ kind: "open", cashPoint: point });
              },
            },
          ]
        : [];
    }
    if (point.id !== local?.id) {
      return shift.isMine
        ? [
            {
              key: "switch",
              label: t("header.switchTo"),
              onClick: () => {
                requestSwitch(point);
              },
            },
          ]
        : [];
    }
    const cashAction = (kind: "deposit" | "withdraw") => ({
      key: kind,
      label: kind === "deposit" ? t("header.deposit") : t("header.withdraw"),
      onClick: () => {
        setDialog({ kind, shift, cashPointName: point.name });
      },
    });
    return [
      ...(hasPermission(STORE_PERMISSIONS.deposit)
        ? [cashAction("deposit")]
        : []),
      ...(hasPermission(STORE_PERMISSIONS.withdraw)
        ? [cashAction("withdraw")]
        : []),
    ];
  };

  return (
    <Stack spacing={2}>
      <BoardTopBar
        orgId={orgId}
        onOrgChange={setOrgParam}
        cashPoints={cashPoints}
        localId={local?.id ?? null}
        onLocalChange={switchById}
        myShiftNames={(board?.myOpenShifts ?? []).map(
          (shift) => shift.cashPoint.name,
        )}
      />
      {board !== null && local === null && cashPoints.length > 0 ? (
        <Alert
          severity="warning"
          action={
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setDialog({ kind: "local" });
              }}
            >
              {t("board.setLocal")}
            </Button>
          }
        >
          {t("board.noLocal")}
        </Alert>
      ) : null}
      {local !== null && local.shift == null ? (
        <Alert severity="info">
          {t("board.localNotOpen", { name: local.name })}
        </Alert>
      ) : null}
      {orgId === "" ? (
        <Typography color="text.secondary">{t("board.pickOrg")}</Typography>
      ) : null}
      {query.isError ? (
        <Alert severity="error">{t("board.loadFailed")}</Alert>
      ) : null}
      {board !== null && cashPoints.length === 0 ? (
        <Typography color="text.secondary">{t("board.noCashPoint")}</Typography>
      ) : null}
      {cashPoints.map((point) => (
        <CashPointSection
          key={point.id}
          point={point}
          isLocal={point.id === local?.id}
          actions={actionsOf(point)}
          onShiftInfo={(shiftId) => {
            setDialog({ kind: "info", shiftId });
          }}
        />
      ))}
      <BoardDialogs
        dialog={dialog}
        cashPoints={cashPoints}
        local={local}
        vaultExpected={board?.vaultExpected ?? 0}
        onClose={() => {
          setDialog(null);
        }}
        onPickLocal={(id) => {
          setDialog(null);
          switchById(id);
        }}
        onConfirmSwitch={(id) => {
          applyLocal(id);
          setDialog(null);
        }}
      />
    </Stack>
  );
};
