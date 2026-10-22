import { useCallback, useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useIsAtRootOrg } from "@/hooks/base/useIsAtRootOrg";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useUrlEdit, useUrlEditGuard } from "@/hooks/base/useUrlEdit";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";
import { useDesignerDraftStore } from "@/stores/base/useDesignerDraftStore";

import { FormDetailPanel } from "./FormDetailPanel";
import { CreateFormDialog } from "./FormDialogs/CreateFormDialog";
import { FormListPanel } from "./FormListPanel";
import { FormMobileSummary } from "./FormMobileSummary";
import { UnsavedDesignDialog } from "./UnsavedDesignDialog";
import { FORMS_PERMISSIONS } from "./forms-permissions";
import { useFormsPageData } from "./useFormsPageData";

/**
 * 表單管理(模組 key `system.forms`,正本 `docs/modules/forms.md`)。
 * 左欄是表單清單,右欄是選中表單的設計器與版本面板;分派、以此為基底建新表單、編輯名稱是右欄的跳窗。
 *
 * **不是**根組織專屬:root 管共用表單,租戶管理員管自己的客製表單、開關分派來的表單。
 * 「建立表單」只有站在根組織做得到(租戶只能以某版本為基底建客製表單),租戶按了 api 回 `ROOT_ONLY`。
 *
 * **手機寬(< `sm`)一次只顯示一邊,而且不提供設計**:網址沒有選取(`?detail=` / `?edit=`)時清單滿版;
 * 點一張表單 → 只顯示它的基本資料與設定摘要(`FormMobileSummary`,唯讀)與「請用平板或電腦設計、編輯」的提示,
 * 設計器不掛載。頂部 [← 返回] 清掉選取回到清單(清單藏起來不卸載,搜尋與捲動都留著)。
 */
export const FormsPage = () => {
  const t = useTranslations("admin.forms");
  const { hasPermission } = usePermissions();
  /**
   * 編輯彈窗記在網址 `?edit=<key>`(REACT-14):編的就是右欄選中的那一個,所以網址上的 key 同時是選中的;
   * 清單查完還沒有 → 提示找不到,沒有編輯權限(`abilities.canEdit`)→ 停在它的詳情。
   */
  const edit = useUrlEdit();
  const data = useFormsPageData(edit.requestedId);
  const selectItem = data.select;
  const keepDetail = useCallback(
    (key: string) => {
      selectItem(key);
    },
    [selectItem],
  );
  const editingKey = useUrlEditGuard({
    edit,
    canEdit:
      data.selected !== null && data.selected.key === edit.requestedId
        ? data.selected.abilities.canEdit
        : undefined,
    isMissing:
      edit.requestedId !== null &&
      data.isListSettled &&
      data.selectedKey !== edit.requestedId,
    onNoPermission: keepDetail,
  });
  /** 關掉編輯彈窗:停在剛編的那一個(網址 `?detail=` 記下它) */
  const closeEdit = () => {
    if (editingKey !== null) {
      selectItem(editingKey);
    }
    edit.close();
  };
  const [isCreating, setIsCreating] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const isDirty = useDesignerDraftStore(
    (state) => state.isDirty && state.formKey === data.selectedKey,
  );
  const saveDraft = useDesignerDraftStore((state) => state.save);
  const isAtRoot = useIsAtRootOrg() === true;
  const isMobile = useBreakpointDown("sm");
  const [urlPickedKey, setUrlPickedKey] = useUrlSelectedId();
  const isDetailShown = urlPickedKey !== null || edit.requestedId !== null;

  /** 換表單:設計器有未存的變更就先問(留下 / 放棄 / 先存),不讓右欄一換就把改動丟掉。 */
  const requestSelect = (key: string) => {
    // 同一筆不經過未存攔截(沒有要離開);網址還沒有選取時寫進去(手機寬才點得進預設那一筆)
    if (key === data.selectedKey) {
      if (urlPickedKey === null) {
        data.select(key);
      }
      return;
    }
    if (isDirty) {
      setPendingKey(key);
      return;
    }
    data.select(key);
  };

  const emptyText =
    data.isLoading || data.isSelectionPending ? t("loading") : t("empty");
  /** sm 以上的右欄(手機寬改由 `FormMobileSummary` 顯示唯讀摘要) */
  const desktopDetail =
    data.selected === null ? (
      <Card sx={{ flex: 1, p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      </Card>
    ) : (
      <FormDetailPanel
        key={data.selected.key}
        form={data.selected}
        isEditing={editingKey === data.selected.key}
        onEdit={edit.open}
        onEditClose={closeEdit}
        onChanged={() => {
          void data.invalidate(data.selectedKey);
        }}
        onForked={(formKey) => {
          void data.invalidate(formKey);
          requestSelect(formKey);
        }}
      />
    );

  return (
    <Stack
      direction="row"
      spacing={{ xs: 0, sm: 3 }}
      sx={{ flex: 1, minHeight: 0 }}
    >
      {/* sm 以上這層不參與排版(contents,仍標 minHeight: 0 守 STYLE-08 高度鏈);手機寬依選取只顯示一邊,另一邊藏起來但不卸載 */}
      <Box
        sx={
          isMobile
            ? {
                display: isDetailShown ? "none" : "flex",
                flex: 1,
                minWidth: 0,
                minHeight: 0,
              }
            : { display: "contents", minHeight: 0 }
        }
      >
        <FormListPanel
          forms={data.forms}
          isLoading={data.isLoading}
          keyword={data.keyword}
          onKeywordChange={data.setKeyword}
          selectedKey={isMobile ? urlPickedKey : data.selectedKey}
          onSelect={requestSelect}
          canCreate={isAtRoot && hasPermission(FORMS_PERMISSIONS.create)}
          onCreate={() => {
            setIsCreating(true);
          }}
        />
      </Box>
      {isMobile ? (
        <FormMobileSummary
          form={data.selected}
          emptyText={emptyText}
          isShown={isDetailShown}
          onBack={() => {
            edit.close();
            setUrlPickedKey(null);
          }}
        />
      ) : (
        desktopDetail
      )}
      {pendingKey !== null && (
        <UnsavedDesignDialog
          onStay={() => {
            setPendingKey(null);
          }}
          onDiscard={() => {
            data.select(pendingKey);
            setPendingKey(null);
          }}
          onSaveAndLeave={async () => {
            const isSaved = saveDraft === null || (await saveDraft()) !== null;
            if (isSaved) {
              data.select(pendingKey);
            }
            setPendingKey(null);
            return isSaved;
          }}
        />
      )}
      {isCreating && (
        <CreateFormDialog
          onClose={() => {
            setIsCreating(false);
          }}
          onCreated={(formKey) => {
            setIsCreating(false);
            void data.invalidate(formKey);
            requestSelect(formKey);
          }}
        />
      )}
    </Stack>
  );
};
