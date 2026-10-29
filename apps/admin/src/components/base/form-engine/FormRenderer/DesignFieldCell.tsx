import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import type { FieldDef, FieldProtection } from "@repo/domain/form";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";

import { useSortableItem } from "@/hooks/base/useSortableItem";
import { designFieldId } from "@/lib/base/form-engine/design-ids";

export interface DesignFieldCellProps {
  /** 這一格的身分(設計器內部 id;拖拉與選取都用它,不用 key) */
  cellId: string;
  field: FieldDef;
  protection: FieldProtection | undefined;
  /** 欄位 key → 顯示名(「因引用受保護欄位 X」列顯示名,不列 key) */
  labelOf: (fieldKey: string) => string;
  isSelected: boolean;
  onSelect: (cellId: string) => void;
  children: ReactNode;
}

/**
 * 設計模式的一格:**不跑條件與計算**,只在欄位上標示
 * 「有顯示條件」「有唯讀條件」「計算欄位」「受保護」「因引用受保護欄位 X 而受保護」;可選取、可拖拉(dnd-kit)。
 */
export const DesignFieldCell = ({
  field,
  cellId,
  protection,
  labelOf,
  isSelected,
  onSelect,
  children,
}: DesignFieldCellProps) => {
  const t = useTranslations("admin.formEngine.design");
  const { attributes, listeners, setNodeRef, dragSx } = useSortableItem(
    designFieldId(cellId),
  );

  const badges: string[] = [];
  if (field.visibleWhen !== undefined && field.visibleWhen !== null) {
    badges.push(t("hasVisibleWhen"));
  }
  if (field.readonlyWhen !== undefined && field.readonlyWhen !== null) {
    badges.push(t("hasReadonlyWhen"));
  }
  if (field.valueSource.kind === "computed") {
    badges.push(t("computed"));
  }
  if (field.valueSource.kind === "constant") {
    badges.push(t("constant"));
  }
  if (protection?.self === true) {
    badges.push(t("protected"));
  }
  if (protection !== undefined && protection.via.length > 0) {
    badges.push(
      t("protectedVia", {
        fields: protection.via.map((key) => labelOf(key)).join("、"),
      }),
    );
  }

  return (
    <Box
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={t("selectField", { label: field.label, key: field.key })}
      aria-describedby={attributes["aria-describedby"]}
      onClick={() => {
        onSelect(cellId);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(cellId);
        }
      }}
      {...listeners}
      sx={{
        p: 1.5,
        borderRadius: 1,
        border: "1px dashed",
        borderColor: isSelected ? "primary.main" : "divider",
        bgcolor: isSelected ? "primary.lighter" : "background.paper",
        // 拖曳中的位移、過場、抓取游標(共用 `useSortableItem`,同路由頁籤)
        ...dragSx,
      }}
    >
      <Stack spacing={1}>
        {/* 設計模式的欄位只畫外觀,輸入一律停用;點擊由外框接手 */}
        <Box sx={{ pointerEvents: "none" }}>{children}</Box>
        {badges.length > 0 && (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
            {badges.map((badge) => (
              <Tag key={badge} tone="primary" label={badge} />
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
};
