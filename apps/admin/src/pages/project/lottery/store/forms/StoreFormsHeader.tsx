import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useModuleForms } from "@/hooks/base/useModuleForms";

import { STORE_KEY, storeFormCreateHref } from "./store-forms-keys";

export interface StoreFormsHeaderProps {
  title: string;
  /** 列表右上的新增鈕文字(「+ 新增<名詞>」,REACT-16) */
  createLabel: string;
  /** 這個分頁的表單(`+ 新增` 開它的新增頁)。 */
  formKey: string;
  orgId: string;
  onOrgChange: (orgId: string) => void;
}

/**
 * 撤銷售出 / 現金更正分頁的頁首(Figma ST-31a / ST-32a):分店(`?org=`,和看板同一個)、標題、[+ 新增]。
 * [+ 新增] 只在這張表單此刻可以新增時顯示(B9b:持有 `store.create-<formKey>`;api `moduleForms.canCreate`)。
 */
export const StoreFormsHeader = ({
  title,
  createLabel,
  formKey,
  orgId,
  onOrgChange,
}: StoreFormsHeaderProps) => {
  const t = useTranslations("admin.lotteryStore.storeForms");
  const navigate = useNavigate();
  const access = useFormModuleAccess(STORE_KEY);
  const { creatableForms } = useModuleForms(STORE_KEY);
  const canCreate =
    access.createRoute !== null &&
    creatableForms.some((form) => form.key === formKey);
  return (
    <Stack spacing={2}>
      <Box sx={{ width: { xs: "100%", sm: 240 } }}>
        <OrgTreeSelect
          // 頁面篩選:列整棵租戶樹、可見範圍外反灰(用法表)
          scope="visible"
          label={t("branch")}
          value={orgId === "" ? [] : [orgId]}
          size="small"
          fullWidth
          onChange={(ids) => {
            onOrgChange(ids[0] ?? "");
          }}
        />
      </Box>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
          {title}
        </Typography>
        {canCreate ? (
          <Button
            onClick={() => {
              void navigate(
                storeFormCreateHref(access.createRoute ?? "", formKey, {
                  org: orgId,
                }),
              );
            }}
          >
            {createLabel}
          </Button>
        ) : null}
      </Stack>
    </Stack>
  );
};
