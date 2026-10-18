"use client";

import ButtonBase, { buttonBaseClasses } from "@mui/material/ButtonBase";
import MuiTypography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { styled } from "@mui/material/styles";
import type { ReactNode } from "react";

import { CheckIcon } from "../icons/CheckIcon";
import { mergeSx } from "../theme/sx";
import { useBreakpointDown } from "../useBreakpointDown/useBreakpointDown";

/** 一步的狀態(Figma `Draft/StepperStep` 的 State 變體軸)。 */
export type StepStatus = "done" | "current" | "todo" | "error";

export interface StepperStep {
  /** 步驟的識別(React key、回呼用) */
  key: string;
  label: ReactNode;
  status: StepStatus;
}

/** 窄螢幕那一行的文字由呼叫端組(ui 不內建文案,I18N-01),例:「第 2 / 5 步 · 明細」。 */
export interface StepperProgress {
  /** 目前那一步的序號(從 1 起算) */
  current: number;
  total: number;
  label: ReactNode;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /**
   * 點了某一步:**只有可以點回的步驟會回報** —— 已完成的,與排在目前步驟之前的有錯步驟(`isStepClickable`);
   * 未開始、進行中、目前這一步本身有錯的點了沒反應
   */
  onStepClick?: (step: StepperStep, index: number) => void;
  /** 窄螢幕那一行的文字(必填:窄螢幕只顯示這一行 + 進度條) */
  progressText: (progress: StepperProgress) => ReactNode;
  /**
   * 版面:`wide` 每一步一顆編號 + 名稱、中間連線;`narrow` 只顯示「第 n / N 步 · 名稱」+ 分段進度條。
   * 不給 = 依畫面寬度(小於 theme 的 `sm` 用 narrow;電腦 / 平板 wide、手機 narrow)
   */
  variant?: "wide" | "narrow";
  /** 整組的無障礙名稱 */
  "aria-label"?: string;
  sx?: SxProps<Theme>;
}

/*
 * 幾何照 Figma `Draft/Stepper`(Wide / Narrow)與 `Draft/StepperStep`:
 * 編號圓 24、內字 12 半粗;圓與名稱間距 8;步驟之間的連線寬 32、2px,與兩側間距 12;
 * 已完成 / 進行中 = primary 實心白字(已完成畫勾),未開始 = grey.200 底 + 次要字,有錯 = error 實心「!」;
 * 進到某一步的連線:那一步不是「未開始」就是 primary(含有錯的前後),否則 divider。
 * 窄:文字 subtitle2,下方分段進度條每段高 4、段距 4、圓角 2,到目前那一步(含)為 primary、有錯的那一段為 error。
 * 圓 24、連線 32、進度條 4 只有這個元件用到,依 STYLE-06 直寫。
 */
const DOT_SIZE = 24;
const CONNECTOR_WIDTH = 32;
const BAR_HEIGHT = 4;
const BAR_MAX_WIDTH = 64;

const paletteOf = (theme: Theme) => (theme.vars ?? theme).palette;

const Dot = styled("span", {
  shouldForwardProp: (prop) => prop !== "status",
})<{ status: StepStatus }>(({ theme, status }) => {
  const palette = paletteOf(theme);
  const filled = {
    done: palette.primary.main,
    current: palette.primary.main,
    error: palette.error.main,
    todo: palette.grey[200],
  }[status];
  return {
    width: DOT_SIZE,
    height: DOT_SIZE,
    flexShrink: 0,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    ...theme.typography.caption,
    fontWeight: 600,
    backgroundColor: filled,
    color: {
      done: palette.primary.contrastText,
      current: palette.primary.contrastText,
      error: palette.error.contrastText,
      todo: palette.text.secondary,
    }[status],
    "& .MuiSvgIcon-root": { fontSize: 16 },
  };
});

const Connector = styled("span", {
  shouldForwardProp: (prop) => prop !== "isPassed",
})<{ isPassed: boolean }>(({ theme, isPassed }) => {
  const palette = paletteOf(theme);
  return {
    width: CONNECTOR_WIDTH,
    height: 2,
    flexShrink: 0,
    backgroundColor: isPassed ? palette.primary.main : palette.divider,
  };
});

/** 編號圓 + 名稱;已完成(與排在目前步驟之前的有錯)步驟是按鈕,其餘是純文字。 */
const StepBody = styled("span")(({ theme }) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: theme.spacing(1),
}));

/** 鍵盤聚焦時的外框(ButtonBase 沒有預設外框)。 */
const StepButton = styled(ButtonBase)(({ theme }) => ({
  gap: theme.spacing(1),
  borderRadius: theme.shape.borderRadius,
  padding: 0,
  [`&.${buttonBaseClasses.focusVisible}`]: {
    outline: `2px solid ${paletteOf(theme).primary.main}`,
    outlineOffset: 2,
  },
}));

const Bar = styled("span")({ display: "flex", gap: BAR_HEIGHT });

