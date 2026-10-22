import {
  type DemoItemOneQuery,
  type DemoItemOneQueryVariables,
  type DemoItemsOneQuery,
  type DemoItemsOneQueryVariables,
  useCreateDemoItemOneMutation,
  useDeleteDemoItemOneMutation,
  useDemoItemOneQuery,
  useDemoItemsOneQuery,
  useSetDemoItemOneEnabledMutation,
  useUpdateDemoItemOneMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { SelectField } from "@repo/ui/select-field";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type {
  DemoFieldMode,
  DemoListFilters,
  DemoModuleConfig,
  DemoSave,
  DemoSaveOptions,
} from "@/components/base/crud/demo-module-config";
import {
  useDemoItem,
  useDemoItemCache,
  useDemoRows,
} from "@/components/base/crud/useDemoQuery";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";

import { FormTipsBlock } from "./SampleOneFormPage/FormTipsBlock";
import { ItemHistoryBlock } from "./SampleOneFormPage/ItemHistoryBlock";
import { SampleOneCategoryField } from "./SampleOneFormPage/SampleOneCategoryField";
import {
  toCreateInput,
  toFormValues,
  toUpdateInput,
} from "./SampleOneFormPage/sample-one-form";
import { SampleOneCategoryFilter } from "./SampleOnePage/SampleOneCategoryFilter";
import { AttachmentField } from "./SampleOneViewPage/AttachmentField";
import {
  SAMPLE_ONE_I18N,
  SAMPLE_ONE_MODULE_KEYS,
  SAMPLE_ONE_PAGE_SIZE,
  SAMPLE_ONE_PERMISSIONS,
  SAMPLE_ONE_STATUSES,
  SAMPLE_ONE_TABLE_MIN_WIDTH,
  SAMPLE_ONE_UPLOAD,
} from "./demo-sample-one-config";
import type {
  DemoItemDetail,
  DemoItemRow,
  SampleOneFormValues,
} from "./demo-sample-one-types";
import { attachmentNameOf, statusToneOf } from "./demo-sample-one-view";

/**
 * 示範模組1 的設定物件 —— **完整示範**那一支(介面與逐項說明見
 * `shared/demo-module-config.ts`;對照組見 `demo-sample-two-module.tsx`)。
 *
 * 它示範了共用元件的每一個接縫:
 * - **欄位級權限**:內部備註三態(`mode` 回 hidden / readonly / editable),
 *   `hidden` 時 input 連這個鍵都不會出現
 * - **雙路儲存**(ADR-0010):封面走公開 bucket(有穩定網址可預覽)、附件走私有 bucket
 * - **頁面自有權限區塊**(slot):新增頁的填寫提示、編輯頁的變更歷程
 * - **模組自有欄位**:分類(欄位管理的選項)、狀態(資料範圍用的 enum 欄位)
 *
 * 常數在 `demo-sample-one-config.ts`(mock 夾具與測試也要用那一份)。
 */

/** 內部備註的三態:沒有 `show-internal-note` → hidden;看得到改不動 → readonly。 */
const internalNoteModeOf = (
  canShow: boolean,
  canEdit: boolean,
): DemoFieldMode => {
  if (!canShow) {
    return "hidden";
  }
  return canEdit ? "editable" : "readonly";
};

/** 清單:把 codegen 的 `useDemoItemsOneQuery` 包成共用元件吃的 `useRows`。 */
const useSampleOneRows = (filters: DemoListFilters) => {
  const variables: DemoItemsOneQueryVariables = {
    input: {
      page: filters.page,
      pageSize: SAMPLE_ONE_PAGE_SIZE,
      keyword: filters.keyword.trim() === "" ? null : filters.keyword.trim(),
      category: filters.option?.value ?? null,
    },
  };
  return useDemoRows<
    DemoItemsOneQueryVariables,
    DemoItemsOneQuery,
    DemoItemRow
  >(useDemoItemsOneQuery, variables, (data) => ({
    items: data.demoItemsOne.items,
    totalCount: data.demoItemsOne.totalCount,
  }));
};

/** 單筆(詳情頁與編輯頁共用同一個 query,所以兩頁看到的形狀一致)。 */
const useSampleOneItem = (id: string, isEnabled: boolean) => {
  const variables: DemoItemOneQueryVariables = { id };
  return useDemoItem<
    DemoItemOneQueryVariables,
    DemoItemOneQuery,
    DemoItemDetail
  >(useDemoItemOneQuery, variables, (data) => data.demoItemOne.item, isEnabled);
};

/** 清單快取的前綴(各頁各篩選一次掃掉);分頁參數只是為了湊出 key,取第一段後就不影響。 */
const SAMPLE_ONE_LIST_KEY_PREFIX = useDemoItemsOneQuery
  .getKey({ input: { page: 1, pageSize: SAMPLE_ONE_PAGE_SIZE } })
  .slice(0, 1);

/**
 * 送出:把表單值 + 上傳完成的路徑轉成 `createDemoItemOne` / `updateDemoItemOne` 的 input。
 *
 * **內部備註的可改與否在這裡再判斷一次**,因為 input 要不要帶這個鍵是這一層的決定
 * (欄位一出現就要權限;新增看自己的權限、編輯看 api 逐筆算好的 `abilities`)。
 *
 * 成功後先把回傳的那一筆寫進單筆查詢的快取、再失效清單與單筆(DATA-04;`useDemoItemCache`)。
 */
const useSampleOneSave = ({
  item,
  onSuccess,
  onError,
}: DemoSaveOptions<DemoItemDetail>): DemoSave<SampleOneFormValues> => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const writeItem = useDemoItemCache<
    DemoItemOneQueryVariables,
    DemoItemOneQuery
  >(useDemoItemOneQuery, SAMPLE_ONE_LIST_KEY_PREFIX);

  const create = useCreateDemoItemOneMutation(session.client, {
    onSuccess: (data) => {
      writeItem(
        { id: data.createDemoItemOne.item.id },
        { demoItemOne: data.createDemoItemOne },
      );
      onSuccess();
    },
    onError,
  });
  const update = useUpdateDemoItemOneMutation(session.client, {
    onSuccess: (data) => {
      writeItem(
        { id: data.updateDemoItemOne.item.id },
        { demoItemOne: data.updateDemoItemOne },
      );
      onSuccess();
    },
    onError,
  });

  const mode = internalNoteModeOf(
    hasPermission(SAMPLE_ONE_PERMISSIONS.showInternalNote),
    // 新增看自己的權限;編輯看 api 逐筆算好的 `abilities`(不要兩邊各算一次)
    item === null
      ? hasPermission(SAMPLE_ONE_PERMISSIONS.editInternalNote)
      : item.abilities.canEditInternalNote,
  );

  return {
    save: (values, uploads) => {
      if (item === null) {
        create.mutate({ input: toCreateInput(values, uploads, mode) });
      } else {
        update.mutate({
          input: toUpdateInput(item.id, values, uploads, mode),
        });
      }
    },
    isPending: create.isPending || update.isPending,
  };
};

