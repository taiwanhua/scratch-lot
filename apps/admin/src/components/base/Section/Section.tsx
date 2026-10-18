import type { ReactNode } from "react";

import { Section as UiSection } from "@repo/ui/section";

import { useSectionCollapse } from "@/hooks/base/useSectionCollapse";

export interface SectionProps {
  /**
   * 頁面 id:`<模組 key>.create` / `<模組 key>.edit` / `<模組 key>.detail` 三選一
   * (新增 / 編輯 / 詳情分開記,預設值可以不同)。表單引擎不用這個元件,`FormRenderer` 自己帶 `form:<formKey>`。
   */
  pageId: string;
  /** 區塊 key:頁面內唯一,例 `contact` */
  sectionKey: string;
  title: ReactNode;
  /** 收合時接在標題後的摘要 */
  summary?: ReactNode;
  /** 使用者沒改過時是否收合。不給 = false */
  defaultCollapsed?: boolean;
  children?: ReactNode;
}

/**
 * 一般頁面的可收合區塊:`@repo/ui/section` + 收合狀態記憶。
 * 使用者手動切換後依登入者記在 localStorage(`<頁面 id>.<區塊 key>`,只記與預設不同的);
 * 規則見 `lib/base/section-collapse.ts`。這個元件只管自己那一塊,不清別的區塊的紀錄。
 */
export const Section = ({
  pageId,
  sectionKey,
  title,
  summary,
  defaultCollapsed = false,
  children,
}: SectionProps) => {
  const collapse = useSectionCollapse(pageId);
  return (
    <UiSection
      title={title}
      summary={summary}
      collapsed={collapse.isCollapsed(sectionKey, defaultCollapsed)}
      onCollapsedChange={(collapsed) => {
        collapse.setCollapsed(sectionKey, collapsed, defaultCollapsed);
      }}
    >
      {children}
    </UiSection>
  );
};
