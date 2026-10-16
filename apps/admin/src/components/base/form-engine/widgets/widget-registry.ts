import { DEFAULT_WIDGET_REGISTRY } from "@repo/domain/form";

import { ArrayTableWidget } from "./ArrayTableWidget/ArrayTableWidget";
import { BASE_WIDGET_REGISTRY, baseWidgetOf } from "./widget-registry-core";
import type { WidgetComponent } from "./widget-types";

/**
 * admin 的 widget 登錄表(Spec 6a §5:`widget.kind` → 元件)。與 domain 的
 * `DEFAULT_WIDGET_REGISTRY`(型別 → 可用的 kind,檢查器用)成對:**擴充一個 widget = 兩邊各加一筆**。
 * 同一個元件可以負責好幾個 kind(單選的三種都是 `ChoiceWidget`,依 `widget.kind` 換畫法)。
 * 單值欄位的元件在 `widget-registry-core.ts`(明細列的每一格也用它們);這裡再加上明細列的 `table`。
 */
export const WIDGET_REGISTRY: Readonly<Record<string, WidgetComponent>> = {
  ...BASE_WIDGET_REGISTRY,
  table: ArrayTableWidget,
};

/** 登錄表裡有、domain 也認得的 kind(設計器的 widget 下拉只列這些)。 */
export const widgetKindsFor = (
  type: keyof typeof DEFAULT_WIDGET_REGISTRY,
): readonly string[] =>
  DEFAULT_WIDGET_REGISTRY[type].filter((kind) => kind in WIDGET_REGISTRY);

/** 認不得的 kind(檢查器會報 `WIDGET_UNKNOWN`)退回純文字欄,畫面不炸。 */
export const widgetOf = (kind: string): WidgetComponent =>
  kind === "table" ? ArrayTableWidget : baseWidgetOf(kind);
