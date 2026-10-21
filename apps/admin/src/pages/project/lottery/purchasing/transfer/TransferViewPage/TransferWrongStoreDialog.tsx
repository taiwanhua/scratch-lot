import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { TransferWrongStoreInfo } from "./transfer-receive-error";

export interface TransferWrongStoreDialogProps {
  info: TransferWrongStoreInfo;
  /** [知道了]:不記錄任何東西(書由送貨人帶走,那家店照常點收) */
  onClose: () => void;
}

/**
 * 調貨點收刷到送往別家店的本(規格 8.4「送錯分店同進貨單」;版面同進貨單 PU-11):擋下、不入庫,
 * 提示這本屬於哪家店的調貨單,請交給送貨人帶過去。
 */
export const TransferWrongStoreDialog = ({
  info,
  onClose,
}: TransferWrongStoreDialogProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.wrongStore");
  const tShared = useTranslations("admin.lotteryPurchasing.receive.wrongStore");
  return (
    <Dialog
      open
      title={tShared("title")}
      onClose={onClose}
      maxWidth="xs"
      actions={<Button onClick={onClose}>{tShared("ok")}</Button>}
    >
      <Stack spacing={1.5}>
        <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: "baseline" }}>
            <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700 }}>
              {info.gameName}
            </Typography>
            {info.unitPrice !== null && (
              <Typography variant="body2" color="text.secondary">
                {tShared("unitPrice", { price: info.unitPrice })}
              </Typography>
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t("facts", {
              bookNo: info.bookNo,
              serialNo: info.serialNo,
              branch: info.ownerBranchName,
            })}
          </Typography>
        </Box>
        <Alert severity="warning">
          {t("message", {
            branch: info.ownerBranchName,
            serialNo: info.serialNo,
          })}
        </Alert>
      </Stack>
    </Dialog>
  );
};
