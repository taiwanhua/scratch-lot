import { useTranslations } from "use-intl";

import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface TablePagerProps {
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/** 表格下方的「共 N 筆」+ 分頁(兩個頁籤共用)。 */
export const TablePager = ({
  totalCount,
  page,
  pageSize,
  onPageChange,
}: TablePagerProps) => {
  const t = useTranslations("admin.applyCenter");
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
        {t("total", { total: totalCount })}
      </Typography>
      <Pagination
        count={Math.max(1, Math.ceil(totalCount / pageSize))}
        page={page}
        onChange={(_event, next) => {
          onPageChange(next);
        }}
      />
    </Stack>
  );
};
