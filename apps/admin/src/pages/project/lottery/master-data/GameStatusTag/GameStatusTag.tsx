import { useTranslations } from "use-intl";

import { Tag } from "@repo/ui/tag";

export interface GameStatusTagProps {
  /** `on_sale` / `discontinued` */
  status: string;
}

/** 遊戲狀態標籤:販售中綠、停售灰(Figma MD-01)。 */
export const GameStatusTag = ({ status }: GameStatusTagProps) => {
  const t = useTranslations("admin.lotteryMasterData.status");
  return (
    <Tag tone={status === "on_sale" ? "success" : "grey"} label={t(status)} />
  );
};
