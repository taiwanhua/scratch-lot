import { useState } from "react";
import { useTranslations } from "use-intl";

import type { Audience } from "@repo/domain/audience";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Typography } from "@repo/ui/typography";

import { useAudienceSummary } from "@/components/base/AudiencePicker/useAudienceSummary";

import { AudienceConditionDialog } from "./AudienceConditionDialog";
import type { PeoplePurpose } from "./people-purpose";
import type { ApproverAudienceSetup } from "./useApproverAudienceSetup";

export interface AudienceSourceSummaryProps {
  /** 用途:審核者 / 知會對象 / 通知對象(框的標題與對話框標題) */
  purpose: PeoplePurpose;
  audience: Audience;
  stepName: string;
  isShared: boolean;
  setup: ApproverAudienceSetup;
  isDisabled: boolean;
  onChange: (audience: Audience) => void;
}

/**
 * 關卡面板的人員條件框(Figma BS-02a / c、BS-03):條件摘要一行白話 + [編輯條件](開 `AudienceConditionDialog`;
 * [套用] 才寫回,[取消] 不動)。審核者、知會對象、逾時通知對象共用,標題依 `purpose`。
 * 欄位與組織來源見 `useApproverAudienceSetup`。
 */
export const AudienceSourceSummary = ({
  purpose,
  audience,
  stepName,
  isShared,
  setup,
  isDisabled,
  onChange,
}: AudienceSourceSummaryProps) => {
  const t = useTranslations("admin.workflows.assignee");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const summaryOf = useAudienceSummary(setup.fields, setup.orgSources);
  const summary = summaryOf(audience);

  return (
    <Box
      sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.5, py: 1.25 }}
      role="group"
      aria-label={t(`purposes.${purpose}.audienceRegion`)}
    >
      <Typography variant="caption" color="text.secondary" component="p">
        {t(`purposes.${purpose}.audienceTitle`)}
      </Typography>
      <Typography variant="body2" sx={{ my: 0.75 }}>
        {summary === "" ? t("audienceEmpty") : summary}
      </Typography>
      {!isDisabled && (
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            setIsDialogOpen(true);
          }}
        >
          {t("audienceEdit")}
        </Button>
      )}
      {isDialogOpen && (
        <AudienceConditionDialog
          purpose={purpose}
          stepName={stepName}
          isShared={isShared}
          initial={setup.initialDraftOf(audience)}
          fields={setup.fields}
          orgSources={setup.orgSources}
          onCancel={() => {
            setIsDialogOpen(false);
          }}
          onApply={(next) => {
            onChange(next as unknown as Audience);
            setIsDialogOpen(false);
          }}
        />
      )}
    </Box>
  );
};
