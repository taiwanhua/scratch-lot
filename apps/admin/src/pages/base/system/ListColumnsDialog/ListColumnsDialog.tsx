import { useTranslations } from "use-intl";

import { useModuleListColumnsQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";

import { useSession } from "@/hooks/base/useSession";

import { ListColumnsEditor } from "./ListColumnsEditor";

export interface ListColumnsDialogProps {
  moduleKey: string;
  moduleName: string;
  onClose: () => void;
}

/**
 * 列表欄位配置(root):「模組與權限」的模組右欄與「表單管理」的表單右欄共用這一個編輯器
 * (放在 `pages/base/system/` 群組資料夾,STRUCT-03),存的都是該模組的 `modules.settings.list` —— 所以編輯器頂端
 * 註明「此設定影響整個模組的列表」。外層 gate:目前的配置讀到了才掛編輯器(初始值只取一次,REACT-08)。
 */
export const ListColumnsDialog = ({
  moduleKey,
  moduleName,
  onClose,
}: ListColumnsDialogProps) => {
  const t = useTranslations("admin.moduleManager.listColumns");
  const { session } = useSession();
  const query = useModuleListColumnsQuery(session.client, { moduleKey });
  const columns = query.data?.moduleListColumns.columns;
  const builtin = query.data?.moduleListColumns.builtin;

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      title={t("title", { name: moduleName })}
    >
      <Stack spacing={2}>
        <Alert severity="info">{t("moduleWide")}</Alert>
        {columns === undefined || builtin === undefined ? (
          <CircularProgress aria-label={t("loading")} />
        ) : (
          <ListColumnsEditor
            moduleKey={moduleKey}
            initial={columns}
            initialBuiltin={builtin}
            onClose={onClose}
          />
        )}
      </Stack>
    </Dialog>
  );
};
