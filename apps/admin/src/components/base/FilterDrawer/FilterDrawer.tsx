import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Drawer } from "@repo/ui/drawer";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";

export interface FilterDrawerProps<Value> {
  /** 目前套用中的篩選值(通常來自 `useUrlState`) */
  value: Value;
  /** [清除] 後的值(全部不篩) */
  emptyValue: Value;
  /** 套用:電腦版每改一欄就套用;平板 / 手機按 [套用] 才套用 */
  onApply: (value: Value) => void;
  /** 已套用的篩選數(按鈕上的括號);0 = 只顯示「篩選」 */
  activeCount: number;
  /**
   * 篩選欄位:拿到「要顯示的值」與「改值的函式」。電腦版給的是套用中的值(改了立刻套用),
   * 抽屜裡給的是草稿(按 [套用] 才寫回)。
   */
  renderFields: (value: Value, change: (next: Value) => void) => ReactNode;
  /** 一直顯示在外面的欄位(例:關鍵字搜尋框);抽屜模式時接在 [篩選] 左邊 */
  search?: ReactNode;
}

/**
 * 列表的篩選(規格 16.0 / Figma RW-01、RW-01b 224:1855 / 224:1952):
 * - 電腦(≥ `lg`):篩選欄位攤在列表上方(篩選列),改了立刻套用
 * - 平板(`sm`–`lg`):[篩選 (N)] 從**右側**滑出抽屜;手機(< `sm`):從**底部**升起
 * - 抽屜內是同一組欄位 + [清除] [套用];改的是草稿,按 [套用] 才寫回、關抽屜;關掉不套用
 *
 * 底座元件(之後回收到底座):抽屜外框是 `@repo/ui/drawer`。
 */
export const FilterDrawer = <Value,>({
  value,
  emptyValue,
  onApply,
  activeCount,
  renderFields,
  search,
}: FilterDrawerProps<Value>) => {
  const t = useTranslations("admin.filterDrawer");
  const isNarrow = useBreakpointDown("lg");
  const isMobile = useBreakpointDown("sm");
  const [isOpen, setOpen] = useState(false);
  /** 抽屜裡的草稿;關閉動畫結束才清掉(否則收起途中欄位會先消失) */
  const [draft, setDraft] = useState<Value | null>(null);

  if (!isNarrow) {
    return (
      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap" }}>
        {renderFields(value, onApply)}
        {search}
      </Stack>
    );
  }

  const close = () => {
    setOpen(false);
  };

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
      {search}
      <Button
        variant="outlined"
        sx={{ flexShrink: 0 }}
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
      >
        {activeCount > 0
          ? t("buttonCount", { count: activeCount })
          : t("button")}
      </Button>
      <Drawer
        open={isOpen}
        slotProps={{
          transition: {
            onExited: () => {
              setDraft(null);
            },
          },
        }}
        anchor={isMobile ? "bottom" : "right"}
        title={t("title")}
        closeLabel={t("close")}
        onClose={close}
        actions={
          <>
            <Button
              variant="outlined"
              onClick={() => {
                setDraft(emptyValue);
              }}
            >
              {t("clear")}
            </Button>
            <Button
              onClick={() => {
                if (draft !== null) {
                  onApply(draft);
                }
                close();
              }}
            >
              {t("apply")}
            </Button>
          </>
        }
      >
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {draft !== null && renderFields(draft, setDraft)}
        </Stack>
      </Drawer>
    </Stack>
  );
};
