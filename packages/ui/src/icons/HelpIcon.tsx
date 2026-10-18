"use client";

import MuiSvgIcon from "@mui/material/SvgIcon";

import type { IconProps } from "./icon-props";

/** 說明(Figma Draft/AdminAppBar 的 help-button I44:119;81:51,18×18;AppBar 的「?」模組說明鈕)。 */
export const HelpIcon = (props: IconProps) => (
  <MuiSvgIcon viewBox="0 0 18 18" fill="none" {...props}>
    <path
      d="M9 16.25C13.0041 16.25 16.25 13.0041 16.25 9C16.25 4.99594 13.0041 1.75 9 1.75C4.99594 1.75 1.75 4.99594 1.75 9C1.75 13.0041 4.99594 16.25 9 16.25Z"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
    />
    <path
      d="M7.2 7C7.20252 6.69167 7.28005 6.38859 7.42588 6.11691C7.57172 5.84524 7.78148 5.61314 8.03706 5.44065C8.29264 5.26816 8.58636 5.16047 8.89287 5.12686C9.19937 5.09326 9.50945 5.13476 9.79633 5.24777C10.0832 5.36078 10.3383 5.54192 10.5395 5.77554C10.7408 6.00917 10.8821 6.28825 10.9514 6.58871C11.0206 6.88917 11.0157 7.20198 10.9371 7.50012C10.8585 7.79827 10.7084 8.07279 10.5 8.3C10 8.8 9.4 9.1 9.4 9.9V10.2M9.4 12.6H9.41"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
  </MuiSvgIcon>
);
