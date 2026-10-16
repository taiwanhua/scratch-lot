import { ReferenceField } from "../ReferenceField";
import { BooleanWidget } from "./BooleanWidget";
import { ChoiceWidget } from "./ChoiceWidget";
import { DateTimeWidget } from "./DateTimeWidget";
import { DateWidget } from "./DateWidget";
import { MultiChoiceWidget } from "./MultiChoiceWidget";
import { NumberWidget } from "./NumberWidget";
import { TextWidget } from "./TextWidget";
import { UploadWidget } from "./UploadWidget";
import type { WidgetComponent } from "./widget-types";

/**
 * 單值欄位的 widget(`widget.kind` → 元件)。明細列(`table`)的每一格也從這裡取元件,所以明細元件
 * 本身不在這張表(否則 `ArrayTableWidget` ↔ 登錄表互相 import);完整的登錄表在 `widget-registry.ts`。
 */
export const BASE_WIDGET_REGISTRY: Readonly<Record<string, WidgetComponent>> = {
  textField: TextWidget,
  textArea: TextWidget,
  number: NumberWidget,
  datePicker: DateWidget,
  dateTimePicker: DateTimeWidget,
  dropdown: ChoiceWidget,
  radio: ChoiceWidget,
  autocomplete: ChoiceWidget,
  checkboxGroup: MultiChoiceWidget,
  multiDropdown: MultiChoiceWidget,
  autocompleteMulti: MultiChoiceWidget,
  switch: BooleanWidget,
  checkbox: BooleanWidget,
  upload: UploadWidget,
  referencePicker: ReferenceField,
};

/** 單值 widget;認不得的 kind 退回純文字欄,畫面不炸。 */
export const baseWidgetOf = (kind: string): WidgetComponent =>
  BASE_WIDGET_REGISTRY[kind] ?? TextWidget;
