import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";

import { useInventoryAccess } from "../useInventoryAccess";

export interface OpeningPageHeaderProps {
  orgId: string;
  onOrgChange: (orgId: string) => void;
}

/** 期初建檔頁頁首(Figma OP-01a):[← 返回庫存] + 分店選擇器(看得到的範圍,記在網址 `?org=`)。 */
export const OpeningPageHeader = ({
  orgId,
  onOrgChange,
}: OpeningPageHeaderProps) => {
  const t = useTranslations("admin.lotteryInventory.opening");
  const navigate = useNavigate();
  const { listRoute } = useInventoryAccess();
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1.5}
      sx={{ alignItems: { sm: "center" } }}
    >
      {listRoute === null ? null : (
        <Button
          variant="text"
          onClick={() => {
            void navigate(listRoute);
          }}
        >
          {`← ${t("back")}`}
        </Button>
      )}
      <Box sx={{ width: { xs: "100%", sm: 280 } }}>
        <OrgTreeSelect
          scope="visible"
          label={t("org")}
          value={orgId === "" ? [] : [orgId]}
          size="small"
          fullWidth
          onChange={(ids) => {
            onOrgChange(ids.at(0) ?? "");
          }}
        />
      </Box>
    </Stack>
  );
};
