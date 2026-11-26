import { useTranslations } from "use-intl";

import { displayBookKey } from "@repo/domain/project/lottery";
import {
  type LotteryStoreOpeningFieldsFragment,
  useVoidLotteryOpeningBookMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { useOpeningErrorText } from "./useOpeningErrorText";
import { useRefreshOpening } from "./useRefreshOpening";

export interface OpeningVoidDialogProps {
  book: LotteryStoreOpeningFieldsFragment["books"][number];
  onClose: () => void;
}

/**
 * 作廢這本確認框(Figma OP-05;期初建檔規格 E4):作廢後本號可以重新建檔。別人剛動過這本(api 擋下)→
 * 提示請用期初更正並重新讀清單。
 */
export const OpeningVoidDialog = ({
  book,
  onClose,
}: OpeningVoidDialogProps) => {
  const t = useTranslations("admin.lotteryInventory.opening.void");
  const { session } = useSession();
  const errorText = useOpeningErrorText();
  const refresh = useRefreshOpening();
  const bookKey = displayBookKey(book.gameCode, book.bookNo);
  const voidBook = useVoidLotteryOpeningBookMutation(
    session.client,
    useMutationFeedback({
      success: t("success", { key: bookKey }),
      error: errorText,
      onSuccess: () => {
        refresh();
        onClose();
      },
      onError: () => {
        refresh();
        onClose();
      },
    }),
  );
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
          <Button
            color="error"
            disabled={voidBook.isPending}
            onClick={() => {
              voidBook.mutate({ bookId: book.bookId });
            }}
          >
            {t("submit")}
          </Button>
        </>
      }
    >
      <Typography variant="body1">{t("body")}</Typography>
    </Dialog>
  );
};
