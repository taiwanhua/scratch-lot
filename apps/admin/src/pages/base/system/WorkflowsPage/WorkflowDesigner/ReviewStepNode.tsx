import { Handle, type NodeProps, Position } from "@xyflow/react";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type { ReviewFlowNode } from "./flow-nodes";

/**
 * 審核關卡節點(卡片):名稱、審核者來源、會簽、跳過條件、可否退回;有檢查器錯誤時標紅。
 * 連接點只當連線的端點,不開放自由拉線(`isConnectable={false}`)。
 */
/** 外框色:有檢查器錯誤 → 紅;選中 → 主色;其餘 → 分隔線色。 */
const borderColorOf = (hasIssues: boolean, isSelected: boolean): string => {
  if (hasIssues) {
    return "error.main";
  }
  return isSelected ? "primary.main" : "divider";
};

export const ReviewStepNode = ({
  data,
  selected,
}: NodeProps<ReviewFlowNode>) => (
  <Box
    role="group"
    aria-label={data.title}
    sx={{
      width: "100%",
      height: "100%",
      px: 1.5,
      py: 1,
      borderRadius: 1,
      border: selected ? 2 : 1,
      borderColor: borderColorOf(data.issueCount > 0, selected),
      bgcolor: "background.paper",
      boxShadow: selected ? 2 : 0,
      overflow: "hidden",
    }}
  >
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <Stack spacing={0.25}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
          {data.title}
        </Typography>
        {data.issueCount > 0 && <Tag tone="error" label={data.issueLabel} />}
      </Stack>
      {data.lines.map((line) => (
        <Typography key={line} variant="caption" color="textSecondary" noWrap>
          {line}
        </Typography>
      ))}
    </Stack>
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </Box>
);
