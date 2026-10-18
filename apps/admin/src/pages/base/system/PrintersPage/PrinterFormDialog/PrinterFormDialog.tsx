import { useTranslations } from "use-intl";

import { PRINTER_PAPER_WIDTHS } from "@repo/domain/printing";
import type { PrinterFieldsFragment } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import type { PrintersLookups } from "../usePrintersLookups";
import { type PrinterFormField, usePrinterForm } from "./usePrinterForm";

export interface PrinterFormDialogProps {
  /** 要編輯的那一台;null = 新增 */
  printer: PrinterFieldsFragment | null;
  lookups: PrintersLookups;
  onClose: () => void;
}

/**
 * 新增 / 編輯印表機:所屬組織 → 名稱 → IP 位址 + Port → 代理程式 → 紙寬 →
 * 「設為這個組織的預設印表機」→ 啟用(只有編輯有:新增的一律啟用)。
 *
 * 印表機的分店 = 代理程式的分店:「所屬組織」只列有啟用中代理程式的組織,選了才列那個組織的代理程式;
 * 編輯時不能換組織(api 只允許改掛同分店的代理程式)。
 */
export const PrinterFormDialog = ({
  printer,
  lookups,
  onClose,
}: PrinterFormDialogProps) => {
  const t = useTranslations("admin.printers.printerForm");
  const tAgent = useTranslations("admin.printers.agentStatus");
  const { values, change, invalidFields, isSubmitting, submit } =
    usePrinterForm(printer, onClose);
  const isEditing = printer !== null;
  const isInvalid = (field: PrinterFormField) => invalidFields.includes(field);

  const enabledAgents = lookups.agents.filter((agent) => agent.enabled);
  const agentOrgIds = new Set(enabledAgents.map((agent) => agent.orgId));
  const orgOptions = lookups.orgs
    .filter((org) => agentOrgIds.has(org.id) || org.id === values.orgId)
    .map((org) => ({ value: org.id, label: org.path }));
  const agentOptions = enabledAgents
    .filter((agent) => agent.orgId === values.orgId)
    .map((agent) => ({
      value: agent.id,
      label: `${agent.name} · ${tAgent(agent.online ? "online" : "offline")}`,
    }));

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={isEditing ? t("editTitle") : t("createTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => {
              void submit();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <SelectField
          label={t("org")}
          value={values.orgId}
          options={orgOptions}
          required
          fullWidth
          disabled={isEditing}
          error={isInvalid("orgId")}
          helperText={orgOptions.length === 0 ? t("noAgentOrg") : t("orgHint")}
          onChange={(next) => {
            change("orgId", next);
          }}
        />
        <TextField
          label={t("name")}
          value={values.name}
          required
          fullWidth
          error={isInvalid("name")}
          helperText={isInvalid("name") ? t("required") : undefined}
          onChange={(event) => {
            change("name", event.target.value);
          }}
        />
        <Stack direction="row" spacing={1.5}>
          <TextField
            label={t("host")}
            value={values.host}
            required
            fullWidth
            error={isInvalid("host")}
            helperText={isInvalid("host") ? t("hostInvalid") : undefined}
            onChange={(event) => {
              change("host", event.target.value);
            }}
          />
          <TextField
            label={t("port")}
            value={values.port}
            required
            fullWidth
            error={isInvalid("port")}
            helperText={isInvalid("port") ? t("portInvalid") : undefined}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
            onChange={(event) => {
              change("port", event.target.value);
            }}
          />
        </Stack>
        <SelectField
          label={t("agent")}
          value={values.agentId}
          options={agentOptions}
          required
          fullWidth
          disabled={values.orgId === ""}
          error={isInvalid("agentId")}
          helperText={isInvalid("agentId") ? t("required") : undefined}
          onChange={(next) => {
            change("agentId", next);
          }}
        />
        <SelectField
          label={t("paperWidth")}
          value={String(values.paperWidth)}
          options={PRINTER_PAPER_WIDTHS.map((width) => ({
            value: String(width),
            label: t("paperWidthMm", { width }),
          }))}
          fullWidth
          // 底座只支援 58mm(只有一個選項,先顯示不給選);編輯時 api 也不收紙寬
          disabled
          onChange={(next) => {
            change("paperWidth", Number(next));
          }}
        />
        <Stack spacing={1}>
          <FormControlLabel
            label={t("isDefault")}
            control={
              <Checkbox
                checked={values.isDefault}
                onChange={(_event, checked) => {
                  change("isDefault", checked);
                }}
              />
            }
          />
          {isEditing && (
            <FormControlLabel
              label={t("enabled")}
              control={
                <Switch
                  checked={values.enabled}
                  onChange={(_event, checked) => {
                    change("enabled", checked);
                  }}
                />
              }
            />
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t("fixedIpHint")}
        </Typography>
      </Stack>
    </Dialog>
  );
};
