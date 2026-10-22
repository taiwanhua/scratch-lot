import {
  type DemoItemTwoQuery,
  type DemoItemTwoQueryVariables,
  type DemoItemsTwoQuery,
  type DemoItemsTwoQueryVariables,
  useCreateDemoItemTwoMutation,
  useDeleteDemoItemTwoMutation,
  useDemoItemTwoQuery,
  useDemoItemsTwoQuery,
  useSetDemoItemTwoEnabledMutation,
  useUpdateDemoItemTwoMutation,
} from "@repo/graphql";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import {
  ShareOrgsField,
  ShareOrgsText,
} from "@/components/base/ShareOrgsField/ShareOrgsField";
import type {
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
import { useSession } from "@/hooks/base/useSession";

import {
  SAMPLE_TWO_I18N,
  SAMPLE_TWO_MODULE_KEYS,
  SAMPLE_TWO_PAGE_SIZE,
  SAMPLE_TWO_PERMISSIONS,
  SAMPLE_TWO_TABLE_MIN_WIDTH,
} from "./demo-sample-two-config";
import type {
  DemoItemTwoDetail,
  DemoItemTwoRow,
  SampleTwoFormValues,
} from "./demo-sample-two-types";

/**
 * 示範模組2 的設定物件 —— **對照組**那一支(介面見 `shared/demo-module-config.ts`,
 * 完整示範見 `SampleOneModule.tsx`)。
 *
 * 它存在的理由就是「拿掉所有可選的東西之後剩下什麼」:沒有欄位級權限、沒有上傳、
 * 沒有 slot、沒有模組自有篩選器、沒有自己的錯誤碼。**三頁的程式碼一行都不用改**,
 * 差別只有這一份設定 —— 這正是 module-scaffold 要產出的東西
 * (新開一個 CRUD 模組,照這一份填就好)。
 *
 * 另一個刻意的差異:`demo_items_two` 不宣告 `dataScopeTarget`,所以查詢只受可見範圍保底
 * (ADR-0008)—— 那是 api 的事,前端看不到差別,也不該看得到。
 */

/** 清單:把 codegen 的 `useDemoItemsTwoQuery` 包成共用元件吃的 `useRows`。 */
const useSampleTwoRows = (filters: DemoListFilters) => {
  const variables: DemoItemsTwoQueryVariables = {
    input: {
      page: filters.page,
      pageSize: SAMPLE_TWO_PAGE_SIZE,
      keyword: filters.keyword.trim() === "" ? null : filters.keyword.trim(),
    },
  };
  return useDemoRows<
    DemoItemsTwoQueryVariables,
    DemoItemsTwoQuery,
    DemoItemTwoRow
  >(useDemoItemsTwoQuery, variables, (data) => ({
    items: data.demoItemsTwo.items,
    totalCount: data.demoItemsTwo.totalCount,
  }));
};

/** 單筆(詳情頁與編輯頁共用)。 */
const useSampleTwoItem = (id: string, isEnabled: boolean) => {
  const variables: DemoItemTwoQueryVariables = { id };
  return useDemoItem<
    DemoItemTwoQueryVariables,
    DemoItemTwoQuery,
    DemoItemTwoDetail
  >(useDemoItemTwoQuery, variables, (data) => data.demoItemTwo.item, isEnabled);
};

/** 清單快取的前綴(各頁各關鍵字一次掃掉);分頁參數只是為了湊出 key,取第一段後就不影響。 */
const SAMPLE_TWO_LIST_KEY_PREFIX = useDemoItemsTwoQuery
  .getKey({ input: { page: 1, pageSize: SAMPLE_TWO_PAGE_SIZE } })
  .slice(0, 1);

/** 「共用給」看不看得到:新增問權限集、編輯讀 api 算好的 abilities(共用進來的一律 false)。 */
const canShare = (
  access: { has: (key: string) => boolean },
  item: DemoItemTwoDetail | null,
): boolean =>
  item === null
    ? access.has(SAMPLE_TWO_PERMISSIONS.edit)
    : item.abilities.canEdit;

/** 空字串 → `null`(api 的「沒填」是 null,不是空字串)。 */
const orNull = (value: string): string | null =>
  value.trim() === "" ? null : value.trim();

/**
 * 送出。缺席 = 不動、`null` = 清空(GQL-06);這一頁的欄位少,所以兩個欄位都明確送值。
 * 沒有檔案欄,所以 `paths` 用不到。
 *
 * 成功後先把回傳的那一筆寫進單筆查詢的快取、再失效清單與單筆(DATA-04;`useDemoItemCache`)。
 */
const useSampleTwoSave = ({
  item,
  onSuccess,
  onError,
}: DemoSaveOptions<DemoItemTwoDetail>): DemoSave<SampleTwoFormValues> => {
  const { session } = useSession();
  const writeItem = useDemoItemCache<
    DemoItemTwoQueryVariables,
    DemoItemTwoQuery
  >(useDemoItemTwoQuery, SAMPLE_TWO_LIST_KEY_PREFIX);

  const create = useCreateDemoItemTwoMutation(session.client, {
    onSuccess: (data) => {
      writeItem(
        { id: data.createDemoItemTwo.item.id },
        { demoItemTwo: data.createDemoItemTwo },
      );
      onSuccess();
    },
    onError,
  });
  const update = useUpdateDemoItemTwoMutation(session.client, {
    onSuccess: (data) => {
      writeItem(
        { id: data.updateDemoItemTwo.item.id },
        { demoItemTwo: data.updateDemoItemTwo },
      );
      onSuccess();
    },
    onError,
  });

  return {
    save: (values) => {
      const fields = {
        name: values.name.trim(),
        note: orNull(values.note),
        shareOrgs: values.shareOrgs,
      };
      if (item === null) {
        create.mutate({ input: fields });
      } else {
        update.mutate({ input: { id: item.id, ...fields } });
      }
    },
    isPending: create.isPending || update.isPending,
  };
};

export const sampleTwoModule: DemoModuleConfig<
  DemoItemTwoRow,
  DemoItemTwoDetail,
  SampleTwoFormValues
> = {
  moduleKeys: SAMPLE_TWO_MODULE_KEYS,
  permissions: SAMPLE_TWO_PERMISSIONS,
  i18nNamespace: SAMPLE_TWO_I18N,

  list: {
    pageSize: SAMPLE_TWO_PAGE_SIZE,
    tableMinWidth: SAMPLE_TWO_TABLE_MIN_WIDTH,
    // 四欄;`name` / `enabled` / `actions` 由共用表格內建,只有備註要自己畫(空值顯示「—」)
    columns: [
      { key: "name", width: 180, isEmphasized: true },
      {
        key: "note",
        render: (row, t) => (
          <Typography variant="body2" color="textSecondary">
            {row.note ?? t("emptyValue")}
          </Typography>
        ),
      },
      { key: "enabled", width: 80 },
      { key: "actions", width: 150 },
    ],
    useRows: useSampleTwoRows,
    // 沒有 `Filters` —— 對照組沒有模組自有的篩選器,工具列就只有搜尋與新增
  },

  detail: {
    useItem: useSampleTwoItem,
    fields: [
      { key: "note", render: (item, t) => item.note ?? t("emptyValue") },
      {
        key: "enabled",
        render: (item, t) => (
          <Tag
            tone={item.enabled ? "success" : "grey"}
            label={item.enabled ? t("enabled.true") : t("enabled.false")}
          />
        ),
      },
      // 建立者查不到那位使用者時 api 一律回 null(seed 示範資料用假 id)→ 顯示「—」
      {
        key: "createdBy",
        render: (item, t) => item.createdBy?.name ?? t("emptyValue"),
      },
      // 共用給(資料共用,ADR-0014);共用進來的另標「共用進來的,只能看」
      {
        key: "shareOrgs",
        render: (item, t) => (
          <>
            <ShareOrgsText value={item.shareOrgs} />
            {item.isShared && <Tag tone="primary" label={t("sharedIn")} />}
          </>
        ),
      },
    ],
  },

  form: {
    fields: [
      { key: "name", kind: "text", required: true, width: 360 },
      { key: "note", kind: "multiline", width: 480, minRows: 2 },
      {
        // 共用給:有修改權限的人才看得到這一欄(新增問權限集、編輯讀 api 算好的 abilities)
        key: "shareOrgs",
        kind: "custom",
        mode: ({ access, item }) =>
          canShare(access, item) ? "editable" : "hidden",
        render: ({ values, setValue, tFields, hasError, helperText }) => (
          <ShareOrgsField
            label={tFields("shareOrgs")}
            size="small"
            value={values.shareOrgs}
            width={480}
            error={hasError("shareOrgs")}
            helperText={helperText("shareOrgs")}
            onChange={(next) => {
              setValue("shareOrgs", next);
            }}
          />
        ),
      },
    ],
    uploads: [],
    toValues: (item) => ({
      name: item?.name ?? "",
      note: item?.note ?? "",
      shareOrgs: (item?.shareOrgs ?? []).map((entry) => ({
        orgId: entry.orgId,
        includeDescendants: entry.includeDescendants,
      })),
    }),
    useSave: useSampleTwoSave,
    // 沒有 slots —— 對照組沒有頁面自有權限,也就沒有提示與歷程區塊
  },

  useDelete: useDeleteDemoItemTwoMutation,
  // 啟用 / 停用是選配,但**對照組也有** —— 它是每個 CRUD 模組都可能要的開關,
  // 不是「完整示範」才有的花樣;沒有這個欄位的模組不給這支 hook 就好(列表維持唯讀 Tag)
  useSetEnabled: useSetDemoItemTwoEnabledMutation,
};
