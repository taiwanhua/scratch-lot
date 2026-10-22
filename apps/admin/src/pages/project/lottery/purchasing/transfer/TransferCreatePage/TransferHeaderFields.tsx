import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";

import {
  type FieldErrorSource,
  fieldErrorProps,
} from "../../shared/field-errors";
import { TRANSFER_FIELD_KEYS as K } from "../transfer-keys";
import type { TransferOptions } from "./transfer-form";

const NONE = "none";

export interface TransferHeaderFieldsProps {
  fromBranchId: string;
  toBranchId: string;
  requisitionNo: string | null;
  note: string;
  /** 收貨店待購買的叫貨單 */
  requisitions: TransferOptions["requisitions"];
  onFromBranch: (branchId: string) => void;
  onToBranch: (branchId: string) => void;
  onRequisition: (serialNo: string | null) => void;
  onNote: (note: string) => void;
  /** 送出 / 存草稿失敗的錯誤(`useFormDraft().error`;欄位錯誤標在對應欄位) */
  error: FieldErrorSource;
}

/**
 * 調貨單新增頁的單頭(規格 8.4「單頭」;Figma PU-09):出貨分店、收貨分店(不能相同;選不到時的說明)、
 * 叫貨單(收貨店待購買的)、備註。必填照受管表單(出貨分店、收貨分店);api 回的欄位錯誤標在對應欄位。
 */
export const TransferHeaderFields = ({
  fromBranchId,
  toBranchId,
  requisitionNo,
  note,
  requisitions,
  onFromBranch,
  onToBranch,
  onRequisition,
  onNote,
  error,
}: TransferHeaderFieldsProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  const isSameBranch = fromBranchId !== "" && fromBranchId === toBranchId;
  return (
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
        label={t("fields.fromBranch")}
        size="small"
        value={fromBranchId === "" ? [] : [fromBranchId]}
        required
        fullWidth
        {...fieldErrorProps(error, K.fromBranch)}
        onChange={(ids) => {
          onFromBranch(ids[0] ?? "");
        }}
      />
      <OrgTreeSelect
        scope="visible"
        label={t("fields.toBranch")}
        size="small"
        value={toBranchId === "" ? [] : [toBranchId]}
        required
        fullWidth
        {...(isSameBranch
          ? { error: true, helperText: t("sameBranch") }
          : fieldErrorProps(error, K.toBranch, t("toBranchHint")))}
        onChange={(ids) => {
          onToBranch(ids[0] ?? "");
        }}
      />
      <SelectField<string>
        label={t("fields.requisition")}
        size="small"
        value={
          requisitions.find((item) => item.serialNo === requisitionNo)?.id ??
          NONE
        }
        disabled={toBranchId === ""}
        options={[
          { value: NONE, label: t("fields.noRequisition") },
          ...requisitions.map((item) => ({
            value: item.id,
            label: t("fields.requisitionOption", {
              serialNo: item.serialNo ?? item.id,
              books: item.books,
            }),
          })),
        ]}
        onChange={(next) => {
          onRequisition(
            requisitions.find((item) => item.id === next)?.serialNo ?? null,
          );
        }}
        fullWidth
        {...fieldErrorProps(error, K.requisition)}
      />
      <TextField
        label={t("fields.note")}
        size="small"
        value={note}
        onChange={(event) => {
          onNote(event.target.value);
        }}
        fullWidth
        {...fieldErrorProps(error, K.note)}
      />
    </Box>
  );
};
