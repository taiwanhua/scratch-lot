import { useTranslations } from "use-intl";

import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { PRINTERS_PAGE_SIZE } from "./printers-list";

export interface PrintersPagerProps {
  totalCount: number;
  page: number;
  onPageChange: (page: number) => void;
}

/** 表格下方的「共 N 筆」+ 分頁(三個分頁共用;版面同申請中心)。 */
export const PrintersPager = ({
  totalCount,
  page,
  onPageChange,
}: PrintersPagerProps) => {
  const t = useTranslations("admin.printers");
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
        {t("total", { total: totalCount })}
      </Typography>
      <Pagination
        count={Math.max(1, Math.ceil(totalCount / PRINTERS_PAGE_SIZE))}
        page={page}
        onChange={(_event, next) => {
          onPageChange(next);
        }}
      />
    </Stack>
  );
};
