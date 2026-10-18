"use client";

import MuiSwitch, {
  type SwitchProps as MuiSwitchProps,
} from "@mui/material/Switch";

import { mergeSx } from "../theme/sx";

/** 幾何照 Figma Draft/Switch 88:216:軌道 40×22(全圓角)、把手直徑 16、內縮 3。 */
const TRACK_WIDTH = 40;
const TRACK_HEIGHT = 22;
const THUMB_SIZE = 16;
const THUMB_INSET = 3;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - THUMB_INSET * 2;

export type SwitchProps = MuiSwitchProps;

/**
 * 開關(Figma Components / Switch 88:211 的 Draft/Switch 88:216;模組啟用等 runtime 切換)。
 * MUI 預設的軌道比 Figma 窄且把手外凸,所以幾何整組覆寫;顏色仍走語意 token。
 */
export const Switch = ({ sx, ...rest }: SwitchProps) => (
  <MuiSwitch
    sx={mergeSx(
      {
        width: TRACK_WIDTH,
        height: TRACK_HEIGHT,
        padding: 0,
        display: "flex",
        "& .MuiSwitch-switchBase": {
          padding: `${String(THUMB_INSET)}px`,
          "&.Mui-checked": {
            transform: `translateX(${String(THUMB_TRAVEL)}px)`,
            color: "common.white",
            "& + .MuiSwitch-track": {
              backgroundColor: "primary.main",
              opacity: 1,
            },
          },
          /*
           * 停用態:上面把軌道顏色與 `opacity: 1` 寫死是為了對 Figma 的幾何,
           * 但那也蓋掉了 MUI 自己的 `.Mui-disabled` 灰化 —— 開關按不動卻還是彩色的,
           * 使用者看不出「不是壞了,是不准改」。這裡把灰化補回來,而且要排在
           * `.Mui-checked` 之後,checked + disabled 才不會又被上面那條吃回去。
           * Figma Draft/Switch 88:216 只有 On / Off 兩個變體、沒有停用稿,
           * 顏色照語意 token 走(`action.disabledBackground` / `action.disabled`),
           * 與 Checkbox 的停用灰(grey.200 / grey.400)同一個調性。
           */
          "&.Mui-disabled": {
            color: "action.disabled",
            "& + .MuiSwitch-track": {
              backgroundColor: "action.disabledBackground",
              opacity: 1,
            },
            "& .MuiSwitch-thumb": { color: "action.disabled" },
          },
        },
        "& .MuiSwitch-thumb": {
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          boxShadow: "none",
          color: "common.white",
        },
        "& .MuiSwitch-track": {
          borderRadius: `${String(TRACK_HEIGHT / 2)}px`,
          backgroundColor: "grey.400",
          opacity: 1,
        },
        /*
         * 游標:MUI 對停用的 `switchBase`(ButtonBase)下 `pointer-events: none`,
         * 所以滑鼠實際碰到的是 root —— 游標要掛在 root 上才看得到。
         */
        "&:has(.Mui-disabled)": { cursor: "not-allowed" },
      },
      sx,
    )}
    {...rest}
  />
);
