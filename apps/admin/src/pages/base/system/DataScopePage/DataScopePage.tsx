import { useState } from "react";
import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

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
 */
export const DataScopePage = () => {
  const t = useTranslations("admin.dataScope.editor");
  const data = useDataScopeData();

  const [isDirty, setIsDirty] = useState(false);
  /** 有未儲存變更時被擋下來的目標;確認放棄後才真的切過去 */
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);

  const handleSelectTarget = (targetId: string) => {
    if (targetId === data.selectedTargetId) {
      return;
    }
    if (isDirty) {
      setPendingTargetId(targetId);
      return;
    }
    data.selectTarget(targetId);
  };

  const confirmDiscard = () => {
    if (pendingTargetId !== null) {
      data.selectTarget(pendingTargetId);
    }
    setPendingTargetId(null);
    setIsDirty(false);
  };

  return (
    // 撐滿殼給的內容區高度(STYLE-08:左右兩塊等高、各自內部捲動)
    // 手機寬不釘高(STYLE-08):主從兩塊依內容長高、交給 <main> 捲;sm 起才撐滿殼高、各自內部捲動
    <Stack
      direction="row"
      spacing={3}
      sx={{ flex: { xs: "1 0 auto", sm: 1 }, minHeight: 0 }}
    >
      <TargetListPanel
        targets={data.targets}
        isLoading={data.isTargetsLoading}
        selectedTargetId={data.selectedTargetId}
        onSelectTarget={handleSelectTarget}
      />

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

      {pendingTargetId !== null && (
        <DiscardChangesDialog
          onCancel={() => {
            setPendingTargetId(null);
          }}
          onConfirm={confirmDiscard}
        />
      )}
    </Stack>
  );
};
