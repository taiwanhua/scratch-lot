import { useTranslations } from "use-intl";

import {
  type StocktakeLostAction,
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { Card } from "@repo/ui/card";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { ReasonFields } from "@/components/project/lottery/ReasonFields/ReasonFields";
import { missingReasonFields } from "@/components/project/lottery/ReasonFields/reason-value";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import type {
  LostChoice,
  LostGroup,
  StocktakeSheet,
  StocktakeState,
} from "./stocktake-model";

type UnopenedBook = StocktakeSheet["unopenedBooks"][number];

export interface UnopenedSectionProps {
  books: readonly UnopenedBook[];
  state: StocktakeState;
  onChange: (bookId: string, present: boolean) => void;
}

/** 未拆的本:在 / 不在(不在的本盤點完成時列為待查;規格 6.8、7.4)。 */
export const UnopenedSection = ({
  books,
  state,
  onChange,
}: UnopenedSectionProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.unopened");
  const columns: TableColumn<UnopenedBook>[] = [
    {
      key: "book",
      header: t("book"),
      render: (row) => displayBookNo(row.bookNo),
    },
    {
      key: "game",
      header: t("game"),
      render: (row) => `${row.gameCode} ${row.gameName}`,
    },
    { key: "count", header: t("count"), render: (row) => row.ticketCount },
    {
      key: "state",
      header: t("state"),
      render: (row) => {
        const value = state.unopened[row.bookId];
        return (
          <RadioGroup
            row
            aria-label={t("stateAria", { bookNo: displayBookNo(row.bookNo) })}
            value={value === undefined ? "" : String(value)}
            onChange={(event) => {
              onChange(row.bookId, event.target.value === "true");
            }}
          >
            <FormControlLabel
              value="true"
              control={<Radio size="small" />}
              label={t("present")}
            />
            <FormControlLabel
              value="false"
              control={<Radio size="small" />}
              label={t("absent")}
            />
          </RadioGroup>
        );
      },
    },
  ];
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" component="h2">
          {t("title")}
        </Typography>
        {books.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("empty")}
          </Typography>
        ) : (
          <>
            <Table
              columns={columns}
              rows={books}
              getRowKey={(row) => row.bookId}
              size="small"
              containerSx={{ height: "auto" }}
            />
            <Typography variant="caption" color="text.secondary">
              {t("hint")}
            </Typography>
          </>
        )}
      </Stack>
    </Card>
  );
};

export interface LostSectionProps {
  groups: readonly LostGroup[];
  state: StocktakeState;
  /** 有 `store.confirm-lost` 才有「確認遺失」 */
  canConfirmLost: boolean;
  onChange: (bookId: string, choice: LostChoice | null) => void;
}

const DEFAULT_LOST: LostChoice = {
  action: "keep",
  reasonKey: "",
  reasonNote: "",
  scannedTicketIds: [],
};

/**
 * 待查清單的處理(規格 6.8、7.4):找到了(要刷條碼)/ 確認遺失(`store.confirm-lost`,原因必填)/ 繼續待查。
 * 核准完成時才套用(尋回到本店庫存 / 遺失)。
 */
export const LostSection = ({
  groups,
  state,
  canConfirmLost,
  onChange,
}: LostSectionProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.lost");
  const temporal = useTemporalText();
  const sinceText = (group: LostGroup) => {
    const date = group.since === null ? "" : temporal(group.since, "monthDay");
    if (group.source === "transfer") {
      return t("sinceTransfer", { date });
    }
    return group.source === "stocktake"
      ? t("sinceStocktake", { date })
      : t("since", { date });
  };
  /** 「找到了」的說明:整本刷一張就好;零碎的逐張刷,沒刷到的維持待查。 */
  const foundText = (group: LostGroup, choice: LostChoice) => {
    if (group.wholeBook) {
      return choice.scannedTicketIds.length > 0
        ? t("foundOk")
        : t("scanToConfirm");
    }
    return choice.scannedTicketIds.length === 0
      ? t("scanEach")
      : t("foundSome", {
          count: choice.scannedTicketIds.length,
          total: group.tickets.length,
        });
  };
  const actions: StocktakeLostAction[] = canConfirmLost
    ? ["found", "lost", "keep"]
    : ["found", "keep"];
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" component="h2">
          {t("title")}
        </Typography>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("empty")}
          </Typography>
        ) : null}
        {groups.map((group) => {
          const choice = state.lost[group.bookId] ?? DEFAULT_LOST;
          const label = `${group.gameCode} · ${displayBookNo(group.bookNo)} · ${
            group.wholeBook
              ? t("wholeBook")
              : formatTicketRanges(
                  group.tickets.map((ticket) => ticket.ticketNo),
                )
          }`;
          return (
            <Stack
              key={group.bookId}
              spacing={1.5}
              sx={{ py: 1, borderTop: 1, borderColor: "divider" }}
            >
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                sx={{ alignItems: { md: "center" } }}
              >
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {label}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ flex: 1 }}
                >
                  {sinceText(group)}
                </Typography>
                <SelectField
                  label={t("action")}
                  size="small"
                  value={choice.action}
                  options={actions.map((action) => ({
                    value: action,
                    label: t(`actions.${action}`),
                  }))}
                  onChange={(next: StocktakeLostAction) => {
                    onChange(
                      group.bookId,
                      next === "keep" ? null : { ...choice, action: next },
                    );
                  }}
                  sx={{ minWidth: 220 }}
                />
              </Stack>
              {choice.action === "found" ? (
                <Typography
                  variant="body2"
                  sx={{
                    color:
                      choice.scannedTicketIds.length > 0
                        ? "success.dark"
                        : "warning.dark",
                  }}
                >
                  {foundText(group, choice)}
                </Typography>
              ) : null}
              {choice.action === "lost" ? (
                <ReasonFields
                  categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.lostReason}
                  label={t("lostReason")}
                  value={{
                    reasonKey: choice.reasonKey,
                    reasonNote: choice.reasonNote,
                  }}
                  invalid={missingReasonFields(choice)}
                  onChange={(value) => {
                    onChange(group.bookId, { ...choice, ...value });
                  }}
                />
              ) : null}
            </Stack>
          );
        })}
        {groups.length > 0 ? (
          <Typography variant="caption" color="text.secondary">
            {t("hint")}
          </Typography>
        ) : null}
      </Stack>
    </Card>
  );
};
