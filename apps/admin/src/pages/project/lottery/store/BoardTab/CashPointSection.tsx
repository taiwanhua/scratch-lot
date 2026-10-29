import { Fragment, type ReactNode } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { displayBookNo } from "@repo/domain/project/lottery";
import { isTagPaletteKey } from "@repo/domain/tag-palette";
import type { LotteryStoreBoardQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { tagPaletteColorOf } from "@repo/ui/theme";

import { BoardBookCard } from "@/components/project/lottery/BoardBookCard/BoardBookCard";
import {
  CashPointHeader,
  type CashPointHeaderAction,
} from "@/components/project/lottery/CashPointHeader/CashPointHeader";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { localPartsOf } from "@/lib/project/schedule-roster";

import { moneyText } from "../store-text";

export type BoardCashPoint =
  LotteryStoreBoardQuery["lotteryStoreBoard"]["item"]["cashPoints"][number];

export interface CashPointSectionProps {
  point: BoardCashPoint;
  isLocal: boolean;
  actions: readonly CashPointHeaderAction[];
  /** 點負責人那一行(班次資訊) */
  onShiftInfo: (shiftId: string) => void;
  /** 展開中的卡片(本 id);沒有 = null(一次只展開一張,規格 6.2) */
  expandedBookId?: string | null;
  /** 點卡片(展開 / 收合);不給 = 卡片不能點 */
  onBookClick?: (bookId: string) => void;
  /** 展開的內容(放在那張卡片後面、占滿整列) */
  renderExpanded?: (book: BoardCashPoint["books"][number]) => ReactNode;
}

/** 卡片左側色條:遊戲顏色(標籤色票);沒設 = 灰。 */
const stripeOf = (color: string | null | undefined): string =>
  isTagPaletteKey(color) ? tagPaletteColorOf(color) : "grey.400";

/**
 * 看板上的一個收銀點:收銀點標題列(名稱、本機 / 狀態、負責人那一行、本班已售、應有現金、按鈕)+
 * 檯面上的本(卡片;點卡片展開由銷售的功能接上)。
 */
export const CashPointSection = ({
  point,
  isLocal,
  actions,
  onShiftInfo,
  expandedBookId = null,
  onBookClick,
  renderExpanded,
}: CashPointSectionProps) => {
  const t = useTranslations("admin.lotteryStore");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const shift = point.shift ?? null;
  const ownerKey =
    shift?.unmatchedEntry === true ? "header.ownerUnmatched" : "header.owner";
  return (
    <Stack spacing={1.5}>
      <CashPointHeader
        name={point.name}
        localLabel={isLocal ? t("header.local") : null}
        isOpen={shift !== null}
        statusLabel={shift === null ? t("header.closed") : t("header.open")}
        detail={
          shift === null
            ? null
            : t(ownerKey, {
                name: shift.openedBy.name,
                time: localPartsOf(shift.openedAt, timezone).time,
              })
        }
        {...(shift === null
          ? {}
          : {
              onDetailClick: () => {
                onShiftInfo(shift.id);
              },
              detailActionLabel: t("header.ownerAction"),
            })}
        stats={
          shift === null
            ? []
            : [
                {
                  key: "sold",
                  label: t("header.sold"),
                  value: t("header.soldValue", {
                    count: shift.soldCount,
                    amount: moneyText(shift.soldAmount),
                  }),
                },
                {
                  key: "expected",
                  label: t("header.expected"),
                  value: moneyText(shift.expectedCash),
                },
              ]
        }
        actions={actions}
      />
      {point.books.length === 0 ? null : (
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            // 展開的區塊占滿整列:同一列後面的卡片往前補,展開區塊落在那張卡片的下一列
            gridAutoFlow: "row dense",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(auto-fill, minmax(240px, 1fr))",
            },
          }}
        >
          {point.books.map((book) => (
            <Fragment key={book.bookId}>
              <BoardBookCard
                title={t("card.title", {
                  code: book.gameCode,
                  name: book.gameName,
                })}
                priceText={t("card.price", {
                  price: moneyText(book.unitPrice),
                })}
                metaText={t("card.meta", {
                  bookNo: displayBookNo(book.bookNo),
                  count: book.soldToday,
                })}
                remainingText={t("card.remaining", {
                  remaining: book.remaining,
                  total: book.total,
                })}
                remaining={book.remaining}
                total={book.total}
                lowStockLabel={book.isLowStock ? t("card.lowStock") : null}
                stripeColor={stripeOf(book.color)}
                expanded={expandedBookId === book.bookId}
                {...(onBookClick !== undefined && {
                  onClick: () => {
                    onBookClick(book.bookId);
                  },
                })}
              />
              {expandedBookId === book.bookId ? renderExpanded?.(book) : null}
            </Fragment>
          ))}
        </Box>
      )}
    </Stack>
  );
};
