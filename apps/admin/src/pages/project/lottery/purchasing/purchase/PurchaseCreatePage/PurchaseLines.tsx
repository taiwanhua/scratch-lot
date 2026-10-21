import { useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { LineErrorAlerts } from "../../shared/LineErrorAlerts";
import { type FieldErrorSource } from "../../shared/field-errors";
import { PURCHASE_FIELD_KEYS, formatMoney } from "../purchase-keys";
import {
  type BookGroup,
  type BookRow,
  type GroupRates,
  parseRate,
} from "./purchase-form";

export interface PurchaseLinesProps {
  groups: readonly BookGroup[];
  /** 平板 / 手機:每本一張卡片 */
  isCompact: boolean;
  onRate: (rowId: string, rate: number) => void;
  /** 各遊戲最後一次改整組的率(沒改過 = 遊戲預設;改單本不影響整組框) */
  groupRates: GroupRates;
  onGroupRate: (gameId: string, rate: number) => void;
  onRemove: (rowId: string) => void;
  /** 送出 / 存草稿失敗的錯誤(`useFormDraft().error`;明細的欄位錯誤顯示在這一區) */
  error: FieldErrorSource;
}

const lastTicketText = (value: number): string =>
  String(value).padStart(3, "0");

/**
 * 批購金額率的輸入框:改過(和遊戲預設不同)標色。輸入中的文字自己記(清空、打到一半不會被
 * `value` 蓋回去);是 0–100 的整數才回報,離開時還原成目前的值;`value` 從外面改(例:改整組)時跟著換。
 */
const RateInput = ({
  label,
  value,
  isEdited,
  onChange,
}: {
  label: string;
  value: number;
  isEdited: boolean;
  onChange: (rate: number) => void;
}) => {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  return (
    <TextField
      size="small"
      type="number"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const rate = parseRate(event.target.value);
        if (rate !== null) {
          onChange(rate);
        }
      }}
      onBlur={() => {
        setText(String(value));
      }}
      sx={{
        width: 88,
        "& input": { textAlign: "right" },
        ...(isEdited && {
          "& .MuiInputBase-root": { bgcolor: "warning.light" },
        }),
      }}
      slotProps={{ htmlInput: { "aria-label": label, min: 0, max: 100 } }}
    />
  );
};

/**
 * 進貨單新增頁的明細(規格 8.2 明細;Figma PU-05):依遊戲分組,組標題列顯示小計、「叫貨 N,已刷 M」與
 * 整組的批購金額率;每本的批購金額率可逐本改(改過的標色)。電腦是表格,平板 / 手機是卡片。
 */
export const PurchaseLines = ({
  groups,
  isCompact,
  onRate,
  groupRates,
  onGroupRate,
  onRemove,
  error,
}: PurchaseLinesProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.create");
  const errors = (
    <LineErrorAlerts error={error} fieldKey={PURCHASE_FIELD_KEYS.lines} />
  );
  if (groups.length === 0) {
    return (
      <>
        {errors}
        <Typography variant="body2" color="text.secondary">
          {t("empty")}
        </Typography>
      </>
    );
  }
  const columns: TableColumn<BookRow>[] = [
    {
      key: "bookNo",
      header: t("columns.bookNo"),
      render: (row) => row.displayBookNo,
      isEmphasized: true,
    },
    {
      key: "lastTicketNo",
      header: t("columns.lastTicketNo"),
      render: (row) => lastTicketText(row.lastTicketNo),
    },
    {
      key: "tickets",
      header: t("columns.tickets"),
      align: "right",
      render: (row) => formatMoney(row.tickets),
    },
    {
      key: "bookPrice",
      header: t("columns.bookPrice"),
      align: "right",
      render: (row) => formatMoney(row.bookPrice),
    },
    {
      key: "rate",
      header: t("columns.rate"),
      align: "right",
      render: (row) => (
        <RateInput
          label={t("rateOf", { bookNo: row.displayBookNo })}
          value={row.rate}
          isEdited={row.isRateEdited}
          onChange={(rate) => {
            onRate(row.rowId, rate);
          }}
        />
      ),
    },
    {
      key: "amount",
      header: t("columns.amount"),
      align: "right",
      render: (row) => formatMoney(row.amount),
    },
    {
      key: "remove",
      header: "",
      width: 72,
      render: (row) => (
        <Button
          variant="text"
          size="small"
          color="error"
          onClick={() => {
            onRemove(row.rowId);
          }}
        >
          {t("remove")}
        </Button>
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      {errors}
      {groups.map((group) => {
        const title = t("groupTitle", {
          code: group.game.gameCode,
          name: group.game.name,
          price: group.game.unitPrice,
          books: group.rows.length,
          subtotal: formatMoney(group.subtotal),
        });
        return (
          <Stack key={group.game.id} spacing={1}>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <Typography
                variant="subtitle2"
                component="h3"
                sx={{ flex: 1, minWidth: 200 }}
              >
                {title}
                {group.requestedBooks !== null && (
                  <Typography
                    component="span"
                    variant="body2"
                    color="text.secondary"
                    sx={{ ml: 1 }}
                  >
                    {t("requested", {
                      requested: group.requestedBooks,
                      scanned: group.rows.length,
                    })}
                  </Typography>
                )}
              </Typography>
              {group.rows.length > 0 && (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {t("groupRate")}
                  </Typography>
                  <RateInput
                    label={t("groupRateOf", { code: group.game.gameCode })}
                    value={
                      groupRates.get(group.game.id) ?? group.game.defaultRate
                    }
                    isEdited={false}
                    onChange={(rate) => {
                      onGroupRate(group.game.id, rate);
                    }}
                  />
                </Stack>
              )}
            </Stack>
            {isCompact ? (
              <Stack spacing={1}>
                {group.rows.map((row) => (
                  <Card key={row.rowId} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center" }}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {row.displayBookNo}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t("cardFacts", {
                            lastTicketNo: lastTicketText(row.lastTicketNo),
                            amount: formatMoney(row.amount),
                          })}
                        </Typography>
                      </Box>
                      <RateInput
                        label={t("rateOf", { bookNo: row.displayBookNo })}
                        value={row.rate}
                        isEdited={row.isRateEdited}
                        onChange={(rate) => {
                          onRate(row.rowId, rate);
                        }}
                      />
                      <Button
                        variant="text"
                        size="small"
                        color="error"
                        onClick={() => {
                          onRemove(row.rowId);
                        }}
                      >
                        {t("remove")}
                      </Button>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            ) : (
              group.rows.length > 0 && (
                <Table
                  aria-label={title}
                  size="small"
                  columns={columns}
                  rows={group.rows}
                  getRowKey={(row) => row.rowId}
                  minWidth={760}
                  containerSx={{ height: "auto" }}
                />
              )
            )}
          </Stack>
        );
      })}
    </Stack>
  );
};
