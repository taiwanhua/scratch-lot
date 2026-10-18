import { Suspense, lazy, useState } from "react";
import { useTranslations } from "use-intl";

import type { ModuleEngine } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Dialog } from "@repo/ui/dialog";
import { IconButton } from "@repo/ui/icon-button";
import { HelpIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { Tooltip } from "@repo/ui/tooltip";

import { moduleHelpMarkdown } from "@/lib/base/help-registry";

/**
 * `@repo/ui/markdown`(react-markdown + remark-gfm 的 micromark / mdast 依賴鏈)約佔主 chunk
 * 170 kB,而模組說明彈窗不是每次載入頁面都會開。改成動態 import + `Suspense`,
 * 讓 Vite 切出獨立 chunk、只在第一次開啟彈窗時抓。
 * `React.lazy` 只收 default export,`@repo/ui/markdown` 是具名匯出,所以在這裡轉一手。
 */
const LazyMarkdown = lazy(async () => {
  const { Markdown } = await import("@repo/ui/markdown");
  return { default: Markdown };
});

export interface HelpButtonProps {
  /** 目前模組的 key(`me.modules` 的 key);決定顯示哪一份 help.md */
  moduleKey: string;
  /** 目前模組的名稱;彈窗標題用(表單模組共用通用說明時,靠它標出是哪個模組) */
  moduleName: string;
  /** 目前模組的引擎;表單模組沒有專屬 help.md 時退回表單模組通用說明 */
  moduleEngine: ModuleEngine;
}

/**
 * AppBar 的「?」模組說明(Figma Draft/AdminAppBar 的 help-button I44:119;81:51
 * + Overlay / 模組說明 81:241 的 Draft/HelpDialog 95:235)。
 * 內容是 build 時打包進來的 `src/md/module-help/<模組 key>.help.md`(`lib/base/help-registry`),
 * 表單模組沒有專屬檔時用 `form-module.help.md`;都沒有時按鈕 disabled 並在 hover 提示。
 */
export const HelpButton = ({
  moduleKey,
  moduleName,
  moduleEngine,
}: HelpButtonProps) => {
  const t = useTranslations("admin.shell.help");
  const [isOpen, setIsOpen] = useState(false);
  const markdown = moduleHelpMarkdown({ key: moduleKey, engine: moduleEngine });

  return (
    <>
      {/* disabled 的按鈕不發 hover 事件,包 span 的事情交給 Tooltip 自己處理 */}
      <Tooltip title={markdown === undefined ? t("unavailable") : ""}>
        <IconButton
          aria-label={t("open")}
          size="small"
          disabled={markdown === undefined}
          onClick={() => {
            setIsOpen(true);
          }}
          /*
           * 只給平時的顏色,不必擔心蓋掉停用色:`.Mui-disabled` 是複合選擇器
           * (specificity 0,2,0),贏得過 `sx` 產生的單一類別(0,1,0)。
           */
          sx={{ color: "text.secondary" }}
        >
          {/* Figma 的 18×18;MUI 的 small 是 20px,差 2px 視覺可接受(STYLE-06) */}
          <HelpIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {markdown !== undefined && (
        <Dialog
          open={isOpen}
          onClose={() => {
            setIsOpen(false);
          }}
          fullWidth
          maxWidth="sm"
          title={t("title", { name: moduleName })}
          actions={
            <Button
              variant="text"
              onClick={() => {
                setIsOpen(false);
              }}
            >
              {t("close")}
            </Button>
          }
        >
          {/* help.md 本身就是繁中,不進訊息檔、不翻譯 */}
          <Suspense
            fallback={
              <Stack sx={{ alignItems: "center", py: 4 }}>
                {/* 說明彈窗沒有自己的載入文案,沿用彈窗標題當無障礙名稱(同 ProvisionTenantDialog) */}
                <CircularProgress
                  aria-label={t("title", { name: moduleName })}
                />
              </Stack>
            }
          >
            <LazyMarkdown>{markdown}</LazyMarkdown>
          </Suspense>
        </Dialog>
      )}
    </>
  );
};
