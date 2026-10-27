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
  isNotifying: boolean;
  /** [知道了]:不記錄任何東西(書由送貨人帶走,那家店照常點收) */
  onClose: () => void;
  /** [通知總部更正]:單子寫錯(這本其實是給本店)時,通知那張調貨單的建立者 */
  onNotify: () => void;
}

/**
 * 調貨點收刷到送往別家店的本(規格 8.4「送錯分店同進貨單」;版面同進貨單 PU-11):擋下、不入庫,
 * 提示這本屬於哪家店的調貨單,請交給送貨人帶過去;[通知總部更正] 通知那張調貨單的建立者。
 */
export const TransferWrongStoreDialog = ({
  info,
  isNotifying,
  onClose,
  onNotify,
}: TransferWrongStoreDialogProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.wrongStore");
  const tShared = useTranslations("admin.lotteryPurchasing.receive.wrongStore");
  return (
    <Dialog
      open
      title={tShared("title")}
      onClose={onClose}
      maxWidth="xs"
      actions={
        <Stack
          direction="row"
          spacing={1}
          sx={{ width: "100%", justifyContent: "space-between" }}
        >
          <Button variant="outlined" disabled={isNotifying} onClick={onNotify}>
            {tShared("notify")}
          </Button>
          <Button onClick={onClose}>{tShared("ok")}</Button>
        </Stack>
      }
    >
      <Stack spacing={1.5}>
        <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: "baseline" }}>
            <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700 }}>
              {info.gameName}
            </Typography>
            {info.unitPrice !== null && (
              <Typography variant="body2" color="textSecondary">
                {tShared("unitPrice", { price: info.unitPrice })}
              </Typography>
            )}
          </Stack>
          <Typography variant="body2" color="textSecondary">
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
