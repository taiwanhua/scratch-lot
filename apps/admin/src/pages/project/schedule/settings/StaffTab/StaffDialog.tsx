import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { SCHEDULE_EMPLOYMENT_TYPES } from "@repo/domain/project/schedule-settings";
import {
  type ScheduleStaffRowFieldsFragment,
  useOrgTreeQuery,
  useScheduleStaffQuery,
  useUpdateScheduleStaffMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { flattenOrgs } from "@/lib/base/org-tree";

import { scheduleErrorOf } from "../../schedule-error";

interface StaffOrg {
  orgId: string;
  orgName: string;
  canLead: boolean;
  isPrimary: boolean;
}

export interface StaffDialogProps {
  row: ScheduleStaffRowFieldsFragment;
  canEdit: boolean;
  onClose: () => void;
}

/**
 * 排班人員設定(SC-26):僱用類型、可以排的分店(可擔任負責人、主要分店,每人一家主要分店)。
 * 分店只能加自己看得到的(api 擋);主要分店在看不到的分店時,這裡不能再設主要分店。
 * 沒有 `edit-staff` 時欄位停用、只剩 [關閉]。手機全螢幕。
 */
export const StaffDialog = ({ row, canEdit, onClose }: StaffDialogProps) => {
  const t = useTranslations("admin.schedule.staff.dialog");
  const tStaff = useTranslations("admin.schedule.staff");
  const tCommon = useTranslations("admin.schedule.common");
  const tEmployment = useTranslations("admin.schedule.employment");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const orgTree = useOrgTreeQuery(session.client);
  const orgNames = new Map(
    flattenOrgs(orgTree.data?.orgTree ?? []).map((org) => [org.id, org.name]),
  );
  const staff = row.staff;
  const [employmentType, setEmploymentType] = useState(
    staff?.employmentType ?? "full-time",
  );
  const [orgs, setOrgs] = useState<StaffOrg[]>(() =>
    (staff?.orgs ?? []).map((org) => ({
      orgId: org.orgId,
      orgName: org.orgName,
      canLead: org.canLead,
      isPrimary: org.isPrimary,
    })),
  );
  const primaryElsewhere = staff?.primaryElsewhere ?? false;
  const needsPrimary =
    !primaryElsewhere && orgs.length > 0 && !orgs.some((org) => org.isPrimary);

  const update = useUpdateScheduleStaffMutation(
    session.client,
    useMutationFeedback({
      success: tStaff("feedback.updateSuccess"),
      error: (error) => tErrors(scheduleErrorOf(error).code),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: useScheduleStaffQuery.getKey(),
        });
        onClose();
      },
    }),
  );

  const patch = (orgId: string, next: Partial<StaffOrg>) => {
    setOrgs((current) =>
      current.map((org) => {
        if (next.isPrimary === true) {
          return {
            ...org,
            ...(org.orgId === orgId ? next : { isPrimary: false }),
          };
        }
        return org.orgId === orgId ? { ...org, ...next } : org;
      }),
    );
  };

  const removeOrg = (orgId: string) => {
    setOrgs((current) => current.filter((item) => item.orgId !== orgId));
  };

  const addOrg = (orgId: string | undefined) => {
    if (orgId === undefined || orgs.some((org) => org.orgId === orgId)) {
      return;
    }
    setOrgs((current) => [
      ...current,
      {
        orgId,
        orgName: orgNames.get(orgId) ?? "",
        canLead: false,
        isPrimary: current.length === 0 && !primaryElsewhere,
      },
    ]);
  };

  const save = () => {
    if (staff === null || staff === undefined) {
      return;
    }
    update.mutate({
      input: {
        staffId: staff.id,
        employmentType,
        orgs: orgs.map(({ orgId, canLead, isPrimary }) => ({
          orgId,
          canLead,
          isPrimary,
        })),
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("title", { name: row.name })}
      actions={
        canEdit ? (
          <>
            <Button variant="text" onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button disabled={needsPrimary || update.isPending} onClick={save}>
              {tCommon("save")}
            </Button>
          </>
        ) : (
          <Button variant="text" onClick={onClose}>
            {tCommon("close")}
          </Button>
        )
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="subtitle2">{t("employmentType")}</Typography>
        <Stack direction="row" spacing={2}>
          {SCHEDULE_EMPLOYMENT_TYPES.map((type) => (
            <FormControlLabel
              key={type}
              label={tEmployment(type)}
              disabled={!canEdit}
              control={
                <Radio
                  checked={employmentType === type}
                  onChange={() => {
                    setEmploymentType(type);
                  }}
                />
              }
            />
          ))}
        </Stack>
        <Typography variant="subtitle2">{t("orgs")}</Typography>
        {orgs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("noOrgs")}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {orgs.map((org) => (
              <Stack
                key={org.orgId}
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Typography sx={{ flex: 1, minWidth: 96 }}>
                  {org.orgName}
                </Typography>
                <FormControlLabel
                  label={t("canLead")}
                  disabled={!canEdit}
                  control={
                    <Checkbox
                      checked={org.canLead}
                      onChange={(_event, checked) => {
                        patch(org.orgId, { canLead: checked });
                      }}
                    />
                  }
                />
                <FormControlLabel
                  label={t("isPrimary")}
                  disabled={!canEdit || primaryElsewhere}
                  control={
                    <Radio
                      checked={org.isPrimary}
                      onChange={() => {
                        patch(org.orgId, { isPrimary: true });
                      }}
                    />
                  }
                />
                {canEdit && (
                  <Button
                    variant="text"
                    color="error"
                    size="small"
                    onClick={() => {
                      removeOrg(org.orgId);
                    }}
                  >
                    {tCommon("remove")}
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        )}
        {needsPrimary && (
          <Typography variant="caption" color="error">
            {t("primaryRequired")}
          </Typography>
        )}
        {primaryElsewhere && (
          <Typography variant="caption" color="text.secondary">
            {t("primaryElsewhere")}
          </Typography>
        )}
        {canEdit && (
          <OrgTreeSelect
            label={t("addOrg")}
            value={[]}
            size="small"
            disabledReasons={Object.fromEntries(
              orgs.map((org) => [org.orgId, t("alreadyAdded")]),
            )}
            onChange={(ids) => {
              addOrg(ids.at(0));
            }}
          />
        )}
      </Stack>
    </Dialog>
  );
};
