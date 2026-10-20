import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { WrongStoreInfo } from "./receive-error";

export interface WrongStoreDialogProps {
  info: WrongStoreInfo;
  isNotifying: boolean;
  /** [知道了]:不記錄任何東西(書由送貨人帶走,那家店照常點收) */
  onClose: () => void;
  /** [通知總部更正]:單子寫錯(這本其實是給本店)時,通知那張進貨單的建立者 */
  onNotify: () => void;
}

/**
 * 送錯分店(專案規格 8.2「錯誤情境」;Figma PU-11 電腦 127:2993、平板 127:26671、手機小視窗 209:27875):
 * 擋下、不入庫,提示這本屬於哪家店的進貨單,請交給送貨人帶過去。
 */
export const WrongStoreDialog = ({
  info,
  isNotifying,
  onClose,
  onNotify,
}: WrongStoreDialogProps) => {
  const t = useTranslations("admin.lotteryPurchasing.receive.wrongStore");
  return (
    <Dialog
      open
      title={t("title")}
      onClose={onClose}
      maxWidth="xs"
      actions={
        <Stack
          direction="row"
          spacing={1}
          sx={{ width: "100%", justifyContent: "space-between" }}
        >
          <Button variant="outlined" disabled={isNotifying} onClick={onNotify}>
            {t("notify")}
          </Button>
          <Button onClick={onClose}>{t("ok")}</Button>
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
              <Typography variant="body2" color="text.secondary">
                {t("unitPrice", { price: info.unitPrice })}
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
