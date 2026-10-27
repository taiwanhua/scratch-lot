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

import type { FieldErrorTexts } from "@/lib/base/field-errors";

import type {
  GameDerivedDateTexts,
  GameFormField,
  GameFormValues,
} from "./useGameForm";

export interface GameInfoFieldsProps {
  values: GameFormValues;
  /** 上市日 / 停售日(唯讀,由兌獎截止日推算) */
  derivedDates: GameDerivedDateTexts;
  change: <Key extends keyof GameFormValues>(
    key: Key,
    value: GameFormValues[Key],
  ) => void;
  /** 欄位 → 寫在欄位正下方的原因(REACT-18) */
  fieldErrors: FieldErrorTexts<GameFormField>;
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
 * 即時算)、預設批購金額率 / 上市日 / 停售日(唯讀,由兌獎截止日即時推算)、兌獎截止日(必填)。
 * 單張金額是可輸入的下拉(預設面額 + 自填)。非標準組合只提示,不擋。
 */
export const GameInfoFields = ({
  values,
  derivedDates,
  change,
  fieldErrors,
  isLocked,
}: GameInfoFieldsProps) => {
  const t = useTranslations("admin.lotteryMasterData.gameForm");
  const tStatus = useTranslations("admin.lotteryMasterData.status");
  const priceListId = useId();
  const errorText = (field: GameFormField) => fieldErrors[field];
  const isInvalid = (field: GameFormField) => errorText(field) !== undefined;

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

  const derivedDateField = (field: keyof GameDerivedDateTexts) => (
    <DatePicker
      label={t(`fields.${field}`)}
      value={derivedDates[field]}
      helperText={t("derivedDateHint")}
      disabled
      fullWidth
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
        helperText={errorText("gameCode") ?? t("gameCodeHint")}
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
        helperText={errorText("name")}
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
        helperText={errorText("status")}
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
          helperText={errorText("unitPrice")}
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
        helperText={errorText("ticketsPerBook") ?? ticketsHint}
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
        helperText={errorText("defaultRate")}
        slotProps={{ htmlInput: { inputMode: "numeric" } }}
        onChange={(event) => {
          change("defaultRate", event.target.value);
        }}
      />
      {derivedDateField("launchedAt")}
      {derivedDateField("discontinuedAt")}
      <DatePicker
        label={t("fields.claimDeadline")}
        value={values.claimDeadline}
        required
        error={isInvalid("claimDeadline")}
        helperText={errorText("claimDeadline")}
        fullWidth
        onChange={(value) => {
          change("claimDeadline", value);
        }}
      />
    </Box>
  );
};
