import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import type { ReprintVariants } from "./ReprintDialog";

export interface PrintVariantDialogProps {
  /** 使用處給的列印選項(例:多聯單據印哪一聯);第一個是預設 */
  variants: ReprintVariants;
  onCancel: () => void;
  onSubmit: (variant: string) => void;
}

/**
 * 第一次列印前選使用處的選項(`PrintButton` 的 `printVariants`;例:多聯單據「印哪一聯」):
 * 只有一個選單,預設第一個選項,沒有原因。關閉即卸載(REACT-08),每次開啟都回到預設。
 */
export const PrintVariantDialog = ({
  variants,
  onCancel,
  onSubmit,
}: PrintVariantDialogProps) => {
  const t = useTranslations("admin.printButton.printDialog");
  const [variant, setVariant] = useState(variants.options.at(0)?.value ?? "");

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            disabled={variant === ""}
            onClick={() => {
              onSubmit(variant);
            }}
          >
            {t("submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <SelectField
          label={variants.label}
          required
          fullWidth
          value={variant}
          options={variants.options.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
          onChange={setVariant}
        />
      </Stack>
    </Dialog>
  );
};
