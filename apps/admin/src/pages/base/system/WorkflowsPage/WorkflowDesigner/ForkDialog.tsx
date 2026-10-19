import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

const BRANCH_COUNTS = [2, 3, 4, 5] as const;

export interface ForkDialogProps {
  stepName: string;
  onCancel: () => void;
  onConfirm: (branchCount: number) => void;
}

/**
 * 從此關分流:這一關完成後同時啟動 N 條分支(每條先有一關,之後可在分支內再加),
 * 全部通過才會在匯合節點會合(匯合固定「全部分支通過」)。
 */
export const ForkDialog = ({
  stepName,
  onCancel,
  onConfirm,
}: ForkDialogProps) => {
  const t = useTranslations("admin.workflows.forkDialog");
  const [count, setCount] = useState("2");

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t("title", { step: stepName })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => {
              onConfirm(Number(count));
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">{t("body")}</Typography>
        <SelectField
          label={t("count")}
          value={count}
          size="small"
          options={BRANCH_COUNTS.map((value) => ({
            value: String(value),
            label: t("countOption", { count: value }),
          }))}
          onChange={setCount}
        />
      </Stack>
    </Dialog>
  );
};
