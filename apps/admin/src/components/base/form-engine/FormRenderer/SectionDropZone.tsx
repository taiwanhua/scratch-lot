import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Typography } from "@repo/ui/typography";

import { sectionDropId } from "@/lib/base/form-engine/design-ids";

export interface SectionDropZoneProps {
  sectionKey: string;
}

/** 設計模式:每個分區最後一格放置區(拖到這裡 = 放在分區最後;空分區也拖得進來)。 */
export const SectionDropZone = ({ sectionKey }: SectionDropZoneProps) => {
  const t = useTranslations("admin.formEngine.design");
  const { setNodeRef, isOver } = useDroppable({
    id: sectionDropId(sectionKey),
  });

  return (
    <Box
      ref={setNodeRef}
      sx={{
        p: 1.5,
        borderRadius: 1,
        border: "1px dashed",
        borderColor: isOver ? "primary.main" : "divider",
        textAlign: "center",
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {t("dropHere")}
      </Typography>
    </Box>
  );
};
