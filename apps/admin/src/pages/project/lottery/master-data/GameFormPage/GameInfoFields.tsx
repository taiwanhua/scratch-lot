import { useId } from "react";
import { useTranslations } from "use-intl";

import {
  STANDARD_UNIT_PRICES,
  bookPriceOf,
  isStandardCombination,
  standardTicketsPerBook,
} from "@repo/domain/project/lottery-master-data";
import { Box } from "@repo/ui/box";
import { DatePicker } from "@repo/ui/date-picker";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";

import type { GameFormField, GameFormValues } from "./useGameForm";

export interface GameInfoFieldsProps {
  values: GameFormValues;
  change: <Key extends keyof GameFormValues>(
    key: Key,
    value: GameFormValues[Key],
  ) => void;
  invalidFields: readonly GameFormField[];
  /** 有庫存:代號、單張金額、整本張數唯讀 */
  isLocked: boolean;
}

/** 三欄格線(電腦);平板兩欄、手機單欄(RW-02)。 */
const GRID_SX = {
  display: "grid",
  gap: 2,
  gridTemplateColumns: {
    xs: "1fr",
    sm: "repeat(2, 1fr)",
    md: "repeat(3, 1fr)",
  },
} as const;

const integerOrNull = (raw: string): number | null => {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isInteger(value) ? value : null;
};

/**
 * 「遊戲資訊」區塊的欄位(Figma MD-02 97:456):代號 / 名稱 / 狀態、單張金額 / 整本張數 / 整本金額(唯讀,
 * 即時算)、預設批購金額率 / 上市日 / 停售日、兌獎截止日。單張金額是可輸入的下拉(預設面額 + 自填)。
 * 非標準組合只提示,不擋。
 */
export const GameInfoFields = ({
  values,
  change,
  invalidFields,
  isLocked,
}: GameInfoFieldsProps) => {
  const t = useTranslations("admin.lotteryMasterData.gameForm");
  const tStatus = useTranslations("admin.lotteryMasterData.status");
  const priceListId = useId();
  const isInvalid = (field: GameFormField) => invalidFields.includes(field);

  const unitPrice = integerOrNull(values.unitPrice);
  const tickets = integerOrNull(values.ticketsPerBook);
  const standard =
    unitPrice === null ? null : standardTicketsPerBook(unitPrice);
  let ticketsHint: string | undefined;
  if (
    unitPrice !== null &&
    tickets !== null &&
    !isStandardCombination(unitPrice, tickets)
  ) {
    ticketsHint =
      standard === null
        ? t("nonStandardPrice")
        : t("nonStandard", { unitPrice, standard });
  }
  const bookPrice =
    unitPrice === null || tickets === null
      ? ""
      : bookPriceOf(unitPrice, tickets).toLocaleString("en-US");

  const dateField = (
    field: "launchedAt" | "discontinuedAt" | "claimDeadline",
  ) => (
    <DatePicker
      label={t(`fields.${field}`)}
      value={values[field]}
      error={isInvalid(field)}
      fullWidth
      onChange={(value) => {
        change(field, value);
      }}
    />
  );

  return (
    <Box sx={GRID_SX}>
      <TextField
        label={t("fields.gameCode")}
        value={values.gameCode}
        required
        disabled={isLocked}
        error={isInvalid("gameCode")}
        helperText={t("gameCodeHint")}
        slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 4 } }}
        onChange={(event) => {
          change("gameCode", event.target.value);
        }}
      />
      <TextField
        label={t("fields.name")}
        value={values.name}
        required
        error={isInvalid("name")}
        slotProps={{ htmlInput: { maxLength: 30 } }}
        onChange={(event) => {
          change("name", event.target.value);
        }}
      />
      <SelectField
        label={t("fields.status")}
        value={values.status}
        options={[
          { value: "on_sale", label: tStatus("on_sale") },
          { value: "discontinued", label: tStatus("discontinued") },
        ]}
        error={isInvalid("status")}
        onChange={(value) => {
          change("status", value);
        }}
      />
      <Box>
        <TextField
          label={t("fields.unitPrice")}
          value={values.unitPrice}
          required
          fullWidth
          disabled={isLocked}
          error={isInvalid("unitPrice")}
          slotProps={{
            htmlInput: { inputMode: "numeric", list: priceListId },
          }}
          onChange={(event) => {
            change("unitPrice", event.target.value);
          }}
        />
        {/* 可輸入的下拉:預設面額 + 自填(原生 datalist) */}
        <datalist id={priceListId}>
          {STANDARD_UNIT_PRICES.map((price) => (
            <option key={price} value={price} />
          ))}
        </datalist>
      </Box>
      <TextField
        label={t("fields.ticketsPerBook")}
        value={values.ticketsPerBook}
        required
        disabled={isLocked}
        error={isInvalid("ticketsPerBook")}
        {...(ticketsHint === undefined ? {} : { helperText: ticketsHint })}
        slotProps={{ htmlInput: { inputMode: "numeric" } }}
        onChange={(event) => {
          change("ticketsPerBook", event.target.value);
        }}
      />
      <TextField label={t("fields.bookPrice")} value={bookPrice} disabled />
      <TextField
        label={t("fields.defaultRate")}
        value={values.defaultRate}
        required
        error={isInvalid("defaultRate")}
        slotProps={{ htmlInput: { inputMode: "numeric" } }}
        onChange={(event) => {
          change("defaultRate", event.target.value);
        }}
      />
      {dateField("launchedAt")}
      {dateField("discontinuedAt")}
      {dateField("claimDeadline")}
    </Box>
  );
};
