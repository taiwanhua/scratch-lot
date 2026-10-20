import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type ScheduleRuleDefinition,
  hasRuleLevel,
  isScheduleRuleToggleable,
  scheduleRuleValueErrors,
} from "@repo/domain/project/schedule-settings";
import {
  ScheduleRuleSource,
  type ScheduleRulesFieldsFragment,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import type { ScheduleFieldOption } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";

import { RuleValueEditor } from "./RuleValueEditor";

type RuleRow = ScheduleRulesFieldsFragment["items"][number];

export interface RuleDialogSave {
  enabled: boolean;
  value: Record<string, unknown>;
  level: string | null;
  order: number;
}

export interface RuleDialogProps {
  rule: RuleRow;
  definition: ScheduleRuleDefinition;
  /** 規則名稱(i18n) */
  label: string;
  /** 「目前:本店自訂 6 天 · 上層(租戶甲):7 天」 */
  currentText: string;
  canEdit: boolean;
  isPending: boolean;
  weekTemplates: readonly { id: string; name: string }[];
  taskOptions: readonly ScheduleFieldOption[];
  onSave: (save: RuleDialogSave) => void;
  onRestore: () => void;
  onClose: () => void;
}

/**
 * 規則編輯對話框(SC-27;規格 14.2):值、違反時的等級(限制 / 提醒)、檢核清單排序。
 * 開啟時帶入目前的生效值;儲存 = [自訂](本層寫一筆)。本層已自訂時左下角 [還原成沿用]。
 * 沒有改這個組織規則的權限時欄位停用、只剩 [關閉]。手機全螢幕。
 */
export const RuleDialog = ({
  rule,
  definition,
  label,
  currentText,
  canEdit,
  isPending,
  weekTemplates,
  taskOptions,
  onSave,
  onRestore,
  onClose,
}: RuleDialogProps) => {
  const t = useTranslations("admin.schedule.rules.dialog");
  const tCommon = useTranslations("admin.schedule.common");
  const isMobile = useBreakpointDown("sm");
  const [value, setValue] = useState<Record<string, unknown>>(
    () => rule.effective.value,
  );
  const [enabled, setEnabled] = useState(rule.effective.enabled);
  const [level, setLevel] = useState(rule.effective.level ?? null);
  const [order, setOrder] = useState(String(rule.effective.order));
  const [invalid, setInvalid] = useState<string[]>([]);
  const withLevel = hasRuleLevel(definition);
  const isOwn = rule.effective.source === ScheduleRuleSource.Own;

  const submit = () => {
    const errors = scheduleRuleValueErrors(definition, value);
    const orderNumber = Number(order);
    if (!Number.isInteger(orderNumber) || orderNumber < 0) {
      errors.push("order");
    }
    setInvalid(errors);
    if (errors.length > 0) {
      return;
    }
    onSave({
      enabled,
      value,
      level: withLevel ? level : null,
      order: orderNumber,
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("title", { label })}
      actions={
        canEdit ? (
          <>
            {isOwn && (
              <Button
                variant="text"
                sx={{ mr: "auto" }}
                disabled={isPending}
                onClick={onRestore}
              >
                {t("restore")}
              </Button>
            )}
            <Button variant="text" onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button disabled={isPending} onClick={submit}>
              {tCommon("save")}
            </Button>
          </>
        ) : (
          <Button variant="text" onClick={onClose}>
            {tCommon("close")}
          </Button>
        )
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <RuleValueEditor
          definition={definition}
          value={value}
          invalid={invalid}
          disabled={!canEdit}
          weekTemplates={weekTemplates}
          taskOptions={taskOptions}
          onChange={(next) => {
            setValue(next);
            setInvalid([]);
          }}
        />
        {definition.group === "rule" &&
          isScheduleRuleToggleable(definition) && (
            <FormControlLabel
              label={t("enabled")}
              disabled={!canEdit}
              control={
                <Switch
                  checked={enabled}
                  onChange={(_event, checked) => {
                    setEnabled(checked);
                  }}
                />
              }
            />
          )}
        {withLevel && (
          <>
            <Typography variant="subtitle2">{t("level")}</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              {(["limit", "reminder"] as const).map((option) => (
                <FormControlLabel
                  key={option}
                  label={
                    option === "limit" ? t("levelLimit") : t("levelReminder")
                  }
                  disabled={!canEdit}
                  control={
                    <Radio
                      checked={level === option}
                      onChange={() => {
                        setLevel(option);
                      }}
                    />
                  }
                />
              ))}
            </Stack>
            <TextField
              label={t("order")}
              type="number"
              value={order}
              fullWidth
              disabled={!canEdit}
              error={invalid.includes("order")}
              onChange={(event) => {
                setOrder(event.target.value);
                setInvalid([]);
              }}
            />
          </>
        )}
        <Typography variant="caption" color="text.secondary">
          {t("current", { summary: currentText })}
        </Typography>
      </Stack>
    </Dialog>
  );
};