/** 進度條一段:到目前那一步(含)是 primary,有錯的那一步是 error,其餘 divider。 */
type SegmentTone = "filled" | "error" | "empty";

const Segment = styled("span", {
  shouldForwardProp: (prop) => prop !== "tone",
})<{ tone: SegmentTone }>(({ theme, tone }) => {
  const palette = paletteOf(theme);
  return {
    flex: 1,
    maxWidth: BAR_MAX_WIDTH,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: {
      filled: palette.primary.main,
      error: palette.error.main,
      empty: palette.divider,
    }[tone],
  };
});

const segmentToneOf = (
  step: StepperStep,
  index: number,
  active: number,
): SegmentTone => {
  if (step.status === "error") {
    return "error";
  }
  return index <= active ? "filled" : "empty";
};

/**
 * 可以點回的步驟:已完成的,以及**排在目前步驟之前**、狀態為「有錯」的(它原本已完成過,送出時才發現錯)。
 * 未開始、進行中、目前這一步本身有錯的點了沒反應。
 */
export const isStepClickable = (
  step: StepperStep,
  index: number,
  active: number,
): boolean =>
  step.status === "done" || (step.status === "error" && index < active);

const labelColor = (status: StepStatus): string => {
  switch (status) {
    case "error": {
      return "error.main";
    }
    case "todo": {
      return "text.secondary";
    }
    default: {
      return "text.primary";
    }
  }
};

/** 目前那一步:第一個進行中;沒有就第一個有錯;都沒有(全部完成)就最後一步。 */
export const activeStepIndex = (steps: readonly StepperStep[]): number => {
  const current = steps.findIndex((step) => step.status === "current");
  if (current !== -1) {
    return current;
  }
  const error = steps.findIndex((step) => step.status === "error");
  return error === -1 ? Math.max(steps.length - 1, 0) : error;
};

/**
 * 精靈步驟(底座 10.8):每一步 編號、名稱、狀態(已完成 / 進行中 / 未開始 / 有錯)。
 * 元件只畫狀態與回報點擊:**已完成的步驟可點回**(`onStepClick`;排在目前步驟之前的有錯步驟也可以),其餘點了沒反應;
 * 步驟內容、上一步 / 下一步的條件與目前步驟都由使用處決定(狀態只放畫面 state,不進網址、不存)。
 *
 * 無障礙:寬版是 `<ol>`(連線畫在各 `<li>` 裡),目前那一步標 `aria-current="step"`;可點回的步驟是按鈕,其餘是純文字。
 */
export const Stepper = ({
  steps,
  onStepClick,
  progressText,
  variant,
  "aria-label": ariaLabel,
  sx,
}: StepperProps) => {
  const isNarrowScreen = useBreakpointDown("sm");
  const isNarrow =
    (variant ?? (isNarrowScreen ? "narrow" : "wide")) === "narrow";
  const active = activeStepIndex(steps);

  if (isNarrow) {
    const step = steps.at(active);
    return (
      <MuiTypography
        component="nav"
        aria-label={ariaLabel}
        sx={mergeSx({ display: "flex", flexDirection: "column", gap: 1 }, sx)}
      >
        <MuiTypography variant="subtitle2" component="span">
          {progressText({
            current: active + 1,
            total: steps.length,
            label: step?.label,
          })}
        </MuiTypography>
        <Bar aria-hidden>
          {steps.map((item, index) => (
            <Segment key={item.key} tone={segmentToneOf(item, index, active)} />
          ))}
        </Bar>
      </MuiTypography>
    );
  }

  return (
    <MuiTypography
      component="ol"
      aria-label={ariaLabel}
      sx={mergeSx(
        {
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1.5,
          m: 0,
          p: 0,
          listStyle: "none",
        },
        sx,
      )}
    >
      {steps.map((step, index) => {
        const content = (
          <>
            <Dot status={step.status} aria-hidden>
              {step.status === "done" && <CheckIcon />}
              {step.status === "error" && "!"}
              {(step.status === "current" || step.status === "todo") &&
                String(index + 1)}
            </Dot>
            <MuiTypography
              variant="subtitle2"
              component="span"
              color={labelColor(step.status)}
              sx={{ whiteSpace: "nowrap" }}
            >
              {step.label}
            </MuiTypography>
          </>
        );
        return (
          <MuiTypography
            key={step.key}
            component="li"
            aria-current={index === active ? "step" : undefined}
            sx={{ display: "inline-flex", alignItems: "center", gap: 1.5 }}
          >
            {/* 連線放在 <li> 裡(<ol> 只放 <li>);進到這一步的連線:這一步不是「未開始」就是 primary */}
            {index > 0 && (
              <Connector aria-hidden isPassed={step.status !== "todo"} />
            )}
            {isStepClickable(step, index, active) ? (
              <StepButton
                onClick={() => {
                  onStepClick?.(step, index);
                }}
              >
                {content}
              </StepButton>
            ) : (
              <StepBody>{content}</StepBody>
            )}
          </MuiTypography>
        );
      })}
    </MuiTypography>
  );
};
