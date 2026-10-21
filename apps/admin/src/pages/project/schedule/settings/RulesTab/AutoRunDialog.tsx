import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface AutoRunCondition {
  key: string;
  label: string;
  enabled: boolean;
}

export interface AutoRunDialogProps {
  /** 依目前的順序 */
  conditions: readonly AutoRunCondition[];
  isOwn: boolean;
  canEdit: boolean;
  isPending: boolean;
  onSave: (conditions: AutoRunCondition[]) => void;
  onRestore: () => void;
  onClose: () => void;
}

const moved = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) {
    next.splice(to, 0, item);
  }
  return next;
};

const checkedAt = (
  list: readonly AutoRunCondition[],
  key: string,
  enabled: boolean,
): AutoRunCondition[] =>
  list.map((entry) => (entry.key === key ? { ...entry, enabled } : entry));

/**
 * 自動排班條件(整組;規格 14.2、14.5):勾選要用的條件、調整順序(勾選的條件依順序比較候選人)。
 * 儲存 = 整組變本層自訂;[還原成沿用] = 整組回到沿用。
 */
export const AutoRunDialog = ({
  conditions,
  isOwn,
  canEdit,
  isPending,
  onSave,
  onRestore,
  onClose,
}: AutoRunDialogProps) => {
  const t = useTranslations("admin.schedule.rules.autoRunDialog");
  const tDialog = useTranslations("admin.schedule.rules.dialog");
  const tCommon = useTranslations("admin.schedule.common");
  const isMobile = useBreakpointDown("sm");
  const [items, setItems] = useState(() => [...conditions]);

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("title")}
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
                {tDialog("restore")}
              </Button>
            )}
            <Button variant="text" onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={isPending}
              onClick={() => {
                onSave(items);
              }}
            >
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
      <Stack spacing={1} sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {t("hint")}
        </Typography>
        {items.map((item, index) => (
          <Stack
            key={item.key}
            direction="row"
            spacing={1}
            sx={{ alignItems: "center" }}
          >
            <FormControlLabel
              sx={{ flex: 1 }}
              label={`${String(index + 1)}. ${item.label}`}
              disabled={!canEdit}
              control={
                <Checkbox
                  checked={item.enabled}
                  onChange={(_event, checked) => {
                    setItems((current) =>
                      checkedAt(current, item.key, checked),
                    );
                  }}
                />
              }
            />
            {canEdit && (
              <>
                <Button
                  variant="text"
                  size="small"
                  disabled={index === 0}
                  aria-label={t("moveUp", { label: item.label })}
                  onClick={() => {
                    setItems((current) => moved(current, index, index - 1));
                  }}
                >
                  ↑
                </Button>
                <Button
                  variant="text"
                  size="small"
                  disabled={index === items.length - 1}
                  aria-label={t("moveDown", { label: item.label })}
                  onClick={() => {
                    setItems((current) => moved(current, index, index + 1));
                  }}
                >
                  ↓
                </Button>
              </>
            )}
          </Stack>
        ))}
      </Stack>
    </Dialog>
  );
};
