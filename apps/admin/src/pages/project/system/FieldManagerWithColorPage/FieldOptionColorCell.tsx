import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import {
  type SetFieldOptionColorMutation,
  useFieldOptionColorsQuery,
  useSetFieldOptionColorMutation,
} from "@repo/graphql";
import { Typography } from "@repo/ui/typography";

import { fieldManagerErrorOf } from "@/components/base/FieldManager/field-manager-error";
import { FIELD_MANAGER_PERMISSIONS } from "@/components/base/FieldManager/field-manager-permissions";
import type { FieldOptionLike } from "@/components/base/FieldManager/field-manager-types";
import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import { TagPaletteSelect } from "@/components/project/TagPaletteSelect/TagPaletteSelect";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useFieldOptionColors } from "@/hooks/project/useFieldOptionColors";

export interface FieldOptionColorCellProps {
  field: FieldOptionLike;
  categoryKey: string;
}

/**
 * 選項表「顏色」欄的一格(Figma BS-13 289:87534)。
 *
 * 誰能改 = 誰能停用 / 啟用這一筆(api 的 `canToggleEnabled`:自訂選項限加它的那一層、全域選項限根組織)
 * 再與 `system.field-manager.edit` 取交集;改得動 → 標籤本身可點、開色票面板;改不動 → 只顯示標籤,沒有顏色顯示「不設定」文字(Figma 289:87612)。
 * 同一類別的顏色只查一次(各格共用同一個 query)。
 */
export const FieldOptionColorCell = ({
  field,
  categoryKey,
}: FieldOptionColorCellProps) => {
  const t = useTranslations("admin.fieldOptionColors");
  const tErrors = useTranslations("admin.fieldManager.errors");
  const tPalette = useTranslations("admin.tagPalettes.select");
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const colors = useFieldOptionColors(categoryKey);
  const paletteKey = colors.byFieldId.get(field.id) ?? null;

  const setColor = useSetFieldOptionColorMutation(
    session.client,
    useMutationFeedback<SetFieldOptionColorMutation>({
      success: t("feedback.success"),
      error: (error) => tErrors(fieldManagerErrorOf(error).code),
      onSuccess: () => {
        // 只有這個類別的顏色會變(DATA-02 / 04);選項清單本身不受影響
        void queryClient.invalidateQueries({
          queryKey: useFieldOptionColorsQuery.getKey({ categoryKey }),
        });
      },
    }),
  );

  const canSet =
    field.canToggleEnabled && hasPermission(FIELD_MANAGER_PERMISSIONS.edit);
  if (!canSet) {
    return paletteKey === null ? (
      <Typography component="span" variant="body2" color="text.secondary">
        {tPalette("none")}
      </Typography>
    ) : (
      <TagPaletteChip paletteKey={paletteKey} />
    );
  }
  return (
    <TagPaletteSelect
      value={paletteKey}
      label={t("selectAria", { name: field.label })}
      disabled={colors.isLoading || setColor.isPending}
      onChange={(next) => {
        setColor.mutate({ input: { fieldId: field.id, paletteKey: next } });
      }}
    />
  );
};
