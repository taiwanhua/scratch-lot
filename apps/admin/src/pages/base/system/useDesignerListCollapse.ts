import { type RefObject, useEffect, useRef, useState } from "react";

import { useIsDesignerTablet } from "./useIsDesignerTablet";

export interface DesignerListCollapse {
  /** 視窗在設計器的平板寬(`useIsDesignerTablet`) */
  isTablet: boolean;
  /** 左清單收起中(只有平板寬會收起;電腦與手機寬一律 false) */
  isCollapsed: boolean;
  /** 展開清單(焦點移到清單的 [收起] 鈕) */
  expand: () => void;
  /** 收起清單(焦點移到收起後的 [展開] 鈕) */
  collapse: () => void;
  /** 收起後那一條上的 [展開] 鈕 */
  expandButtonRef: RefObject<HTMLButtonElement | null>;
  /** 清單標頭的 [收起] 鈕 */
  collapseButtonRef: RefObject<HTMLButtonElement | null>;
}

/**
 * 設計器頁(表單管理、流程管理)的左清單收起 / 展開:平板寬一進來就是收起的(畫布優先),
 * 按 [展開] 打開,在清單裡選一筆或按 [收起] 再收起。
 *
 * 收起與否是**暫時性介面狀態**,不放網址(REACT-14:同一個網址在電腦上打開本來就沒有收起這回事);
 * 視窗從電腦縮到平板寬時也是收起的。清單收起時藏起來、不卸載(搜尋與捲動留著,同 REACT-17)。
 * 使用者按的收起 / 展開會把焦點移到另一顆鈕上(被藏起來的鈕上的焦點會掉回 body);自動收起不搶焦點。
 */
export const useDesignerListCollapse = (): DesignerListCollapse => {
  const isTablet = useIsDesignerTablet();
  const [isExpanded, setExpanded] = useState(false);
  const isCollapsed = isTablet && !isExpanded;
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  /** 使用者按了收起 / 展開:下一次 render 後把焦點移過去 */
  const focusAfterToggleRef = useRef(false);

  useEffect(() => {
    if (!focusAfterToggleRef.current) {
      return;
    }
    focusAfterToggleRef.current = false;
    (isCollapsed ? expandButtonRef : collapseButtonRef).current?.focus();
  }, [isCollapsed]);

  return {
    isTablet,
    isCollapsed,
    expand: () => {
      focusAfterToggleRef.current = true;
      setExpanded(true);
    },
    collapse: () => {
      focusAfterToggleRef.current = isTablet && isExpanded;
      setExpanded(false);
    },
    expandButtonRef,
    collapseButtonRef,
  };
};
