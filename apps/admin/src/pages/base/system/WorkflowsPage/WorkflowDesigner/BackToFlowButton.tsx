import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";

export interface BackToFlowButtonProps {
  /** 取消選取關卡 / 匯合節點,屬性面板回到「整個流程」設定 */
  onBack: () => void;
}

/**
 * 屬性面板頂端的「回到整個流程設定」(2026-10-17 使用者定):選了關卡或匯合節點時,不必找流程圖的空白處,
 * 點這顆(或 Tab 到它按 Enter)就取消選取、回到整個流程的設定(整個流程的知會對象)。
 */
export const BackToFlowButton = ({ onBack }: BackToFlowButtonProps) => {
  const t = useTranslations("admin.workflows.flow");

  return (
    <Button
      size="small"
      variant="text"
      onClick={onBack}
      sx={{ alignSelf: "flex-start" }}
    >
      {t("backToFlow")}
    </Button>
  );
};
