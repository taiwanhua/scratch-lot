import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type LotteryCashPointFieldsFragment,
  useLotteryPositionOptionsQuery,
  usePrintablePrintersQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { TextField } from "@repo/ui/text-field";

import { useSession } from "@/hooks/base/useSession";

import type { MasterDataAccess } from "../useMasterDataAccess";
import { type CashPointFormField, useCashPointForm } from "./useCashPointForm";

export interface CashPointDialogProps {
  /** 要編輯的那一筆;null = 新增 */
  cashPoint: LotteryCashPointFieldsFragment | null;
  /** 分店選單(管理範圍 + 所屬組織) */
  orgOptions: readonly { value: string; label: string }[];
  /** 新增時預設的分店(當前組織) */
  defaultOrgId: string;
  access: MasterDataAccess;
  onClose: () => void;
}

/** 印表機選單的「用分店預設」(空字串)。 */
const DEFAULT_PRINTER = "";

/**
 * 新增 / 編輯收銀點(Figma MD-05 97:1367;手機全螢幕,RW-04):
 * 分店 → 對應崗位(必填;選了自動帶入名稱,可改)→ 名稱 → 排序 + 印表機 → 啟用(只有編輯有)→ 備註。
 * 編輯時不能換分店。崗位選單底部「找不到?到欄位管理新增」只在有欄位管理時出現。
 */
export const CashPointDialog = ({
  cashPoint,
  orgOptions,
  defaultOrgId,
  access,
  onClose,
}: CashPointDialogProps) => {
  const t = useTranslations("admin.lotteryMasterData.cashPointForm");
  const tErrors = useTranslations("admin.lotteryMasterData.errors");
  const { session } = useSession();
  const navigate = useNavigate();
  const isMobile = useBreakpointDown("sm");
  const form = useCashPointForm(cashPoint, defaultOrgId, onClose);
  const { values, change } = form;
  const isEditing = cashPoint !== null;
  const isInvalid = (field: CashPointFormField) =>
    form.invalidFields.includes(field);

  const positions = useLotteryPositionOptionsQuery(
    session.client,
    { orgId: values.orgId },
    { enabled: values.orgId !== "" },
  );
  const positionOptions = positions.data?.lotteryPositionOptions.items ?? [];
  const printers = usePrintablePrintersQuery(
    session.client,
    { orgId: values.orgId },
    { enabled: access.canPickPrinter && values.orgId !== "" },
  );
  const printerOptions = [
    { value: DEFAULT_PRINTER, label: t("printerDefault") },
    ...(printers.data?.printablePrinters.items ?? []).map((printer) => ({
      value: printer.id,
      label: printer.name,
    })),
  ];

  const labelOf = (value: string) =>
    positionOptions.find((option) => option.value === value)?.label ?? "";

  /** 選崗位:名稱還是空的、或還是上一個崗位的名稱 → 帶入新崗位的名稱。 */
  const choosePosition = (value: string) => {
    const previous = labelOf(values.positionKey);
    change("positionKey", value);
    if (values.name.trim() === "" || values.name === previous) {
      change("name", labelOf(value));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      fullScreen={isMobile}
      title={isEditing ? t("editTitle") : t("createTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={form.submit} disabled={form.isSubmitting}>
            {t("save")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        {form.errorCode !== null && (
          <Alert severity="error">{tErrors(form.errorCode)}</Alert>
        )}
        <SelectField
          label={t("fields.orgId")}
          value={values.orgId}
          options={orgOptions}
          disabled={isEditing}
          required
          error={isInvalid("orgId")}
          {...(isEditing ? { helperText: t("orgFixed") } : {})}
          onChange={(value) => {
            change("orgId", value);
            change("positionKey", "");
            change("printerId", DEFAULT_PRINTER);
          }}
        />
        <Stack spacing={0.5}>
          <SelectField
            label={t("fields.positionKey")}
            value={values.positionKey}
            options={positionOptions}
            required
            error={isInvalid("positionKey")}
            onChange={choosePosition}
          />
          {access.fieldManagerRoute !== null && (
            <Button
              variant="text"
              size="small"
              sx={{ alignSelf: "flex-start" }}
              onClick={() => {
                if (access.fieldManagerRoute !== null) {
                  void navigate(access.fieldManagerRoute);
                }
              }}
            >
              {t("positionMissing")}
            </Button>
          )}
        </Stack>
        <TextField
          label={t("fields.name")}
          value={values.name}
          required
          error={isInvalid("name")}
          onChange={(event) => {
            change("name", event.target.value);
          }}
        />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            label={t("fields.order")}
            type="number"
            value={values.order}
            error={isInvalid("order")}
            onChange={(event) => {
              change("order", event.target.value);
            }}
            sx={{ flex: 1 }}
          />
          {access.canPickPrinter && (
            <SelectField
              label={t("fields.printerId")}
              value={values.printerId}
              options={printerOptions}
              displayEmpty
              error={isInvalid("printerId")}
              onChange={(value) => {
                change("printerId", value);
              }}
              sx={{ flex: 1 }}
            />
          )}
        </Stack>
        {isEditing && (
          <FormControlLabel
            control={
              <Switch
                checked={values.enabled}
                onChange={(_event, checked) => {
                  change("enabled", checked);
                }}
              />
            }
            label={t("fields.enabled")}
          />
        )}
        <TextField
          label={t("fields.note")}
          value={values.note}
          multiline
          minRows={2}
          error={isInvalid("note")}
          onChange={(event) => {
            change("note", event.target.value);
          }}
        />
      </Stack>
    </Dialog>
  );
};
