import type { ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";

/** 動作列上的一顆按鈕:文字、點擊、停用(外觀由位置決定,呼叫端不選 variant)。 */
export interface FormAction {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export interface FormActionsProps {
  /** [取消](text);不給就沒有 */
  cancel?: FormAction;
  /** [存草稿](outlined);表單不允許存草稿時不給 */
  draft?: FormAction;
  /** 主要動作 [送出] / [儲存](contained),永遠在最右 */
  submit: FormAction;
  /**
   * 動作列左側的內容(合計文字、編輯頁的 [刪除] 這類不屬於送出流程的東西);
   * 按鈕群一律靠右,這一塊佔掉剩下的寬度。
   */
  start?: ReactNode;
}

/**
 * 新增 / 編輯頁的動作列(REACT-16):放在表單底部、按鈕靠右,
 * 順序固定 [取消](text)→[存草稿](outlined)→[送出 / 儲存](contained)。
 *
 * 手機(xs)黏在可視範圍底部(`position: sticky`),並補背景、上邊框與 z-index ——
 * 少了 z-index,輸入框的浮動標籤(MUI outlined label 自帶 z-index)會捲到按鈕列上面。
 * 黏住的參照是最近的捲動容器,所以本元件放在表單的捲動區裡;頁面把動作列放在捲動區外時,
 * 它本來就固定在底部,sticky 不影響。
 */
export const FormActions = ({
  cancel,
  draft,
  submit,
  start,
}: FormActionsProps) => (
  <Stack
    direction="row"
    sx={{
      // 欄距用 gap:按鈕放不下換行時第二行仍靠右對齊,不會被 Stack spacing 的 margin 推歪
      gap: 1.5,
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "flex-end",
      flexShrink: 0,
      position: { xs: "sticky", sm: "static" },
      bottom: 0,
      // theme.zIndex.mobileStepper:蓋過欄位標籤,仍在彈窗、選單、Snackbar 之下
      zIndex: { xs: "mobileStepper", sm: "auto" },
      bgcolor: { xs: "background.paper", sm: "transparent" },
      borderTop: { xs: 1, sm: 0 },
      borderColor: "divider",
      py: { xs: 1.5, sm: 0 },
    }}
  >
    {start !== undefined && (
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
        }}
      >
        {start}
      </Box>
    )}
    {cancel !== undefined && (
      <Button
        variant="text"
        disabled={cancel.disabled ?? false}
        onClick={cancel.onClick}
      >
        {cancel.label}
      </Button>
    )}
    {draft !== undefined && (
      <Button
        variant="outlined"
        disabled={draft.disabled ?? false}
        onClick={draft.onClick}
      >
        {draft.label}
      </Button>
    )}
    <Button
      variant="contained"
      disabled={submit.disabled ?? false}
      onClick={submit.onClick}
    >
      {submit.label}
    </Button>
  </Stack>
);
