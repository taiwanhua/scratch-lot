import { useTranslations } from "use-intl";

import {
  type LotteryDealerFieldsFragment,
  LotteryDealerType,
  useLotteryDealerQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { ConflictDialog } from "../ConflictDialog";
import { DEALER_TYPE_LABELS } from "../dealer-labels";
import { dealersErrorKey, dealersErrorOf } from "../dealers-error";
import { DEALERS_MODULE_KEYS } from "../dealers-keys";
import { type DealersAccess, useDealersAccess } from "../useDealersAccess";
import { DealerFormSections } from "./DealerFormSections";
import { useDealerForm } from "./useDealerForm";

const TYPES = [LotteryDealerType.A, LotteryDealerType.B] as const;

/**
 * 新增 / 編輯經銷商(隱藏頁 `dealers.create-page` / `dealers.edit-page`,同一個版型;Figma DE-03)。
 * 新增頁第一步選類型(建立後不能改,規格 5.2);編輯頁從網址的 id 載入那一筆。
 */
export const DealerFormPage = ({ module, routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const access = useDealersAccess();
  const isCreate = module.key === DEALERS_MODULE_KEYS.createPage;
  const query = useLotteryDealerQuery(
    session.client,
    { id: routeParam ?? "" },
    { enabled: !isCreate && routeParam !== null && routeParam !== undefined },
  );
  const dealer = query.data?.lotteryDealer.item ?? null;
  useRouteTabItemLabel(dealer?.name, "edit");

  if (isCreate) {
    return <DealerFormBody dealer={null} access={access} />;
  }
  if (query.isLoading) {
    return <CircularProgress aria-label={t("common.loading")} />;
  }
  if (dealer === null) {
    return (
      <Alert severity="error">
        {tErrors(
          query.error === null
            ? "NOT_FOUND"
            : dealersErrorKey(dealersErrorOf(query.error)),
        )}
      </Alert>
    );
  }
  return <DealerFormBody key={dealer.id} dealer={dealer} access={access} />;
};

interface DealerFormBodyProps {
  dealer: LotteryDealerFieldsFragment | null;
  access: DealersAccess;
}

const DealerFormBody = ({ dealer, access }: DealerFormBodyProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const isCreate = dealer === null;
  const form = useDealerForm(dealer, access, (id) => {
    if (access.routes.view === null) {
      access.goTo(access.routes.list);
    } else {
      access.goTo(access.routes.view, id);
    }
  });
  const leave = () => {
    if (dealer !== null && access.routes.view !== null) {
      access.goTo(access.routes.view, dealer.id);
    } else {
      access.goTo(access.routes.list);
    }
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Stack spacing={2} sx={{ pb: 2 }}>
        <Card sx={{ px: 3, py: 2 }}>
          {isCreate ? (
            <Stack
              direction="row"
              sx={{ alignItems: "center", gap: 2, flexWrap: "wrap" }}
            >
              <Typography variant="subtitle2" component="span">
                {t("fields.type")}
              </Typography>
              <RadioGroup
                row
                aria-label={t("fields.type")}
                value={form.values.type}
                onChange={(event) => {
                  form.change("type", event.target.value as LotteryDealerType);
                }}
              >
                {TYPES.map((type) => (
                  <FormControlLabel
                    key={type}
                    value={type}
                    control={<Radio />}
                    label={t(DEALER_TYPE_LABELS[type])}
                  />
                ))}
              </RadioGroup>
            </Stack>
          ) : (
            <Typography variant="subtitle1" component="h1">
              {`${dealer.name} · ${t(DEALER_TYPE_LABELS[dealer.type])} ${dealer.licenseNo}`}
            </Typography>
          )}
        </Card>

        <DealerFormSections
          form={form}
          dealerId={dealer?.id ?? null}
          isCreate={isCreate}
        />

        {form.error !== null && <Alert severity="error">{form.error}</Alert>}

        <FormActions
          cancel={{ label: t("actions.cancel"), onClick: leave }}
          submit={{
            label: t("actions.save"),
            disabled: form.isSubmitting,
            onClick: () => {
              void form.submit();
            },
          }}
        />
      </Stack>

      {form.conflict !== null && dealer !== null && (
        <ConflictDialog
          title={t("conflict.coSalesTitle")}
          message={t("conflict.coSalesBody", {
            name: dealer.name,
            count: String(form.conflict.length),
          })}
          relationships={form.conflict}
          column="contact"
          confirmLabel={t("actions.releaseAndRemove")}
          isSubmitting={form.isSubmitting}
          onCancel={form.closeConflict}
          onConfirm={() => {
            void form.submit(true);
          }}
        />
      )}
    </Box>
  );
};
