import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface CountStepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** 減一 / 加一按鈕的念法(例「少一張」「多一張」) */
  decreaseLabel: string;
  increaseLabel: string;
  /** 數字的念法(例「張數」) */
  valueLabel: string;
  disabled?: boolean;
}

/**
 * 張數的加減按鈕(張數店的依張數標記售出、撤銷幾張;Figma CS-03、CS-07b):[−] 數字 [+],
 * 到下限 / 上限時那一邊停用。文字一律由使用處傳入。
 */
export const CountStepper = ({
  value,
  min,
  max,
  onChange,
  decreaseLabel,
  increaseLabel,
  valueLabel,
  disabled = false,
}: CountStepperProps) => (
  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
    <Button
      size="small"
      variant="outlined"
      aria-label={decreaseLabel}
      disabled={disabled || value <= min}
      onClick={() => {
        onChange(Math.max(min, value - 1));
      }}
      sx={{ minWidth: 32, px: 0 }}
    >
      −
    </Button>
    <Typography
      variant="body1"
      aria-label={valueLabel}
      sx={{ minWidth: 24, textAlign: "center" }}
    >
      {value}
    </Typography>
    <Button
      size="small"
      variant="outlined"
      aria-label={increaseLabel}
      disabled={disabled || value >= max}
      onClick={() => {
        onChange(Math.min(max, value + 1));
      }}
      sx={{ minWidth: 32, px: 0 }}
    >
      +
    </Button>
  </Stack>
);
