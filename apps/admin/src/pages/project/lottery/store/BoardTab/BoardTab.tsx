import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  STORE_BOARD_KEY,
  STORE_KEY,
  STORE_PERMISSIONS,
  STORE_SALE_SCAN_PURPOSE,
} from "@repo/domain/project/lottery";
import { useLotteryStoreBoardQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import type { CashPointHeaderAction } from "@/components/project/lottery/CashPointHeader/CashPointHeader";
import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useRealtimeBoard } from "@/hooks/base/useRealtime";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { useScanner } from "@/hooks/project/useScanner/useScanner";
import {
  readLocalCashPoint,
  writeLocalCashPoint,
} from "@/lib/project/lottery/local-cash-point";

import {
  CHECKOUT_CONFIRM_FORM_KEY,
  CHECKOUT_PREFILL,
} from "../checkout/checkout-keys";
import { useDailyCloseEntry } from "../daily-close/useDailyCloseEntry";
import { storeFormCreateHref } from "../forms/store-forms-keys";
import { redemptionBoardActions } from "../redemption/redemption-board-actions";
import { useRedemptionFlow } from "../redemption/useRedemptionFlow";
import { useStocktakeEntry } from "../stocktake/useStocktakeEntry";
import { type BoardDialog, BoardDialogs } from "./BoardDialogs";
import { BoardTopBar } from "./BoardTopBar";
import { type BoardCashPoint, CashPointSection } from "./CashPointSection";
import { CameraScanButton } from "./sales/CameraScanButton";
import { ExpandedBookCard } from "./sales/ExpandedBookCard";
import { SalesBoardDialogs, type SalesDialog } from "./sales/SalesBoardDialogs";
import { useStoreSaleFlow } from "./sales/useStoreSaleFlow";

const orgSchema = z.string().default("");

/**
 * 看板分頁(專案規格 6.1、6.2;Figma ST-01 / 02 / 03 / 34a/b/c):頂部(分店 `?org=`、本機收銀點、
 * 你開著的班、連線狀態)、每個收銀點一條標題列 + 檯面上的本。打開時訂閱 `board:<分店>`,
 * 信號到了重抓看板(`app/project/realtime-signals.ts`)。銷售(規格 6.2–6.4):宣告掃描用途 `store-sale`
 * (刷條碼 / 相機 → `useStoreSaleFlow`)、點卡片原地展開、[最近售出] [拆本]。頂部的 [盤點](`useStocktakeEntry`)、
 * 上次日結與 [存銀行] [日結](`useDailyCloseEntry`)、距上次盤點的提醒與其他標題列按鈕由各自的功能加上。
 */
