import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useCloseItemTabs } from "@/hooks/base/useCloseItemTabs";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";

import { DeleteItemDialog } from "./DeleteItemDialog";
import { DemoListTable } from "./DemoListTable";
import { DemoListToolbar } from "./DemoListToolbar";
import { type DemoErrorCode, demoErrorOf } from "./demo-error";
import type {
  DemoFilterOption,
  DemoItemLike,
  DemoModuleConfig,
} from "./demo-module-config";
import { useDemoAccess } from "./useDemoAccess";
import { useDemoSetEnabled } from "./useDemoQuery";

/**
 * 列表的篩選條件存在網址 `?list=`(REACT-14):搜尋、模組自有篩選、頁碼;重新整理、切頁籤回來都還在。
 * 篩選器的值連同顯示文字一起存(`{ value, label }`),不必等選項清單回來才畫得出已選的那一個。
 */
const listSchema = z
  .object({
    keyword: z.string().default(""),
    option: z
      .object({ value: z.string(), label: z.string() })
      .nullable()
      .default(null),
    page: z.number().int().min(1).default(1),
  })
  .default({ keyword: "", option: null, page: 1 });

export interface DemoListPageProps<
  Row extends DemoItemLike,
  Detail extends DemoItemLike,
  Values,
> {
  config: DemoModuleConfig<Row, Detail, Values>;
}

/**
 * 設定驅動的列表頁(Figma 175:3)。搜尋 + 模組自有篩選 + 分頁的清單;
 * 列操作依 api 給的 `abilities` 與「有沒有綁那一頁的模組」出現 —— 檢視 / 編輯是**導向另一個頁面**
 * (隱藏頁模組),刪除是這一頁上的確認彈窗。
 *
 * 換一個模組要動的只有設定物件(`config.list`:欄位、每頁筆數、清單 hook、篩選器)。
 */
export const DemoListPage = <
  Row extends DemoItemLike,
  Detail extends DemoItemLike,
  Values,
