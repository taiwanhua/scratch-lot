import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";

import {
  type FieldErrorSource,
  fieldErrorProps,
} from "../../shared/purchasing-field-errors";
import {
  WHOLESALE_FIELD_KEYS as K,
  WHOLESALE_PAYMENT_MODE,
  WHOLESALE_PAYMENT_MODES,
} from "../wholesale-keys";
import type { WholesaleHeaderState, WholesaleOptions } from "./wholesale-form";

const NONE = "none";

export interface WholesaleHeaderFieldsProps {
  value: WholesaleHeaderState;
  options: WholesaleOptions | null;
  onChange: (patch: Partial<WholesaleHeaderState>) => void;
  /** 換了出貨分店(入帳帳戶、明細要清掉) */
  onBranchChange: (branchId: string) => void;
  /** 送出 / 存草稿失敗的錯誤(`useFormDraft().error`;欄位錯誤標在對應欄位) */
  error: FieldErrorSource;
}

/**
 * 批售單新增頁的單頭(規格 21.3「單頭」;Figma WS-02a / WS-02b):出貨分店(可見分店)、批售客戶(往來中,「店名 · 電話」)、
 * 收款方式(預設收到錢再核准)、入帳帳戶(從帳戶入帳才有;使用中、使用組織包含出貨分店)、備註(有入帳帳戶時佔滿一列)。
 */
export const WholesaleHeaderFields = ({
  value,
  options,
  onChange,
  onBranchChange,
  error,
}: WholesaleHeaderFieldsProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale");
  const noBranch = value.fromBranchId === "";
  const isAutoBank = value.paymentMode === WHOLESALE_PAYMENT_MODE.autoBank;
  const reference = (
    fieldKey: string,
    label: string,
    current: string | null,
    items: readonly { id: string; label: string }[],
    onPick: (next: string | null) => void,
  ) => (
    <SelectField<string>
      label={label}
      size="small"
      value={
        items.some((item) => item.id === current) ? (current ?? NONE) : NONE
      }
      disabled={noBranch}
      required
      fullWidth
      options={[
        { value: NONE, label: t("create.fields.pick") },
        ...items.map((item) => ({ value: item.id, label: item.label })),
      ]}
      onChange={(next) => {
        onPick(next === NONE ? null : next);
      }}
      {...fieldErrorProps(error, fieldKey)}
    />
  );
  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "1fr 1fr",
            lg: "repeat(4, 1fr)",
          },
        }}
      >
        <OrgTreeSelect
          scope="visible"
          label={t("create.fields.fromBranch")}
          size="small"
          value={noBranch ? [] : [value.fromBranchId]}
          required
          fullWidth
          {...fieldErrorProps(error, K.fromBranch)}
          onChange={(ids) => {
            onBranchChange(ids[0] ?? "");
          }}
        />
        {reference(
          K.customer,
          t("create.fields.customer"),
          value.customerId,
          options?.customers ?? [],
          (customerId) => {
            onChange({ customerId });
          },
        )}
        <SelectField
          label={t("create.fields.paymentMode")}
          size="small"
          value={value.paymentMode}
          required
          fullWidth
          options={WHOLESALE_PAYMENT_MODES.map((mode) => ({
            value: mode,
            label: t(`paymentModes.${mode}`),
          }))}
          onChange={(paymentMode) => {
            onChange({ paymentMode });
          }}
          {...fieldErrorProps(error, K.paymentMode)}
        />
        {isAutoBank &&
          reference(
            K.account,
            t("create.fields.account"),
            value.accountId,
            options?.accounts ?? [],
            (accountId) => {
              onChange({ accountId });
            },
          )}
        <TextField
          label={t("create.fields.note")}
          size="small"
          value={value.note}
          fullWidth
          sx={isAutoBank ? { gridColumn: "1 / -1" } : {}}
          onChange={(event) => {
            onChange({ note: event.target.value });
          }}
          {...fieldErrorProps(error, K.note)}
        />
      </Box>
    </Card>
  );
};
