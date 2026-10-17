import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

export interface OrgDisabledReasonProps {
  reason: string;
}

/**
 * 停用節點右側的原因文字(`OrgTreePicker` 的 `disabledReasons`)。
 * 靠右、單行、過長截斷;滑過以 `Tooltip` 顯示完整原因(REACT-10,不用原生 `title`)。
 */
export const OrgDisabledReason = ({ reason }: OrgDisabledReasonProps) => (
  <Tooltip title={reason}>
    <Typography
      component="span"
      variant="caption"
      color="text.secondary"
      noWrap
      sx={{ marginLeft: "auto", minWidth: 0 }}
    >
      {reason}
    </Typography>
  </Tooltip>
);
