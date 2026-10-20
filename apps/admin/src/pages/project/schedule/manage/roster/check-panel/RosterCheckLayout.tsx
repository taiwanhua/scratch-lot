import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";

import { CheckPanel } from "./CheckPanel";
import { useRosterCheck } from "./roster-check-context";

/** 右側面板寬(設計值 SC-18:電腦 360、平板 288;STYLE-06)。 */
const PANEL_WIDTH = { sm: 288, lg: 360 } as const;
/** 手機底部面板:拉高時的高度、收合時只剩把手與標題列的高度。 */
const SHEET_EXPANDED_HEIGHT = "60vh";
const SHEET_COLLAPSED_HEIGHT = 96;

/**
 * 排班表內容與檢核面板的排版(規格 14.5:persistent、不遮擋):
 * 電腦 / 平板 = 內容右邊一欄側邊面板(內容跟著變窄);手機 = 固定在底部的面板(可以拉高或收合),
 * 內容底部留出面板的高度,不會被蓋住。內容的節點位置不隨面板開關改變(檢視不重掛、捲動位置不跑掉)。
 */
export const RosterCheckLayout = ({ children }: { children: ReactNode }) => {
  const t = useTranslations("admin.schedule.roster.check");
  const { isOpen } = useRosterCheck();
  const isMobile = useBreakpointDown("sm");
  const [isSheetCollapsed, setSheetCollapsed] = useState(false);
  const showSheet = isOpen && isMobile;
  const showSide = isOpen && !isMobile;
  const sheetHeight = isSheetCollapsed
    ? `${String(SHEET_COLLAPSED_HEIGHT)}px`
    : SHEET_EXPANDED_HEIGHT;

  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          ...(showSheet ? { pb: `calc(${sheetHeight} + 16px)` } : {}),
        }}
      >
        {children}
      </Box>
      {showSide && (
        <Card
          variant="outlined"
          role="complementary"
          aria-label={t("title")}
          sx={{
            flex: "none",
            width: PANEL_WIDTH,
            position: "sticky",
            top: 16,
            maxHeight: "calc(100vh - 200px)",
            display: "flex",
            flexDirection: "column",
            p: 2,
          }}
        >
          <CheckPanel />
        </Card>
      )}
      {showSheet && (
        <Card
          variant="outlined"
          role="complementary"
          aria-label={t("title")}
          sx={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            height: sheetHeight,
            zIndex: (theme) => theme.zIndex.appBar,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            display: "flex",
            flexDirection: "column",
            px: 2,
            pb: 2,
          }}
        >
          <CheckPanel
            isCollapsed={isSheetCollapsed}
            handle={
              <Button
                variant="text"
                size="small"
                aria-label={isSheetCollapsed ? t("expand") : t("collapse")}
                aria-expanded={!isSheetCollapsed}
                onClick={() => {
                  setSheetCollapsed((current) => !current);
                }}
                sx={{
                  alignSelf: "center",
                  minWidth: 48,
                  height: 20,
                  p: 0,
                  "&::after": {
                    content: '""',
                    width: 36,
                    height: 4,
                    borderRadius: 2,
                    bgcolor: "divider",
                  },
                }}
              />
            }
          />
        </Card>
      )}
    </Stack>
  );
};
