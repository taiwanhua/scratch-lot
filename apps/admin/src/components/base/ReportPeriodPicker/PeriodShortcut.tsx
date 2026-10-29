import { Button } from "@repo/ui/button";

export interface PeriodShortcutProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

/** 期間快捷按鈕([今天] [本週] [上月]…):目前選中的期間實心、其他外框。 */
export const PeriodShortcut = ({
  label,
  isActive,
  onClick,
}: PeriodShortcutProps) => (
  <Button
    size="small"
    variant={isActive ? "contained" : "outlined"}
    aria-pressed={isActive}
    onClick={onClick}
  >
    {label}
  </Button>
);
