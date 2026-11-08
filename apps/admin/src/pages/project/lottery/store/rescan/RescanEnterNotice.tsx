import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { pendingPlaceNamesOf, type rescansToNotice } from "./rescan-model";
import { useRescanText } from "./useRescanText";

export interface RescanEnterNoticeProps {
  /** 要提醒的重刷(`rescansToNotice`);空 = 不開 */
  notices: ReturnType<typeof rescansToNotice>;
  open: boolean;
  onCancel: () => void;
  onContinue: () => void;
}

/**
 * 「遊戲 X 正在全店重刷」(8.5a;Figma ST-16-2):只提醒、不擋 ——「還沒刷完的位置:店外攤位、庫存;這些位置的 X
 * 要等刷完才能數,其他照常盤。」[取消] [繼續盤點]。看板 [盤點] 與交班第 ① 步進入時用。
 */
export const RescanEnterNotice = ({
  notices,
  open,
  onCancel,
  onContinue,
}: RescanEnterNoticeProps) => {
  const { t, gameOf } = useRescanText();
  return (
    <Dialog
      open={open && notices.length > 0}
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t("enterNotice.title", {
        game: notices.map(({ rescan }) => gameOf(rescan)).join("、"),
      })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("enterNotice.cancel")}
          </Button>
          <Button variant="contained" onClick={onContinue}>
            {t("enterNotice.continue")}
          </Button>
        </>
      }
    >
      <Stack spacing={1}>
        {notices.map(({ rescan, places }) => (
          <Typography key={rescan.id} variant="body2" color="textSecondary">
            {t("enterNotice.body", {
              places: pendingPlaceNamesOf(places, t("page.stock")).join("、"),
              code: rescan.gameCode,
            })}
          </Typography>
        ))}
      </Stack>
    </Dialog>
  );
};
