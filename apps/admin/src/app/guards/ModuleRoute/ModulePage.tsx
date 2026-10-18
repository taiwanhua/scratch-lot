import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { ModulePageProps } from "@/lib/base/module-tree";

/** 模組佔位頁(各模組頁面為佔位元件,顯示模組名;內容由第 3–5 段各票接手)。只給 `ModuleRoute` 用。 */
export const ModulePage = ({ module }: ModulePageProps) => {
  const t = useTranslations("admin.shell.placeholder");

  return (
    <Stack spacing={1}>
      <Typography variant="h4" component="h1">
        {module.name}
      </Typography>
      <Typography color="text.secondary">{t("pending")}</Typography>
      <Typography variant="caption" color="text.disabled">
        {module.key}
      </Typography>
    </Stack>
  );
};
