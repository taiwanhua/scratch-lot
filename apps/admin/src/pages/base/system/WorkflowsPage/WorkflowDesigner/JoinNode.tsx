import { Handle, type NodeProps, Position } from "@xyflow/react";

import { Box } from "@repo/ui/box";

import type { JoinFlowNode } from "./flow-nodes";

/**
 * 匯合節點(系統節點,菱形):不設審核者、不能設定「跳過這一關」,等所有分支都通過才自動完成。
 * 菱形 = 旋轉 45° 的正方形;名稱放在節點的無障礙名稱上(菱形裡放不下字)。
 */
/** 外框色:有檢查器錯誤 → 紅;選中 → 主色;其餘 → 次要文字色。 */
const borderColorOf = (hasIssues: boolean, isSelected: boolean): string => {
  if (hasIssues) {
    return "error.main";
  }
  return isSelected ? "primary.main" : "text.secondary";
};

export const JoinNode = ({ data, selected }: NodeProps<JoinFlowNode>) => (
  <Box
    role="group"
    aria-label={data.title}
    sx={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <Box
      sx={{
        width: "70%",
        height: "70%",
        transform: "rotate(45deg)",
        border: selected ? 2 : 1,
        borderColor: borderColorOf(data.issueCount > 0, selected),
        bgcolor: "action.hover",
      }}
    />
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </Box>
);
