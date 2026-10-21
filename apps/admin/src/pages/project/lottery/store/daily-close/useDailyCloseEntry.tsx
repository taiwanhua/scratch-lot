import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  CHECKOUT_CONFIRM_FORM_KEY,
  STORE_KEY,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";
import { useLotteryDailyCloseStatusQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { storeFormCreateHref } from "../forms/store-forms-keys";
import { BankDepositDialog } from "./BankDepositDialog";
import {
  DAILY_CLOSE_PREFILL,
  DAILY_CLOSE_TYPE_VALUE,
} from "./daily-close-keys";

export interface DailyCloseEntry {
  /** 頂部「上次日結:10/13(已 3 天)」(沒有日結過 =「還沒有日結」) */
  lastClose: ReactNode;
  /** 頂部 [存銀行](沒有 `store.bank-deposit` = null) */
  bankButton: ReactNode;
  /** 頂部 [日結](沒有 `store.checkout` = null;還有班沒送出交班 / 已有審核中的日結 → 停用,滑過說明) */
  dailyButton: ReactNode;
  /** 存銀行視窗 */
  element: ReactNode;
}

/**
 * 看板頂部的日結入口(規格 6.1、6.10、6.11;Figma ST-01、ST-20、ST-26a/b):上次日結、[存銀行]、[日結]。
 * [日結]:**這家店所有收銀點的班都已送出交班結帳**才能按,停用時滑過列出還沒送出的班(ST-20);
 * 已有審核中 / 已退回的日結也停用(每一班只會被一張日結涵蓋計算)。按下 → 日結精靈(結帳確認申請新增頁 `?type=daily`)。
 */
export const useDailyCloseEntry = (
  orgId: string,
  openShifts: readonly { cashPointName: string }[],
): DailyCloseEntry => {
  const t = useTranslations("admin.lotteryStore.dailyClose.entry");
  const { session } = useSession();
  const temporal = useTemporalText();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const access = useFormModuleAccess(STORE_KEY);
  const [depositOpen, setDepositOpen] = useState(false);
  const status = useLotteryDailyCloseStatusQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const data = status.data?.lotteryDailyCloseStatus ?? null;
  const canClose =
    hasPermission(STORE_PERMISSIONS.checkout) && access.createRoute !== null;
  const pending = data?.pending ?? null;
  let blockedText = "";
  if (openShifts.length > 0) {
    blockedText = [
      t("blockedTitle"),
      ...openShifts.map((shift) =>
        t("blockedShift", { cashPoint: shift.cashPointName }),
      ),
    ].join("\n");
  } else if (pending !== null) {
    blockedText = t(
      pending.status === "returned" ? "blockedReturned" : "blockedPending",
      { serialNo: pending.serialNo ?? "" },
    );
  }
  const lastClosedAt = data?.lastClosedAt ?? null;
  return {
    lastClose:
      orgId === "" || data === null ? null : (
        <Typography variant="body2" sx={{ color: "warning.dark" }}>
          {lastClosedAt === null
            ? t("never")
            : t("last", {
                date: temporal(lastClosedAt, "monthDay"),
                days: data.daysSince ?? 0,
              })}
        </Typography>
      ),
    bankButton:
      hasPermission(STORE_PERMISSIONS.bankDeposit) && orgId !== "" ? (
        <Button
          variant="outlined"
          onClick={() => {
            setDepositOpen(true);
          }}
        >
          {t("bankDeposit")}
        </Button>
      ) : null,
    dailyButton:
      canClose && orgId !== "" ? (
        <Tooltip
          title={
            blockedText === "" ? (
              ""
            ) : (
              <Stack sx={{ whiteSpace: "pre-line" }}>{blockedText}</Stack>
            )
          }
        >
          <Button
            variant="contained"
            disabled={blockedText !== ""}
            onClick={() => {
              void navigate(
                storeFormCreateHref(
                  access.createRoute ?? "",
                  CHECKOUT_CONFIRM_FORM_KEY,
                  {
                    [DAILY_CLOSE_PREFILL.org]: orgId,
                    [DAILY_CLOSE_PREFILL.type]: DAILY_CLOSE_TYPE_VALUE,
                  },
                ),
              );
            }}
          >
            {t("dailyClose")}
          </Button>
        </Tooltip>
      ) : null,
    element: depositOpen ? (
      <BankDepositDialog
        orgId={orgId}
        onClose={() => {
          setDepositOpen(false);
        }}
      />
    ) : null,
  };
};
