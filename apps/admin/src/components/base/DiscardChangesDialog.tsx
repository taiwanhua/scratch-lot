import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

export interface DiscardChangesDialogProps {
  /**
   * 文案所在的 i18n 節點(I18N-02),底下要有 `title` / `body` / `keepEditing` / `confirm`
   * 四個 key。**文案由各頁自己寫** —— 「離開」在角色管理是切頁籤、在示範表單是回列表,
   * 講清楚會失去什麼才有意義,所以這個元件不內建文案。
   */
  namespace: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 放棄未儲存的變更(Figma 70:209 的 `Draft/ConfirmDialog`)。
 *
 * 跨路由群組共用(STRUCT-03):角色管理的權限矩陣與示範家族的表單頁都用這一份
 * (#321 之前各有一份)。關分頁 / 重新整理那一層由 `hooks/base/useUnsavedGuard` 接,
 * 頁面攔不到瀏覽器自己的提示。
 *
 * 確認鈕是 error 色:按下去就丟資料,是破壞性操作。
 */
export const DiscardChangesDialog = ({
  namespace,
  onCancel,
  onConfirm,
}: DiscardChangesDialogProps) => {
  const t = useTranslations(namespace);

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
            {t("keepEditing")}
          </Button>
          <Button color="error" onClick={onConfirm}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Typography variant="body2">{t("body")}</Typography>
    </Dialog>
  );
};