export const BoardTab = () => {
  const t = useTranslations("admin.lotteryStore");
  const { session } = useSession();
  const me = useMe();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const access = useFormModuleAccess(STORE_KEY);
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
  // 銷售(規格 6.2–6.4):展開的卡片(一次一張)、刷到時閃的那一格、拆本 / 最近售出 / 相機的視窗
  const [expanded, setExpanded] = useState<{
    pointId: string;
    bookId: string;
  } | null>(null);
  const [flash, setFlash] = useState<{
    bookId: string;
    ticketNo: string;
    nonce: number;
  } | null>(null);
  const [salesDialog, setSalesDialog] = useState<SalesDialog | null>(null);
  const localOpen = local?.shift == null ? null : local;
  const flow = useStoreSaleFlow({
    orgId,
    local:
      localOpen === null ? null : { id: localOpen.id, name: localOpen.name },
    mode: "board",
    onScanned: (item) => {
      setFlash((current) => ({
        bookId: item.bookId,
        ticketNo: item.ticketNo,
        nonce: (current?.nonce ?? 0) + 1,
      }));
    },
  });
  useScanner(STORE_SALE_SCAN_PURPOSE, ({ code }) => {
    flow.handleCode(code);
  });
  // 兌獎(P23):[兌獎] [最近兌獎]、兌獎提示的 [撤銷] 與兌獎紀錄詳情
  const redemption = useRedemptionFlow();
  // 盤點(P24):頂部 [盤點]、距離上次盤點超過 24 小時的提醒、盤點範圍視窗
  const stocktake = useStocktakeEntry(orgId, cashPoints);
  // 日結 / 存銀行(P27):頂部「上次日結」、[存銀行]、[日結](還有班沒送出交班 → 停用)
  const daily = useDailyCloseEntry(
    orgId,
    cashPoints.flatMap((point) =>
      point.shift == null ? [] : [{ cashPointName: point.name }],
    ),
  );

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
    const redeem = redemptionBoardActions({
      orgId,
      cashPointName: point.name,
      shift,
      canRedeem: hasPermission(STORE_PERMISSIONS.redeem),
      labels: {
        redeem: t("header.redeem"),
        recent: t("header.recentRedemptions"),
      },
      flow: redemption,
    });
    return [
      // [最近售出] 只在本機收銀點、自己開的班(規格 6.2)
      ...(shift.isMine
        ? [
            {
              key: "recent-sales",
              label: t("header.recentSales"),
              emphasis: "link" as const,
              onClick: () => {
                setSalesDialog({
                  kind: "recent",
                  shiftId: shift.id,
                  cashPointName: point.name,
                });
              },
            },
          ]
        : []),
      // [最近兌獎](自己的班)接在 [最近售出] 後面;[兌獎] 在按鈕列最前面(Figma ST-01)
      ...redeem.trailing,
      ...redeem.leading,
      ...(hasPermission(STORE_PERMISSIONS.deposit)
        ? [cashAction("deposit")]
        : []),
      ...(hasPermission(STORE_PERMISSIONS.withdraw)
        ? [cashAction("withdraw")]
        : []),
      ...(hasPermission(STORE_PERMISSIONS.split)
        ? [
            {
              key: "split",
              label: t("header.split"),
              onClick: () => {
                setSalesDialog({ kind: "splitPick" });
              },
            },
          ]
        : []),
      // [交班結帳](規格 6.2、6.9):本機收銀點開班中、有 `store.checkout`,只有這一班的負責人或店長(`store.edit`)能按
      ...(hasPermission(STORE_PERMISSIONS.checkout) &&
      (shift.isMine || hasPermission(STORE_PERMISSIONS.edit)) &&
      access.createRoute !== null
        ? [
            {
              key: "checkout",
              label: t("header.checkout"),
              emphasis: "primary" as const,
              onClick: () => {
                void navigate(
                  storeFormCreateHref(
                    access.createRoute ?? "",
                    CHECKOUT_CONFIRM_FORM_KEY,
                    {
                      [CHECKOUT_PREFILL.org]: orgId,
                      [CHECKOUT_PREFILL.shift]: shift.id,
                    },
                  ),
                );
              },
            },
          ]
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
        extra={
          <>
            <CameraScanButton
              onOpen={() => {
                setSalesDialog({ kind: "camera" });
              }}
            />
            {/* 上次日結與 [盤點] [存銀行] [日結] 一組靠右(Figma ST-01);放不下時整組換行 */}
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                ml: { sm: "auto" },
                alignItems: "center",
                flexWrap: "wrap",
                rowGap: 1,
              }}
            >
              {daily.lastClose}
              {stocktake.button}
              {daily.bankButton}
              {daily.dailyButton}
            </Stack>
          </>
        }
      />
      {stocktake.reminder}
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
          expandedBookId={
            expanded?.pointId === point.id ? expanded.bookId : null
          }
          onBookClick={(bookId) => {
            setExpanded((current) =>
              current?.pointId === point.id && current.bookId === bookId
                ? null
                : { pointId: point.id, bookId },
            );
          }}
          renderExpanded={(book) => (
            <ExpandedBookCard
              orgId={orgId}
              storeName={board?.org.name ?? ""}
              book={book}
              point={point}
              isLocal={point.id === local?.id}
              local={
                localOpen === null
                  ? null
                  : { id: localOpen.id, name: localOpen.name }
              }
              cashPoints={cashPoints}
              flash={
                flash?.bookId === book.bookId
                  ? { ticketNo: flash.ticketNo, nonce: flash.nonce }
                  : null
              }
              onClose={() => {
                setExpanded(null);
              }}
              onUndo={flow.openUndo}
            />
          )}
        />
      ))}
      <BoardDialogs
        org={board?.org ?? null}
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
      <SalesBoardDialogs
        dialog={salesDialog}
        orgId={orgId}
        local={
          localOpen === null ? null : { id: localOpen.id, name: localOpen.name }
        }
        onChange={setSalesDialog}
        onUndo={flow.openUndo}
      />
      {flow.element}
      {redemption.element}
      {stocktake.element}
      {daily.element}
    </Stack>
  );
};
