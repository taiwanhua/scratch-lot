import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type FormSubmissionStatus,
  useDeleteFormSubmissionMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { IconButton } from "@repo/ui/icon-button";
import { DeleteIcon, EditIcon, ViewIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { Tooltip } from "@repo/ui/tooltip";

import { useCloseItemTabs } from "@/hooks/base/useCloseItemTabs";
import { useFormSubmissionCache } from "@/hooks/base/useFormSubmissionCache";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSession } from "@/hooks/base/useSession";
import {
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { ReasonDialog } from "../../workflow/ApprovalSection/ReasonDialog";
import { useSubmissionActions } from "../../workflow/useSubmissionActions";
import { FormPicker } from "../FormPicker";
import {
  FormSubmissionList,
  type FormSubmissionRow,
} from "../FormSubmissionList";
import { DeleteSubmissionDialog } from "./DeleteSubmissionDialog";
import { FormListToolbar } from "./FormListToolbar";
import { formModuleKeyOf, useFormModuleAccess } from "./useFormModuleAccess";

/**
 * 表單模組列表頁(預設組裝;Spec 6a §8 畫面 8):搜尋、依表單 / 狀態篩選、分頁;
 * 新增鈕 —— 此刻可新增的表單一張 → 直接進、多張 → 先選(`FormPicker`)。
 * 列操作依 api 的 `abilities`(已含權限)與「有沒有綁那一頁」相乘:綁流程且已核准的單鎖定 ——
 * 不出現「編輯」(api 的 `canEdit` 為 false)、改出現「作廢」(`canVoid`,Spec 6b §8 畫面 11)。
 */
export const FormListPage = ({ module }: ModulePageProps) => {
  const moduleKey = formModuleKeyOf(module.key);
  const t = useTranslations("admin.formEngine.pages");
  const navigate = useNavigate();
  const access = useFormModuleAccess(moduleKey);
  const { forms } = useModuleForms(moduleKey);

  // 篩選留在頁面層,不進 URL(REACT-02 第 2 點的 admin 例外)
  const [keyword, setKeywordValue] = useState("");
  const [formKey, setFormKeyValue] = useState<string | null>(null);
  const [status, setStatusValue] = useState<FormSubmissionStatus | null>(null);
  const [page, setPage] = useState(1);
  const [isPicking, setIsPicking] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FormSubmissionRow | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<FormError | null>(null);
  const [voidTarget, setVoidTarget] = useState<FormSubmissionRow | null>(null);
  const submissionActions = useSubmissionActions();
  const { session } = useSession();
  const updateCache = useFormSubmissionCache();
  const closeItemTabs = useCloseItemTabs();
  // 刪除只要 id:不為了刪一筆再查整筆提交
  const deletion = useDeleteFormSubmissionMutation(session.client, {
    onSuccess: (_data, variables) => {
      updateCache(null);
      setDeleteTarget(null);
      // 收掉這一筆在背景的詳情 / 編輯子頁籤;當前頁籤(列表)不變
      closeItemTabs({
        pageRoutes: [access.viewRoute, access.editRoute],
        id: variables.input.id,
        listRoute: access.listRoute,
      });
    },
    onError: (failure) => {
      setDeleteError(formErrorOf(failure));
    },
  });

  const goCreate = (key: string) => {
    if (access.createRoute !== null) {
      void navigate(`${access.createRoute}/${key}`);
    }
  };
  const handleCreate = () => {
    if (forms.length === 1) {
      goCreate(forms[0].key);
      return;
    }
    setIsPicking(true);
  };

  const labelOf = (row: FormSubmissionRow): string =>
    row.summary?.title ?? row.formName ?? row.formKey;

  const renderActions = (row: FormSubmissionRow) => (
    <Stack direction="row" spacing={0.5}>
      {access.viewRoute !== null && (
        <Tooltip title={t("view")} describeChild={false}>
          <IconButton
            size="small"
            aria-label={t("viewOf", { label: labelOf(row) })}
            onClick={() => {
              void navigate(`${access.viewRoute ?? ""}/${row.id}`);
            }}
          >
            <ViewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {access.editRoute !== null && row.abilities.canEdit && (
        <Tooltip title={t("edit")} describeChild={false}>
          <IconButton
            size="small"
            aria-label={t("editOf", { label: labelOf(row) })}
            onClick={() => {
              void navigate(`${access.editRoute ?? ""}/${row.id}`);
            }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {row.abilities.canVoid && (
        <Button
          size="small"
          variant="text"
          color="error"
          aria-label={t("voidOf", { label: labelOf(row) })}
          onClick={() => {
            submissionActions.clearError();
            setVoidTarget(row);
          }}
        >
          {t("void")}
        </Button>
      )}
      {row.abilities.canDelete && (
        <Tooltip title={t("delete")} describeChild={false}>
          <IconButton
            size="small"
            color="error"
            aria-label={t("deleteOf", { label: labelOf(row) })}
            onClick={() => {
              setDeleteTarget(row);
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <FormListToolbar
        keyword={keyword}
        onKeywordChange={(value) => {
          setKeywordValue(value);
          setPage(1);
        }}
        forms={forms}
        formKey={formKey}
        onFormKeyChange={(value) => {
          setFormKeyValue(value);
          setPage(1);
        }}
        status={status}
        onStatusChange={(value) => {
          setStatusValue(value);
          setPage(1);
        }}
        canCreate={access.canCreate}
        hasForms={forms.length > 0}
        onCreate={handleCreate}
      />
      <Card
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <FormSubmissionList
          moduleKey={moduleKey}
          filters={{ keyword, formKey, status, page }}
          onPageChange={setPage}
          renderActions={renderActions}
          aria-label={t("tableAria", { module: module.name })}
        />
      </Card>
      {isPicking && (
        <FormPicker
          forms={forms}
          onPick={(form) => {
            setIsPicking(false);
            goCreate(form.key);
          }}
          onClose={() => {
            setIsPicking(false);
          }}
        />
      )}
      {voidTarget !== null && (
        <ReasonDialog
          namespace="admin.approval.void"
          requiresReason
          isSubmitting={submissionActions.isPending}
          errorMessage={submissionActions.errorMessage}
          onCancel={() => {
            setVoidTarget(null);
          }}
          onConfirm={(reason) => {
            void submissionActions.voidIt(voidTarget, reason).then((isDone) => {
              if (isDone) {
                setVoidTarget(null);
              }
            });
          }}
        />
      )}
      {deleteTarget !== null && (
        <DeleteSubmissionDialog
          label={labelOf(deleteTarget)}
          isSubmitting={deletion.isPending}
          errorCode={deleteError?.code ?? null}
          onCancel={() => {
            setDeleteError(null);
            setDeleteTarget(null);
          }}
          onConfirm={() => {
            setDeleteError(null);
            deletion.mutate({ input: { id: deleteTarget.id } });
          }}
        />
      )}
    </Stack>
  );
};
