import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { type LayoutSection, sectionCollapseOf } from "@repo/domain/form";

import { useSectionCollapse } from "@/hooks/base/useSectionCollapse";
import type { FormRendererMode } from "@/lib/base/form-engine/field-states";
import type { FormFieldErrorLike } from "@/lib/base/form-engine/form-errors";
import { formSectionPageId } from "@/lib/base/section-collapse";

/** 格子上標的欄位 key(捲到第一個錯誤時用它找元素)。 */
export const FIELD_KEY_ATTRIBUTE = "data-field-key";

const FIELD_KEY_SELECTOR = "[data-field-key]";

const REMEMBERED_MODES: ReadonlySet<FormRendererMode> = new Set([
  "create",
  "edit",
  "readonly",
]);

export interface FormSectionsInput {
  sections: readonly LayoutSection[];
  /** 每個分區畫得到的欄位 key(依版面順序;看不到的欄位不在裡面) */
  fieldKeysBySection: ReadonlyMap<string, readonly string[]>;
  formKey: string;
  mode: FormRendererMode;
  fieldErrors: readonly FormFieldErrorLike[];
}

export interface FormSections {
  /** 包住全部分區的容器(捲動定位從這裡找格子) */
  containerRef: RefObject<HTMLDivElement | null>;
  isCollapsed: (section: LayoutSection) => boolean;
  /** 使用者手動切換(寫入記憶;該分區不再算「因錯誤暫時展開」) */
  toggle: (section: LayoutSection, collapsed: boolean) => void;
}

interface Revealed {
  /** 觸發展開的那一批錯誤(同一批不重複展開,使用者之後手動收合就照他的) */
  errors: readonly FormFieldErrorLike[] | null;
  sectionKeys: ReadonlySet<string>;
}

/** 新增 / 編輯 / 檢視才記憶;預覽(草稿)不記,設計模式不收合。 */
const pageIdOf = (formKey: string, mode: FormRendererMode): string | null =>
  REMEMBERED_MODES.has(mode) ? formSectionPageId(formKey) : null;

/**
 * 表單分區的收合(底座 10.3):
 * - 記憶:頁面 id `form:<formKey>`、區塊 key = `LayoutSection.key`(`useSectionCollapse`;打開時清掉已不存在的分區)
 * - 送出有錯 → 有錯的分區全部展開、捲到版面順序第一個錯誤;這是暫時的,不寫入記憶(重新整理後回到記住的狀態)
 */
export const useFormSections = ({
  sections,
  fieldKeysBySection,
  formKey,
  mode,
  fieldErrors,
}: FormSectionsInput): FormSections => {
  const sectionKeys = useMemo(
    () => sections.map((section) => section.key),
    [sections],
  );
  const pageId = pageIdOf(formKey, mode);
  const collapse = useSectionCollapse(
    pageId,
    pageId === null ? undefined : sectionKeys,
  );
  const isActive = mode !== "design";

  const [revealed, setRevealed] = useState<Revealed>({
    errors: null,
    sectionKeys: new Set(),
  });
  // 新的一批錯誤:render 期依 props 調整 state(REACT-06 不在 effect 裡 setState)
  if (isActive && fieldErrors.length > 0 && revealed.errors !== fieldErrors) {
    const errorKeys = new Set(fieldErrors.map((error) => error.fieldKey));
    setRevealed({
      errors: fieldErrors,
      sectionKeys: new Set(
        sectionKeys.filter((key) =>
          (fieldKeysBySection.get(key) ?? []).some((fieldKey) =>
            errorKeys.has(fieldKey),
          ),
        ),
      ),
    });
  }

  // 版面順序的第一個錯誤欄位
  const firstErrorKey = useMemo(() => {
    const errorKeys = new Set(fieldErrors.map((error) => error.fieldKey));
    for (const key of sectionKeys) {
      const found = (fieldKeysBySection.get(key) ?? []).find((fieldKey) =>
        errorKeys.has(fieldKey),
      );
      if (found !== undefined) {
        return found;
      }
    }
    return null;
  }, [fieldErrors, sectionKeys, fieldKeysBySection]);

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isActive || fieldErrors.length === 0 || firstErrorKey === null) {
      return;
    }
    const target = [
      ...(containerRef.current?.querySelectorAll<HTMLElement>(
        FIELD_KEY_SELECTOR,
      ) ?? []),
    ].find(
      (element) => element.getAttribute(FIELD_KEY_ATTRIBUTE) === firstErrorKey,
    );
    // jsdom 沒有 scrollIntoView;瀏覽器都有
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isActive, fieldErrors, firstErrorKey]);

  return {
    containerRef,
    isCollapsed: (section) => {
      const settings = sectionCollapseOf(section);
      return (
        isActive &&
        settings.collapsible &&
        !revealed.sectionKeys.has(section.key) &&
        collapse.isCollapsed(section.key, settings.defaultCollapsed)
      );
    },
    toggle: (section, collapsed) => {
      if (revealed.sectionKeys.has(section.key)) {
        const rest = new Set(revealed.sectionKeys);
        rest.delete(section.key);
        setRevealed({ errors: revealed.errors, sectionKeys: rest });
      }
      collapse.setCollapsed(
        section.key,
        collapsed,
        sectionCollapseOf(section).defaultCollapsed,
      );
    },
  };
};
