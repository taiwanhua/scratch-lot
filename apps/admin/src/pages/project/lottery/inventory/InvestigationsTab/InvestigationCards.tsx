import { useTranslations } from "use-intl";

import { TICKET_STATUS } from "@repo/domain/project/lottery";
import type { LotteryInvestigationRowFieldsFragment } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../inventory-config";
import { useInvestigationText } from "./useInvestigationText";

type Row = LotteryInvestigationRowFieldsFragment;

export interface InvestigationCardsProps {
  rows: readonly Row[];
  isLoading: boolean;
  getRowKey: (row: Row) => string;
  /** 有 `recover` 權限:確定的列給 [尋回] */
  canRecover: boolean;
  /** 點確定的列進本的詳情;沒綁詳情頁 = undefined(卡片不能點) */
  onOpen?: (row: Row) => void;
  onRecover: (row: Row) => void;
}

const join = (parts: readonly string[]) =>
  parts.filter((part) => part !== "").join(" · ");

/**
 * 手機版的待查·遺失(規格 16.0「列表的表格在手機改成卡片」;Figma CS-21 手機 862:22606):一列一張卡片。
 * 確定的列:「本號 · 遊戲 · 張數」+ 狀態標籤、「分店 · 張號 · 來源 · 日期 · 天數」、批購成本(`show-cost`)、[尋回];
 * 點卡片進本的詳情。未對號的列:「遊戲 · N 張 · 系統預設帶入」、「分店 · 來源盤點 · 天數 · 批購成本」,
 * 下方直接寫本號與張號(電腦版要點一下展開),不給 [尋回]、不能點。
 */
export const InvestigationCards = ({
  rows,
  isLoading,
  getRowKey,
  canRecover,
  onOpen,
  onRecover,
}: InvestigationCardsProps) => {
  const t = useTranslations("admin.lotteryInventory.investigations");
  const tStatus = useTranslations("admin.lotteryInventory.ticketStatuses");
  const text = useInvestigationText();
  if (isLoading) {
    return <CircularProgress aria-label={t("listAria")} />;
  }
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("empty")}
      </Typography>
    );
  }
  return (
    <Stack
      role="list"
      aria-label={t("listAria")}
      spacing={1.5}
      sx={{ height: "100%", overflow: "auto" }}
    >
      {rows.map((row) => {
        const tickets = t("cardTickets", { count: row.ticketCount });
        const cost =
          row.cost == null ? "" : t("cardCost", { cost: moneyText(row.cost) });
        const open = row.unmatched ? undefined : onOpen;
        return (
          <Box key={getRowKey(row)} role="listitem" sx={{ flexShrink: 0 }}>
            <Card
              variant="outlined"
              {...(open === undefined
                ? {}
                : {
                    role: "button",
                    tabIndex: 0,
                    onClick: () => {
                      open(row);
                    },
                    onKeyDown: (event: { key: string }) => {
                      if (event.key === "Enter") {
                        open(row);
                      }
                    },
                  })}
              sx={{
                p: 2,
                cursor: open === undefined ? "default" : "pointer",
              }}
            >
              <Stack spacing={0.5}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "flex-start" }}
                >
                  <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>
                    {row.unmatched
                      ? join([text.game(row), tickets, t("systemDefault")])
                      : join([text.book(row), text.game(row), tickets])}
                  </Typography>
                  <Tag
                    tone={
                      row.status === TICKET_STATUS.lost ? "error" : "warning"
                    }
                    label={tStatus(row.status)}
                  />
                </Stack>
                <Typography variant="body2" color="textSecondary">
                  {row.unmatched
                    ? join([
                        text.responsible(row),
                        text.source(row),
                        text.days(row),
                        cost,
                      ])
                    : join([
                        text.responsible(row),
                        text.ticketNos(row),
                        text.source(row),
                        text.at(row),
                        text.days(row),
                      ])}
                </Typography>
                {row.unmatched ? (
                  <Typography variant="body2" color="textSecondary">
                    {t("unmatchedCardDetail", {
                      books: text.unmatchedBooks(row),
                    })}
                  </Typography>
                ) : (
                  <>
                    {cost === "" ? null : (
                      <Typography variant="body2" color="textSecondary">
                        {cost}
                      </Typography>
                    )}
                    {canRecover ? (
                      <Box sx={{ pt: 0.5 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRecover(row);
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          {t("recover")}
                        </Button>
                      </Box>
                    ) : null}
                  </>
                )}
              </Stack>
            </Card>
          </Box>
        );
      })}
    </Stack>
  );
};
