"use client";

import Box from "@mui/material/Box";
import Grow from "@mui/material/Grow";
import type { SxProps, Theme } from "@mui/material/styles";

import { mergeSx } from "../theme/sx";
import { Snackbar, type SnackbarProps } from "./Snackbar";
import { SNACKBAR_MAX_VISIBLE } from "./snackbar-queue";

/** 堆疊裡的一則:卡片的內容 props 加上識別(關閉時回報哪一則)。 */
export interface SnackbarStackItem extends Omit<
  SnackbarProps,
  "closeLabel" | "onClose" | "sx"
> {
  id: number | string;
}

export interface SnackbarStackProps {
  /** 由舊到新;最後一則畫在最下面 */
  items: readonly SnackbarStackItem[];
  /** 每則 ✕ 的無障礙名稱(語言無關,由呼叫端給) */
  closeLabel: string;
  /** 某一則自動逾時、按 ✕、按動作後回報它的 id(呼叫端從佇列移除) */
  onClose: (id: SnackbarStackItem["id"]) => void;
  /** 同時最多畫幾則(只取最新的);佇列本身要用 `enqueueSnackbar` 截斷。預設 3 */
  max?: number;
  /**
   * 手機有底部導覽時它的高度(theme spacing 單位),提示放在它上面。不給 = 0(admin 沒有底部導覽)。
   */
  mobileBottomOffset?: number;
  /** 只疊加版面值(STYLE-10) */
  sx?: SxProps<Theme>;
}

/** 電腦 / 平板的卡片寬(Figma `Draft/Snackbar+` 的 360)。 */
const DESKTOP_WIDTH = 360;

/**
 * 全站提示的位置與堆疊:
 *
 * - **電腦 / 平板(`sm` 以上)**:右下角,距邊 24,寬 360。
 * - **手機(小於 `sm`)**:底部置中、左右 16 滿寬;有底部導覽時以 `mobileBottomOffset` 放在它上面。
 * - **堆疊**:所有提示(操作結果、可撤銷、新通知)一律往上疊,新的在下面,舊的往上推;
 *   最多 3 則,第 4 則出現時最舊的那則消失(截斷在 `enqueueSnackbar`,這裡只畫最新的 `max` 則)。
 *
 * 容器本身 `pointer-events: none`,卡片之間的空隙不擋下面的畫面;卡片自己可以點。
 * 沒有任何一則時不渲染容器。
 */
export const SnackbarStack = ({
  items,
  closeLabel,
  onClose,
  max = SNACKBAR_MAX_VISIBLE,
  mobileBottomOffset = 0,
  sx,
}: SnackbarStackProps) => {
  if (items.length === 0) {
    return null;
  }
  return (
    <Box
      data-snackbar-stack=""
      sx={mergeSx(
        (theme) => ({
          position: "fixed",
          zIndex: theme.zIndex.snackbar,
          display: "flex",
          flexDirection: "column",
          gap: 1,
          pointerEvents: "none",
          left: { xs: theme.spacing(2), sm: "auto" },
          right: { xs: theme.spacing(2), sm: theme.spacing(3) },
          bottom: {
            xs: theme.spacing(2 + mobileBottomOffset),
            sm: theme.spacing(3),
          },
          width: { xs: "auto", sm: DESKTOP_WIDTH },
        }),
        sx,
      )}
    >
      {items.slice(-max).map(({ id, ...item }) => (
        <Grow key={id} in appear>
          <Box>
            <Snackbar
              {...item}
              closeLabel={closeLabel}
              onClose={() => {
                onClose(id);
              }}
            />
          </Box>
        </Grow>
      ))}
    </Box>
  );
};
