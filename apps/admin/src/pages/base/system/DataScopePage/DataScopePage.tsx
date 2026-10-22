import { useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";

import { DiscardChangesDialog } from "./DiscardChangesDialog";
import { RuleEditorPanel } from "./RuleEditorPanel/RuleEditorPanel";
import { TargetListPanel } from "./TargetListPanel";
import { useDataScopeData } from "./useDataScopeData";

/**
 * 資料範圍(模組 key `system.data-scope`,正本 `docs/modules/data-scope.md`;
 * Figma「Screen / Admin 資料範圍」166:318 + 註記卡 167:1901)。**根組織專屬**。
 *
 * 左選資料目標(一列 = 一個模組)→ 右顯示該目標的說明、預設提示與規則編輯器。編輯器的草稿住在
 * `RuleEditorPanel`,靠 `key={target.id}` 換目標時重新掛載;頁面只保管兩件跨兩邊的事:
 * 有沒有未儲存的變更、以及被它擋下來的那次切換。
 *
 * **手機寬(< `sm`)一次只顯示一邊**:網址沒有選取(`?detail=`)時目標清單滿版;點一個目標 → 編輯器滿版,
 * 頂部 [← 返回] 清掉選取回到清單(有未儲存的變更一樣先問)。清單藏起來不卸載,捲動位置留著。
 */
export const DataScopePage = () => {
  const t = useTranslations("admin.dataScope.editor");
  const tPage = useTranslations("admin.dataScope");
  const data = useDataScopeData();
  const isMobile = useBreakpointDown("sm");
  const [urlPickedTargetId] = useUrlSelectedId();
  const isDetailShown = urlPickedTargetId !== null;

  const [isDirty, setIsDirty] = useState(false);
  /**
   * 有未儲存變更時被擋下來的切換;確認放棄後才真的切過去。
   * `targetId` null = 手機寬按 [← 返回] 回清單。
   */
  const [pending, setPending] = useState<{ targetId: string | null } | null>(
    null,
  );

  const handleSelectTarget = (targetId: string) => {
    // 手機寬沒有網址選取時,預設選中的那一筆也要點得進去
    if (targetId === data.selectedTargetId && urlPickedTargetId !== null) {
      return;
    }
    if (isDirty) {
      setPending({ targetId });
      return;
    }
    data.selectTarget(targetId);
  };

  const handleBack = () => {
    if (isDirty) {
      setPending({ targetId: null });
      return;
    }
    data.selectTarget(null);
  };

  const confirmDiscard = () => {
    if (pending !== null) {
      data.selectTarget(pending.targetId);
    }
    setPending(null);
    setIsDirty(false);
  };

  return (
    // 撐滿殼給的內容區高度(STYLE-08:左右兩塊等高、各自內部捲動)
    // 手機寬不釘高(STYLE-08):主從兩塊依內容長高、交給 <main> 捲;sm 起才撐滿殼高、各自內部捲動
    <Stack
      direction="row"
      spacing={{ xs: 0, sm: 3 }}
      sx={{ flex: { xs: "1 0 auto", sm: 1 }, minHeight: 0 }}
    >
      {/* sm 以上這層不參與排版(contents,仍標 minHeight: 0 守 STYLE-08 高度鏈);手機寬依選取只顯示一邊,另一邊藏起來但不卸載 */}
      <Box
        sx={
          isMobile
            ? { display: isDetailShown ? "none" : "flex", flex: 1, minWidth: 0 }
            : { display: "contents", minHeight: 0 }
        }
      >
        <TargetListPanel
          targets={data.targets}
          isLoading={data.isTargetsLoading}
          selectedTargetId={
            isMobile ? urlPickedTargetId : data.selectedTargetId
          }
          onSelectTarget={handleSelectTarget}
        />
      </Box>

      <Box
        sx={
          isMobile
            ? {
                display: isDetailShown ? "flex" : "none",
                flexDirection: "column",
                gap: 1,
                flex: 1,
                minWidth: 0,
              }
            : { display: "contents", minHeight: 0 }
        }
      >
        {isMobile && (
          <Box>
            <Button variant="text" size="small" onClick={handleBack}>
              {tPage("mobileBack")}
            </Button>
          </Box>
        )}
        {data.target === undefined || data.isRuleLoading ? (
          <Card
            component="section"
            aria-label={t("region")}
            sx={{ flex: 1, minWidth: 0, minHeight: 0, p: 3, overflow: "auto" }}
          >
            <Stack sx={{ alignItems: "center", py: 4 }}>
              {data.isTargetsLoading || data.isRuleLoading ? (
                <CircularProgress aria-label={t("loading")} />
              ) : (
                <Typography variant="body2">{t("empty")}</Typography>
              )}
            </Stack>
          </Card>
        ) : (
          <RuleEditorPanel
            key={data.target.id}
            target={data.target}
            rule={data.rule}
            canEdit={data.canEdit}
            userOptions={data.userOptions}
            orgOptions={data.orgOptions}
            onSaved={(targetId) => {
              void data.invalidate(targetId);
            }}
            onDirtyChange={setIsDirty}
          />
        )}
      </Box>

      {pending !== null && (
        <DiscardChangesDialog
          onCancel={() => {
            setPending(null);
          }}
          onConfirm={confirmDiscard}
        />
      )}
    </Stack>
  );
};
