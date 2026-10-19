import { useTranslations } from "use-intl";

import { Dialog } from "@repo/ui/dialog";

import { useMultiTabSession } from "./useMultiTabSession";

/**
 * 換帳號時的不可關閉提示:別的分頁登入了另一個帳號,本分頁清掉狀態、告知一聲,隨即切成新帳號。
 * 沒有關閉鈕,也不接 `onClose` —— Esc 與點外框都走 `onClose`,沒接就關不掉;舊帳號的畫面已經作廢,
 * 關掉它只會讓人以為還在用原帳號。
 */
export const MultiTabSession = () => {
  const t = useTranslations("admin.session");
  const { switchingTo } = useMultiTabSession();

  return (
    <Dialog open={switchingTo !== null} title={t("switchedTabTitle")}>
      {switchingTo === null ? null : t("switchedTab", { name: switchingTo })}
    </Dialog>
  );
};