export const sampleOneModule: DemoModuleConfig<
  DemoItemRow,
  DemoItemDetail,
  SampleOneFormValues
> = {
  moduleKeys: SAMPLE_ONE_MODULE_KEYS,
  permissions: SAMPLE_ONE_PERMISSIONS,
  i18nNamespace: SAMPLE_ONE_I18N,

  list: {
    pageSize: SAMPLE_ONE_PAGE_SIZE,
    tableMinWidth: SAMPLE_ONE_TABLE_MIN_WIDTH,
    // 欄寬照 Figma 175:3 的表頭;`name` / `enabled` / `actions` 由共用表格內建
    columns: [
      { key: "name", width: 150, isEmphasized: true },
      {
        key: "category",
        width: 110,
        render: (row, t) => (
          <Typography variant="body2" color="textSecondary">
            {row.categoryLabel ?? row.category ?? t("emptyValue")}
          </Typography>
        ),
      },
      {
        key: "note",
        render: (row, t) => (
          <Typography variant="body2" color="textSecondary">
            {row.note ?? t("emptyValue")}
          </Typography>
        ),
      },
      {
        key: "status",
        width: 90,
        render: (row, t) => (
          <Tag
            tone={statusToneOf(row.status)}
            label={t(`status.${row.status}`)}
          />
        ),
      },
      { key: "enabled", width: 80 },
      { key: "actions", width: 150 },
    ],
    useRows: useSampleOneRows,
    Filters: SampleOneCategoryFilter,
  },

  detail: {
    useItem: useSampleOneItem,
    fields: [
      {
        key: "category",
        render: (item, t) =>
          item.categoryLabel ?? item.category ?? t("emptyValue"),
      },
      { key: "note", render: (item, t) => item.note ?? t("emptyValue") },
      {
        // 欄位級權限:沒有 `show-internal-note` 就整列不顯示(不是顯示空值)
        key: "internalNote",
        isVisible: (access) =>
          access.has(SAMPLE_ONE_PERMISSIONS.showInternalNote),
        render: (item, t) => item.internalNote ?? t("emptyValue"),
      },
      {
        key: "status",
        render: (item, t) => (
          <Tag
            tone={statusToneOf(item.status)}
            label={t(`status.${item.status}`)}
          />
        ),
      },
      {
        key: "enabled",
        render: (item, t) => (
          <Tag
            tone={item.enabled ? "success" : "grey"}
            label={item.enabled ? t("enabled.true") : t("enabled.false")}
          />
        ),
      },
      {
        key: "cover",
        render: (item, t) =>
          item.coverUrl == null ? (
            t("emptyValue")
          ) : (
            // 封面框(Figma 177:509 的 160×100):圖直接吃公開 bucket 的穩定網址
            <Box
              sx={{
                width: 160,
                height: 100,
                borderRadius: 1,
                overflow: "hidden",
                bgcolor: "action.disabledBackground",
                "& img": {
                  display: "block",
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                },
              }}
            >
              <img
                src={item.coverUrl}
                alt={t("fields.coverAlt", { name: item.name })}
              />
            </Box>
          ),
      },
      {
        key: "attachment",
        render: (item, t) =>
          item.attachment == null ? (
            t("emptyValue")
          ) : (
            <AttachmentField itemId={item.id} attachment={item.attachment} />
          ),
      },
      // 建立者查不到那位使用者時 api 一律回 null(seed 示範資料用假 id)→ 顯示「—」
      {
        key: "createdBy",
        render: (item, t) => item.createdBy?.name ?? t("emptyValue"),
      },
    ],
  },

  form: {
    fields: [
      { key: "name", kind: "text", required: true, width: 360 },
      {
        key: "category",
        kind: "custom",
        render: (context) => <SampleOneCategoryField context={context} />,
      },
      {
        key: "status",
        kind: "custom",
        render: ({ values, setValue, tFields, tRoot }) => (
          <SelectField
            label={tFields("status")}
            size="small"
            value={values.status}
            sx={{ width: 240 }}
            options={SAMPLE_ONE_STATUSES.map((status) => ({
              value: status,
              label: tRoot(`status.${status}`),
            }))}
            onChange={(status) => {
              setValue("status", status);
            }}
          />
        ),
      },
      { key: "note", kind: "multiline", width: 480, minRows: 2 },
      {
        // 欄位級權限的示範:沒有 `show-internal-note` 時整欄不渲染,有檢視無編輯時唯讀
        key: "internalNote",
        kind: "multiline",
        width: 480,
        minRows: 2,
        readonlyHintKey: "internalNoteReadonly",
        // 新增看自己的權限;編輯看 api 逐筆算好的 `abilities`(不要兩邊各算一次)
        mode: ({ access, item }) =>
          internalNoteModeOf(
            access.has(SAMPLE_ONE_PERMISSIONS.showInternalNote),
            item === null
              ? access.has(SAMPLE_ONE_PERMISSIONS.editInternalNote)
              : item.abilities.canEditInternalNote,
          ),
      },
    ],
    uploads: [
      {
        key: "cover",
        ...SAMPLE_ONE_UPLOAD.cover,
        hintKey: "coverHint",
        previewUrlOf: (item) => item.coverUrl,
        previewLabelKey: "coverCurrent",
      },
      {
        key: "attachment",
        ...SAMPLE_ONE_UPLOAD.attachment,
        hintKey: "attachmentHint",
        currentNameOf: (item) =>
          item.attachment == null ? null : attachmentNameOf(item.attachment),
        currentLabelKey: "attachmentCurrent",
        removeLabelKey: "removeAttachment",
      },
    ],
    toValues: toFormValues,
    useSave: useSampleOneSave,
    slots: {
      // 頁面自有權限:只在新增頁、且持有 `create-page.show-tips`
      top: ({ isEdit, access }) =>
        !isEdit && access.has(SAMPLE_ONE_PERMISSIONS.showTips) ? (
          <FormTipsBlock />
        ) : null,
      // 只在編輯頁、且持有 `edit-page.show-history`(與「能不能編輯」互相獨立)
      bottom: ({ item, isEdit, access }) =>
        isEdit &&
        item !== null &&
        access.has(SAMPLE_ONE_PERMISSIONS.showHistory) ? (
          <ItemHistoryBlock itemId={item.id} />
        ) : null,
    },
  },

  useDelete: useDeleteDemoItemOneMutation,
  // 啟用 / 停用是共版型的選配:給了它,列表的啟用欄才會是開關(改得動的列才有)
  useSetEnabled: useSetDemoItemOneEnabledMutation,
};
