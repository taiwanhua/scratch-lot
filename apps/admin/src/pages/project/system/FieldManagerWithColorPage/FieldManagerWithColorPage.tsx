import { useTranslations } from "use-intl";

import { FieldManager } from "@/components/base/FieldManager/FieldManager";
import type { FieldOptionColumnsSlot } from "@/components/base/FieldManager/field-manager-types";

import { FieldOptionColorCell } from "./FieldOptionColorCell";

/**
 * 欄位管理的客製替換頁(`app/project/page-replacements.ts` 換掉 `system.field-manager`;規格 18.5)。
 * 以底座欄位管理的零件組成(`components/base/FieldManager/`),選項表在「顯示名稱」後面多一欄「顏色」
 * (Figma BS-13 289:87534):只能從十組色票選,不能輸入色碼。
 *
 * 升格後底座欄位管理頁直接有顏色欄,這一頁與替換登記一起拆掉(規格 18.5)。
 */
export const FieldManagerWithColorPage = () => {
  const t = useTranslations("admin.fieldOptionColors");
  const colorColumns: FieldOptionColumnsSlot = (category) => [
    {
      key: "color",
      header: t("column"),
      width: 96,
      render: (field) => (
        <FieldOptionColorCell field={field} categoryKey={category.key} />
      ),
    },
  ];
  return <FieldManager extraOptionColumns={colorColumns} />;
};
