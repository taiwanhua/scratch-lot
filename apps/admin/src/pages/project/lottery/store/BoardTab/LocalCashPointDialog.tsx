import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Typography } from "@repo/ui/typography";

export interface LocalCashPointDialogProps {
  cashPoints: readonly { id: string; name: string }[];
  /** 目前的本機收銀點;沒設定 = null(預選第一個) */
  value: string | null;
  onClose: () => void;
  onSave: (cashPointId: string) => void;
}

/** 設定本機收銀點(專案規格 5.5;Figma ST-03 87:1756):這台裝置在哪個收銀點收錢,存在這台瀏覽器。 */
export const LocalCashPointDialog = ({
  cashPoints,
  value,
  onClose,
  onSave,
}: LocalCashPointDialogProps) => {
  const t = useTranslations("admin.lotteryStore.localDialog");
  const [selected, setSelected] = useState(value ?? cashPoints.at(0)?.id ?? "");
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={selected === ""}
            onClick={() => {
              onSave(selected);
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t("description")}
      </Typography>
      <RadioGroup
        value={selected}
        onChange={(event) => {
          setSelected(event.target.value);
        }}
      >
        {cashPoints.map((point) => (
          <FormControlLabel
            key={point.id}
            value={point.id}
            control={<Radio />}
            label={point.name}
          />
        ))}
      </RadioGroup>
    </Dialog>
  );
};
