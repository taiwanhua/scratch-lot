"use client";

import ButtonBase, { buttonBaseClasses } from "@mui/material/ButtonBase";
import MuiCollapse from "@mui/material/Collapse";
import MuiTypography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { styled } from "@mui/material/styles";
import { type ReactNode, useId, useState } from "react";

import { ChevronDownIcon } from "../icons/ChevronDownIcon";
import { mergeSx } from "../theme/sx";
import { radius } from "../theme/tokens";

export interface SectionProps {
  /** 區塊標題(標題列左側) */
  title: ReactNode;
  /** 收合時接在標題後面的摘要(例:幾個關鍵欄位的值);展開時不顯示 */
  summary?: ReactNode;
  /** 內容區:任何內容(欄位、表格…) */
  children?: ReactNode;
  /** 可不可以收合;false = 一律展開、標題列不是按鈕、沒有箭頭。不給 = true */
  collapsible?: boolean;
  /** 受控:目前是否收合(給了就以它為準,點標題列只回報 `onCollapsedChange`) */
  collapsed?: boolean;
  /** 非受控的初始值。不給 = false(展開) */
  defaultCollapsed?: boolean;
  /** 點標題列切換時回報下一個收合狀態 */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** 外框元素的 DOM id(錨點、捲動定位用) */
  id?: string;
  sx?: SxProps<Theme>;
}

/*
 * 幾何照 Figma `Draft/Section`(Expanded / Collapsed):
 * 外框白底、1px 分隔線色邊框、圓角 12(radius.md);標題列高 56、左右內距 16、元素間距 12;
 * 標題 subtitle1 半粗,摘要 body2 次要色;箭頭 16 在最右(展開朝上、收合朝下);
 * 內容區左右與下方內距 16、與標題列之間不畫分隔線。標題列高 56 只有這個元件用到,依 STYLE-06 直寫。
 */
const HEADER_HEIGHT = 56;
const ICON_SIZE = 16;

const Frame = styled("section")(({ theme }) => {
  const palette = (theme.vars ?? theme).palette;
  return {
    overflow: "hidden",
    borderRadius: radius.md,
    border: `1px solid ${palette.divider}`,
    backgroundColor: palette.background.paper,
  };
});

const headerStyles = (theme: Theme) =>
  ({
    width: "100%",
    minHeight: HEADER_HEIGHT,
    paddingInline: theme.spacing(2),
    gap: theme.spacing(1.5),
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    textAlign: "left",
  }) as const;

/** 鍵盤聚焦時的外框(ButtonBase 沒有預設外框;畫在標題列內側,不被外框的 overflow 裁掉)。 */
const HeaderButton = styled(ButtonBase)(({ theme }) => ({
  ...headerStyles(theme),
  [`&.${buttonBaseClasses.focusVisible}`]: {
    outline: `2px solid ${(theme.vars ?? theme).palette.primary.main}`,
    outlineOffset: -2,
  },
}));

const StaticHeader = styled("div")(({ theme }) => headerStyles(theme));

const Content = styled("div")(({ theme }) => ({
  padding: theme.spacing(0, 2, 2),
}));

const Chevron = styled(ChevronDownIcon, {
  shouldForwardProp: (prop) => prop !== "isCollapsed",
})<{ isCollapsed: boolean }>(({ theme, isCollapsed }) => ({
  marginLeft: "auto",
  fontSize: ICON_SIZE,
  color: (theme.vars ?? theme).palette.text.secondary,
  transform: isCollapsed ? "none" : "rotate(180deg)",
  transition: theme.transitions.create("transform", {
    duration: theme.transitions.duration.shortest,
  }),
}));

/**
 * 可收合區塊(底座 10.3):標題列 + 內容區,點標題列展開 / 收合。
 * 元件只管畫面與切換;收合狀態要不要記住、記在哪裡由使用處決定(admin 的 `Section` 包裝依頁面 id 與區塊 key 存進 localStorage)。
 *
 * 無障礙:可收合時標題列是一顆按鈕(`aria-expanded`、`aria-controls` 指向內容區),名稱就是標題(收合時加上摘要);
 * 外框 `<section>` 以標題命名(landmark region)。收合後內容仍掛著(只是隱藏),欄位的值與狀態不會因收合而消失。
 */
export const Section = ({
  title,
  summary,
  children,
  collapsible = true,
  collapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  id,
  sx,
}: SectionProps) => {
  const [innerCollapsed, setInnerCollapsed] = useState(defaultCollapsed);
  const isCollapsed = collapsible && (collapsed ?? innerCollapsed);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const contentId = `${baseId}-content`;

  const toggle = () => {
    const next = !isCollapsed;
    if (collapsed === undefined) {
      setInnerCollapsed(next);
    }
    onCollapsedChange?.(next);
  };

  const heading = (
    <MuiTypography
      id={titleId}
      variant="subtitle1"
      component="h2"
      sx={{ fontWeight: 600, flexShrink: 0 }}
    >
      {title}
    </MuiTypography>
  );

  return (
    <Frame id={id} aria-labelledby={titleId} sx={mergeSx({}, sx)}>
      {collapsible ? (
        <HeaderButton
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
          onClick={toggle}
        >
          {heading}
          {isCollapsed && summary !== undefined && (
            <MuiTypography
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ minWidth: 0 }}
            >
              {summary}
            </MuiTypography>
          )}
          <Chevron aria-hidden isCollapsed={isCollapsed} />
        </HeaderButton>
      ) : (
        <StaticHeader>{heading}</StaticHeader>
      )}
      <MuiCollapse in={!isCollapsed}>
        <Content id={contentId}>{children}</Content>
      </MuiCollapse>
    </Frame>
  );
};
