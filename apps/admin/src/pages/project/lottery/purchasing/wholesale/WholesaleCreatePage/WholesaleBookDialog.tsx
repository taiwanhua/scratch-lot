import { useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Checkbox } from "@repo/ui/checkbox";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { displayBookNo, formatMoney } from "../wholesale-keys";
import type { WholesaleBookOption } from "./wholesale-form";

export interface WholesaleBookDialogProps {
  /** 出貨分店名稱以外的可批售的本(出貨分店庫存裡未拆的整本) */
  books: readonly WholesaleBookOption[];
  /** 已在明細的本(勾著、不能取消) */
  addedIds: ReadonlySet<string>;
  onAdd: (books: WholesaleBookOption[]) => void;
  onClose: () => void;
}

/**
 * 從可批售的本加入(規格 21.3;Figma WS-02d 916:9317 / 920:12298 / 920:12434;手機全螢幕):依遊戲分組勾選,
 * 已加入的勾著不能動,[加入 N 本] 一次加入。
 */
export const WholesaleBookDialog = ({
  books,
  addedIds,
  onAdd,
  onClose,
}: WholesaleBookDialogProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.create");
  const isMobile = useBreakpointDown("sm");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const groups = [...Map.groupBy(books, (book) => book.gameId).entries()];
  const toggle = (bookId: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(bookId)) {
        next.add(bookId);
      }
      return next;
    });
  };
  const checkbox = (book: WholesaleBookOption) => (
    <Checkbox
      size="small"
      checked={addedIds.has(book.bookId) || picked.has(book.bookId)}
      disabled={addedIds.has(book.bookId)}
      onChange={() => {
        toggle(book.bookId);
      }}
      slotProps={{
        input: {
          "aria-label": t("picker.pick", {
            bookNo: displayBookNo(book.bookNo),
          }),
        },
      }}
    />
  );
  const addedTag = (book: WholesaleBookOption) =>
    addedIds.has(book.bookId) ? (
      <Tag tone="grey" label={t("picker.added")} />
    ) : null;
  const columns: TableColumn<WholesaleBookOption>[] = [
    { key: "pick", header: "", width: 48, render: checkbox },
    {
      key: "bookNo",
      header: t("columns.book"),
      isEmphasized: true,
      render: (book) => displayBookNo(book.bookNo),
    },
    {
      key: "tickets",
      header: t("columns.tickets"),
      align: "right",
      render: (book) => formatMoney(book.tickets),
    },
    {
      key: "bookPrice",
      header: t("columns.bookPrice"),
      align: "right",
      render: (book) => formatMoney(book.bookPrice),
    },
    {
      key: "rate",
      header: t("picker.defaultRate"),
      align: "right",
      render: (book) => `${String(book.defaultRate)}%`,
    },
    { key: "added", header: "", width: 88, render: addedTag },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("picker.title")}
      actions={
        <>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t("picker.picked", { count: picked.size })}
          </Typography>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={picked.size === 0}
            onClick={() => {
              onAdd(books.filter((book) => picked.has(book.bookId)));
            }}
          >
            {t("picker.add", { count: picked.size })}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" color="textSecondary">
          {t("picker.hint")}
        </Typography>
        {groups.length === 0 && (
          <Typography variant="body2">{t("picker.empty")}</Typography>
        )}
        {groups.map(([gameId, group]) => {
          const [first] = group;
          const title = t("picker.group", {
            code: first.gameCode,
            name: first.gameName,
            price: first.unitPrice,
            books: group.length,
          });
          return (
            <Stack key={gameId} spacing={1}>
              <Typography variant="subtitle2" component="h3">
                {title}
              </Typography>
              {isMobile ? (
                <Card variant="outlined" sx={{ px: 1 }}>
                  {group.map((book) => (
                    <Stack
                      key={book.bookId}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center" }}
                    >
                      {checkbox(book)}
                      <Typography variant="body2">
                        {displayBookNo(book.bookNo)}
                      </Typography>
                      <Box sx={{ flex: 1, textAlign: "right" }}>
                        <Typography variant="body2">
                          {t("picker.facts", {
                            tickets: book.tickets,
                            price: formatMoney(book.bookPrice),
                            rate: book.defaultRate,
                          })}
                        </Typography>
                      </Box>
                      {addedTag(book)}
                    </Stack>
                  ))}
                </Card>
              ) : (
                <Table
                  aria-label={title}
                  size="small"
                  columns={columns}
                  rows={group}
                  getRowKey={(book) => book.bookId}
                  containerSx={{ height: "auto" }}
                />
              )}
            </Stack>
          );
        })}
      </Stack>
    </Dialog>
  );
};
