import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { DatePicker } from "@repo/ui/date-picker";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";

import type { PurchaseOptions } from "./purchase-form";

const NONE = "none";

/** 單頭的畫面狀態(批購日期是選擇器的 `YYYY-MM-DD`)。 */
export interface PurchaseHeaderDraft {
  branchId: string;
  requisitionNo: string | null;
  dealerId: string | null;
  selfPurchase: boolean;
  trusteeId: string | null;
  purchaseDay: string | null;
  accountId: string | null;
  note: string;
}

export interface PurchaseHeaderFieldsProps {
  value: PurchaseHeaderDraft;
  options: PurchaseOptions | null;
  onChange: (patch: Partial<PurchaseHeaderDraft>) => void;
  /** 換了進貨分店(叫貨單、扣款帳戶、已刷的本要清掉) */
  onBranchChange: (branchId: string) => void;
}

/**
 * 進貨單新增頁的單頭(規格 8.2「單頭」;Figma PU-05):進貨分店(可見分店)、叫貨單(這家店待購買的)、
 * 批購甲類(營業中)、本人批購、批購受託人(本人批購 = 否時選這位甲類的受託人)、批購日期(預設今天)、
 * 扣款帳戶(使用中、使用組織包含進貨分店;只有一個時自動帶入)、備註。兌獎欄由兌獎的功能加。
 */
export const PurchaseHeaderFields = ({
  value,
  options,
  onChange,
  onBranchChange,
}: PurchaseHeaderFieldsProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.create");
  const noBranch = value.branchId === "";
  const select = (
    label: string,
    current: string | null,
    items: readonly { id: string; label: string }[],
    onPick: (next: string | null) => void,
    extra: { disabled?: boolean; noneLabel: string },
  ) => (
    <SelectField<string>
      label={label}
      size="small"
      value={current ?? NONE}
      disabled={extra.disabled === true || noBranch}
      options={[
        { value: NONE, label: extra.noneLabel },
        ...items.map((item) => ({ value: item.id, label: item.label })),
      ]}
      onChange={(next) => {
        onPick(next === NONE ? null : next);
      }}
      fullWidth
    />
  );
  const requisition =
    options?.requisitions.find(
      (item) => item.serialNo === value.requisitionNo,
    ) ?? null;
  const trustees = (options?.trustees ?? []).filter(
    (item) => item.dealerId === value.dealerId,
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
          label={t("fields.branch")}
          value={noBranch ? [] : [value.branchId]}
          required
          fullWidth
          onChange={(ids) => {
            onBranchChange(ids[0] ?? "");
          }}
        />
        {select(
          t("fields.requisition"),
          requisition?.id ?? null,
          (options?.requisitions ?? []).map((item) => ({
            id: item.id,
            label: item.serialNo ?? item.id,
          })),
          (next) => {
            onChange({
              requisitionNo:
                options?.requisitions.find((item) => item.id === next)
                  ?.serialNo ?? null,
            });
          },
          { noneLabel: t("fields.noRequisition") },
        )}
        {select(
          t("fields.dealer"),
          value.dealerId,
          options?.dealers ?? [],
          (next) => {
            onChange({ dealerId: next, trusteeId: null });
          },
          { noneLabel: t("fields.pick") },
        )}
        <SelectField<string>
          label={t("fields.selfPurchase")}
          size="small"
          value={value.selfPurchase ? "yes" : "no"}
          options={[
            { value: "yes", label: t("fields.yes") },
            { value: "no", label: t("fields.no") },
          ]}
          onChange={(next) => {
            onChange({ selfPurchase: next === "yes" });
          }}
          fullWidth
        />
        {select(
          t("fields.trustee"),
          value.selfPurchase ? null : value.trusteeId,
          trustees,
          (next) => {
            onChange({ trusteeId: next });
          },
          {
            disabled: value.selfPurchase || value.dealerId === null,
            noneLabel: value.selfPurchase
              ? t("fields.trusteeNotNeeded")
              : t("fields.pick"),
          },
        )}
        <DatePicker
          label={t("fields.purchaseDate")}
          value={value.purchaseDay}
          fullWidth
          onChange={(next) => {
            onChange({ purchaseDay: next });
          }}
        />
        {select(
          t("fields.account"),
          value.accountId,
          options?.accounts ?? [],
          (next) => {
            onChange({ accountId: next });
          },
          { noneLabel: t("fields.pick") },
        )}
        <TextField
          label={t("fields.note")}
          size="small"
          value={value.note}
          onChange={(event) => {
            onChange({ note: event.target.value });
          }}
          fullWidth
        />
      </Box>
    </Card>
  );
};
