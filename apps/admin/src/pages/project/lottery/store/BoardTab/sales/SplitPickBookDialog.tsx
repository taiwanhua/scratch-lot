import { useState } from "react";

import {
  STORE_SPLIT_SCAN_PURPOSE,
  displayBookNo,
  normalizeBookNo,
  parseTicketInput,
} from "@repo/domain/project/lottery";
import {
  type LotteryStoreStockBookFieldsFragment,
  useLotteryStoreStockBooksQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useScanner } from "@/hooks/base/useScanner/useScanner";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import { useSalesText } from "./useSalesText";

export interface SplitPickBookDialogProps {
  orgId: string;
  localName: string;
  onClose: () => void;
  onNext: (bookId: string) => void;
}

/** 輸入或刷到的碼 → 7 位本號(刮刮樂的碼取本號;只打本號也行)。 */
const bookNoOf = (text: string): string | null =>
  parseTicketInput(text)?.bookNo ?? normalizeBookNo(text);

/**
 * 拆本 / 上檯面 · 先選本(Figma ST-37;規格 6.4):列出本店庫存裡有未售、沒被鎖的張的本(未拆的本標「未拆」,
 * 拆過的本標「拆過 · 庫存 N 張」);刷條碼或輸入本號直接選中那一本(開著時宣告掃描用途 `store-split`,
 * 優先於看板的銷售)。[下一步] 進入拆本精靈。
 */
export const SplitPickBookDialog = ({
  orgId,
  localName,
  onClose,
  onNext,
}: SplitPickBookDialogProps) => {
  const { t } = useSalesText();
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const bookMetaOf = (book: LotteryStoreStockBookFieldsFragment) => {
    if (!book.sealed) {
      return t("split.bookMetaOpened", {
        price: moneyText(book.unitPrice),
        count: book.ticketCount,
      });
    }
    return book.pendingSkipCount > 0
      ? t("split.bookMetaSkip", {
          price: moneyText(book.unitPrice),
          first: book.firstTicketNo,
          last: book.lastTicketNo,
          count: book.pendingSkipCount,
        })
      : t("split.bookMeta", {
          price: moneyText(book.unitPrice),
          count: book.ticketCount,
        });
  };
  const books =
    useLotteryStoreStockBooksQuery(session.client, { orgId }, { staleTime: 0 })
      .data?.lotteryStoreStockBooks.items ?? [];
  const [text, setText] = useState("");
  const [picked, setPicked] = useState("");
  const pickByCode = (code: string) => {
    setText(code);
    const bookNo = bookNoOf(code);
    const match = books.find((book) => book.bookNo === bookNo);
    if (match) {
      setPicked(match.bookId);
    }
  };
  useScanner(STORE_SPLIT_SCAN_PURPOSE, ({ code }) => {
    pickByCode(code);
  });
  const chosen = picked === "" ? (books[0]?.bookId ?? "") : picked;
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("split.pickTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("sale.cancel")}
          </Button>
          <Button
            disabled={chosen === ""}
            onClick={() => {
              onNext(chosen);
            }}
          >
            {t("split.next")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="textSecondary">
          {t("split.pickTo", { name: localName })}
        </Typography>
        <TextField
          label={t("split.search")}
          value={text}
          size="small"
          fullWidth
          onChange={(event) => {
            pickByCode(event.target.value);
          }}
        />
        {books.length === 0 ? (
          <Typography color="textSecondary">{t("split.none")}</Typography>
        ) : (
          <>
            <Typography variant="body2">
              {t("split.pickHint", { count: books.length })}
            </Typography>
            <RadioGroup
              value={chosen}
              onChange={(event) => {
                setPicked(event.target.value);
              }}
            >
              {books.map((book) => (
                <FormControlLabel
                  key={book.bookId}
                  value={book.bookId}
                  control={<Radio />}
                  label={
                    <Stack>
                      <Typography variant="body1">
                        {t("split.bookLine", {
                          code: book.gameCode,
                          name: book.gameName,
                          bookNo: displayBookNo(book.bookNo),
                        })}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {bookMetaOf(book)}
                      </Typography>
                    </Stack>
                  }
                />
              ))}
            </RadioGroup>
          </>
        )}
      </Stack>
    </Dialog>
  );
};