>({
  config,
}: DemoListPageProps<Row, Detail, Values>) => {
  const { i18nNamespace, list } = config;
  const t = useTranslations(i18nNamespace);
  const tErrors = useTranslations(`${i18nNamespace}.errors`);
  const { session } = useSession();
  const navigate = useNavigate();
  const access = useDemoAccess(config.moduleKeys, config.permissions);

  const [filters, setFilters] = useUrlState("list", listSchema);
  const { keyword, option, page } = filters;
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleteError, setDeleteError] = useState<DemoErrorCode | null>(null);
  const [toggleError, setToggleError] = useState<DemoErrorCode | null>(null);
  /** 正在切換的那一列 + 這次要切成什麼(提示文案要分「已啟用 / 已停用」)。 */
  const [toggling, setToggling] = useState<{
    id: string;
    enabled: boolean;
  } | null>(null);

  const rows = list.useRows(filters);
  const closeItemTabs = useCloseItemTabs();

  /**
   * 共版型的兩個 mutation hook(`useDelete` / `useSetEnabled`)只收
   * `{ onSuccess(): void; onError(error): void }`,所以回饋在這一層自己報一次 ——
   * 設定物件的介面不必為了回饋改形狀。
   */
  const feedbackError = (error: unknown) => tErrors(demoErrorOf(error).code);
  const deleteFeedback = useMutationFeedback({
    success: t("feedback.deleteSuccess"),
    error: feedbackError,
  });
  const enableFeedback = useMutationFeedback({
    success: t("feedback.enableSuccess"),
    error: feedbackError,
  });
  const disableFeedback = useMutationFeedback({
    success: t("feedback.disableSuccess"),
    error: feedbackError,
  });
  const toggleFeedback = () =>
    toggling?.enabled === true ? enableFeedback : disableFeedback;

  const deleteItem = config.useDelete(session.client, {
    onSuccess: () => {
      deleteFeedback.onSuccess();
      if (deleteTarget !== null) {
        // 收掉這一筆在背景的詳情 / 編輯子頁籤;當前頁籤(列表)不變
        closeItemTabs({
          pageRoutes: [access.viewRoute, access.editRoute],
          id: deleteTarget.id,
          listRoute: access.listRoute,
        });
      }
      setDeleteTarget(null);
      void rows.invalidate();
    },
    onError: (error: unknown) => {
      deleteFeedback.onError(error);
      setDeleteError(demoErrorOf(error).code);
    },
  });

  /**
   * 啟用 / 停用是**選配**(`config.useSetEnabled`):沒給的模組沒有開關,這一支就是替身。
   * 成功後只失效當前這份清單(DATA-02 / 04),讓那一列拿到 api 回的新狀態。
   */
  const setEnabled = useDemoSetEnabled(config.useSetEnabled, {
    onSuccess: () => {
      toggleFeedback().onSuccess();
      setToggling(null);
      void rows.invalidate();
    },
    onError: (error: unknown) => {
      toggleFeedback().onError(error);
      setToggling(null);
      setToggleError(demoErrorOf(error).code);
    },
  });

  const pageCount = Math.max(1, Math.ceil(rows.totalCount / list.pageSize));

  const goTo = (route: string | null, id?: string) => {
    if (route === null) {
      return;
    }
    void navigate(id === undefined ? route : `${route}/${id}`);
  };

  /** 換關鍵字或換篩選都回到第一頁(否則會停在一個不存在的頁碼上看到空清單)。 */
  const setKeyword = (value: string) => {
    setFilters((current) => ({ ...current, keyword: value, page: 1 }));
  };
  const setOption = (value: DemoFilterOption | null) => {
    setFilters((current) => ({
      ...current,
      option:
        value === null ? null : { value: value.value, label: value.label },
      page: 1,
    }));
  };
  const setPage = (value: number) => {
    setFilters((current) => ({ ...current, page: value }));
  };

  return (
    // 撐滿殼給的內容區高度(STYLE-08):工具列固定,表格吃掉剩下的高度並自己捲(STYLE-11)
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <DemoListToolbar
        i18nNamespace={i18nNamespace}
        keyword={keyword}
        onKeywordChange={setKeyword}
        option={option}
        onOptionChange={setOption}
        Filters={list.Filters}
        canCreate={access.canCreate}
        onCreate={() => {
          goTo(access.createRoute);
        }}
      />

      {/* 切換啟用失敗的說明(刪除的錯誤在確認彈窗裡,這裡是列表上直接送出的那一種) */}
      {toggleError !== null && (
        <Alert severity="error">{tErrors(toggleError)}</Alert>
      )}

      <Card
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        {/* 捲動責任在 Table 自己的容器,這層只把剩下的高度傳下去 */}
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <DemoListTable
            i18nNamespace={i18nNamespace}
            columns={list.columns}
            minWidth={list.tableMinWidth}
            rows={rows.rows}
            isLoading={rows.isLoading}
            canEnterView={access.viewRoute !== null}
            canEnterEdit={access.editRoute !== null}
            canToggleEnabled={config.useSetEnabled !== undefined}
            togglingRowId={toggling?.id ?? null}
            onView={(row) => {
              goTo(access.viewRoute, row.id);
            }}
            onEdit={(row) => {
              goTo(access.editRoute, row.id);
            }}
            onDelete={(row) => {
              setDeleteError(null);
              setDeleteTarget(row);
            }}
            onToggleEnabled={(row, enabled) => {
              setToggleError(null);
              setToggling({ id: row.id, enabled });
              setEnabled.mutate({ input: { id: row.id, enabled } });
            }}
          />
        </Box>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", px: 3, py: 1.5 }}
        >
          <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
            {t("total", {
              total: rows.totalCount,
              pageSize: list.pageSize,
            })}
          </Typography>
          <Pagination
            count={pageCount}
            page={page}
            onChange={(_event, nextPage) => {
              setPage(nextPage);
            }}
          />
        </Stack>
      </Card>

      {deleteTarget !== null && (
        <DeleteItemDialog
          i18nNamespace={i18nNamespace}
          itemName={deleteTarget.name}
          isSubmitting={deleteItem.isPending}
          errorCode={deleteError}
          onCancel={() => {
            setDeleteError(null);
            setDeleteTarget(null);
          }}
          onConfirm={() => {
            setDeleteError(null);
            deleteItem.mutate({ input: { id: deleteTarget.id } });
          }}
        />
      )}
    </Stack>
  );
};
