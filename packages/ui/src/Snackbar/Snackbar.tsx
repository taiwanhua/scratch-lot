"use client";

import MuiAlert from "@mui/material/Alert";
import MuiAlertTitle from "@mui/material/AlertTitle";
import MuiButton from "@mui/material/Button";
import MuiIconButton from "@mui/material/IconButton";
import type { SxProps, Theme } from "@mui/material/styles";
import { styled } from "@mui/material/styles";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { CloseIcon } from "../icons/CloseIcon";
import { mergeSx } from "../theme/sx";
import { radius } from "../theme/tokens";

/** 提示的語氣:操作結果(成功 / 失敗)、提醒、新通知(Figma `Draft/Snackbar+` 286:7200 的四種 Severity)。 */
export type SnackbarSeverity = "success" | "error" | "warning" | "info";

/** 一般提示自動消失的毫秒數。 */
export const SNACKBAR_DURATION = 4000;
/** 有動作按鈕(例 [撤銷])的提示自動消失的毫秒數:多留時間給使用者按。 */
export const SNACKBAR_ACTION_DURATION = 8000;

/** 提示右側的動作按鈕(放在 ✕ 左邊)。 */
export interface SnackbarAction {
  /** 按鈕文字(語言無關,由呼叫端給;例「撤銷」) */
  label: ReactNode;
  /** 按下後先執行它,再關掉這一則 */
  onClick: () => void;
}

export interface SnackbarProps {
  /** 提示內容(語言無關 — 文字由呼叫端給,I18N-01) */
  message: ReactNode;
  /** 標題(選填);有時粗體顯示在訊息上方 */
  title?: ReactNode;
  /** 語氣;預設成功 */
  severity?: SnackbarSeverity;
  /** 動作按鈕(選填);有動作時預設停留 8 秒 */
  action?: SnackbarAction;
  /**
   * 自動關閉的毫秒數。不給 = 系統預設(一般 4 秒、有動作 8 秒);給 `null` 則不自動關。
   * 系統預設全站一致,只有特例才調。
   */
  autoHideDuration?: number | null;
  /** 關閉鈕的無障礙名稱(語言無關,由呼叫端給) */
  closeLabel: string;
  /** 自動逾時、按 ✕、按動作按鈕後都會呼叫(呼叫端收到後把這一則從佇列移除) */
  onClose: () => void;
  /** 只疊加版面值(STYLE-10) */
  sx?: SxProps<Theme>;
}

/**
 * 卡片外觀(Figma `Draft/Snackbar+` 286:7200):寬度由 `SnackbarStack` 給(電腦 360)、
 * 底 `background.paper`、字 `text.primary`、左側 4px 色條取該語氣的 `main`、
 * 圓角 radius.md、陰影 `shadows[8]`(= Figma Shadow/z8)。顏色一律走 palette(有 CSS 變數時取 `theme.vars`),
 * 暗色模式自動換那一組(STYLE-04)。不顯示 MUI Alert 的語氣圖示,語氣只由色條表達。
 */
const SnackbarCard = styled(MuiAlert)(({ theme }) => {
  const palette = (theme.vars ?? theme).palette;
  return {
    position: "relative",
    overflow: "hidden",
    alignItems: "center",
    width: "100%",
    // 左 4px 色條 + body 內距 12(Figma texts x=16、y=10)
    padding: theme.spacing(1.25, 1.5, 1.25, 2),
    borderRadius: radius.md,
    // Figma Shadow/z8 = theme.shadows[8](同一支 softShadow(8),見 theme/tokens.ts)
    boxShadow: theme.shadows[8],
    backgroundColor: palette.background.paper,
    color: palette.text.primary,
    pointerEvents: "auto",
    "&::before": {
      content: '""',
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      width: 4,
    },
    "&.MuiAlert-colorSuccess::before": {
      backgroundColor: palette.success.main,
    },
    "&.MuiAlert-colorError::before": { backgroundColor: palette.error.main },
    "&.MuiAlert-colorWarning::before": {
      backgroundColor: palette.warning.main,
    },
    "&.MuiAlert-colorInfo::before": { backgroundColor: palette.info.main },
    "& .MuiAlert-message": {
      ...theme.typography.body2,
      padding: 0,
      minWidth: 0,
      flex: 1,
    },
    "& .MuiAlertTitle-root": {
      ...theme.typography.subtitle2,
      margin: 0,
      color: palette.text.primary,
    },
    "& .MuiAlert-action": {
      alignItems: "center",
      gap: theme.spacing(1),
      padding: 0,
      marginRight: 0,
      paddingLeft: theme.spacing(1),
    },
  };
});

const CloseButton = styled(MuiIconButton)(({ theme }) => ({
  color: (theme.vars ?? theme).palette.text.secondary,
}));

/** 依規則算出這一則的停留時間:呼叫端有給就用它,否則一般 4 秒、有動作 8 秒。 */
const durationOf = (
  autoHideDuration: number | null | undefined,
  hasAction: boolean,
): number | null => {
  if (autoHideDuration !== undefined) {
    return autoHideDuration;
  }
  return hasAction ? SNACKBAR_ACTION_DURATION : SNACKBAR_DURATION;
};

/**
 * 全站統一的短提示卡片(底座規格 10.12):標題(選填)+ 訊息,右側 ✕;有動作時按鈕放在 ✕ 左邊。
 *
 * **計時**:一般 4 秒、有動作 8 秒自動關(`autoHideDuration` 可調,但系統預設一致);
 * 滑鼠移上這一則就暫停,移開後**重新計時**(從頭算完整的時間)。計時各則獨立。
 *
 * 本元件只畫「一則」;位置(電腦 / 平板右下、手機底部滿寬)與堆疊(往上疊、新的在下、最多 3 則,
 * 第 4 則出現時最舊的消失)由 `SnackbarStack` 與 `enqueueSnackbar` 負責。
 * 點畫面其他地方不會關(沒有 clickaway):提示本來就會自己關,點一下就消失反而來不及讀。
 */
export const Snackbar = ({
  message,
  title,
  severity = "success",
  action,
  autoHideDuration,
  closeLabel,
  onClose,
  sx,
}: SnackbarProps) => {
  const duration = durationOf(autoHideDuration, action !== undefined);
  const [isPaused, setIsPaused] = useState(false);

  // 呼叫端每次 render 都可能給新的 onClose;用 ref 取最新的,計時才不會因父層重繪而重來
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (duration === null || isPaused) {
      return;
    }
    const timer = setTimeout(() => {
      onCloseRef.current();
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [duration, isPaused]);

  return (
    <SnackbarCard
      severity={severity}
      icon={false}
      onMouseEnter={() => {
        setIsPaused(true);
      }}
      onMouseLeave={() => {
        setIsPaused(false);
      }}
      action={
        <>
          {action !== undefined && (
            <MuiButton
              variant="text"
              color="primary"
              size="small"
              onClick={() => {
                action.onClick();
                onClose();
              }}
            >
              {action.label}
            </MuiButton>
          )}
          <CloseButton size="small" aria-label={closeLabel} onClick={onClose}>
            <CloseIcon fontSize="small" />
          </CloseButton>
        </>
      }
      sx={mergeSx({}, sx)}
    >
      {title !== undefined && <MuiAlertTitle>{title}</MuiAlertTitle>}
      {message}
    </SnackbarCard>
  );
};
