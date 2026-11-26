import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface OpeningConfirmDialogProps {
  /** 本的顯示鍵(遊戲代號-本號) */
  bookKey: string;
  /** 合計(同本卡) */
  summary: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** 建檔確認框(Figma OP-03;規格 3.1):寫出合計,勾「我已對過實體」才能 [建檔]。 */
export const OpeningConfirmDialog = ({
  bookKey,
  summary,
  isPending,
  onClose,
  onConfirm,
}: OpeningConfirmDialogProps) => {
  const t = useTranslations("admin.lotteryInventory.opening.confirm");
  const [isChecked, setIsChecked] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      title={t("title", { key: bookKey })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!isChecked || isPending} onClick={onConfirm}>
            {t("submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <Typography variant="body1">{summary}</Typography>
        <Typography variant="body2" color="textSecondary">
          {t("note")}
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={isChecked}
              onChange={(_event, checked) => {
                setIsChecked(checked);
              }}
            />
          }
          label={t("checked")}
        />
      </Stack>
    </Dialog>
  );
};
