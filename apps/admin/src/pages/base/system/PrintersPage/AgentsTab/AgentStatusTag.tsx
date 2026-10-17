import { useTranslations } from "use-intl";

import type { PrintAgentFieldsFragment } from "@repo/graphql";
import { Tag, type TagTone } from "@repo/ui/tag";

type AgentDisplayStatus = "disabled" | "unpaired" | "online" | "offline";

const TONE: Record<AgentDisplayStatus, TagTone> = {
  disabled: "grey",
  unpaired: "warning",
  online: "success",
  offline: "grey",
};

/** 已停用 → 已停用;還沒配對(或重新配對後還沒換到新金鑰)→ 等待配對;其餘看 2 分鐘內有沒有連線。 */
const displayStatusOf = (
  agent: Pick<PrintAgentFieldsFragment, "enabled" | "paired" | "online">,
): AgentDisplayStatus => {
  if (!agent.enabled) {
    return "disabled";
  }
  if (!agent.paired) {
    return "unpaired";
  }
  return agent.online ? "online" : "offline";
};

export interface AgentStatusTagProps {
  agent: Pick<PrintAgentFieldsFragment, "enabled" | "paired" | "online">;
}

/** 代理程式分頁「狀態」欄(Figma BS-19:已連線 / 離線)。 */
export const AgentStatusTag = ({ agent }: AgentStatusTagProps) => {
  const t = useTranslations("admin.printers.agentStatus");
  const status = displayStatusOf(agent);
  return <Tag tone={TONE[status]} label={t(status)} />;
};
