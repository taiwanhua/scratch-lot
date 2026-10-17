import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { type ReactNode, useMemo } from "react";
import { useTranslations } from "use-intl";

import {
  DEFAULT_TENANT_TIMEZONE,
  type ExpressionContext,
  type FieldDef,
  type FormDefinition,
  LAYOUT_COLUMNS,
  type LayoutSection,
  type StoredValues,
  fieldProtections,
  sectionCollapseOf,
} from "@repo/domain/form";
import { Grid } from "@repo/ui/grid";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { fieldMapOf } from "@/lib/base/form-engine/definition";
import { designIdOf } from "@/lib/base/form-engine/design-definition";
import { designFieldId } from "@/lib/base/form-engine/design-ids";
import {
  type FieldPermissionFacts,
  type FormRendererMode,
  OPEN_PERMISSIONS,
  type ServerFormState,
  resolveFormState,
} from "@/lib/base/form-engine/field-states";
import {
  type FilterLinkValues,
  clearLinkedReferences,
  filterLinkValuesOf,
  linkedReferencesOf,
} from "@/lib/base/form-engine/filter-links";
import type { FormFieldErrorLike } from "@/lib/base/form-engine/form-errors";
import type { FormDisplayItemLike } from "@/lib/base/form-engine/value-text";

import type { WidgetContext } from "../widgets/widget-types";
import { DesignFieldCell } from "./DesignFieldCell";
import { FormFieldCell } from "./FormFieldCell";
import { FormSectionCard } from "./FormSectionCard";
import { SectionDropZone } from "./SectionDropZone";
import { SECTION_SPACING, cellSize } from "./layout-grid";
import { useFormSections } from "./useFormSections";
import { useSectionSummary } from "./useSectionSummary";

export interface FormRendererDesignProps {
  /** 選中欄位的設計器內部 id(`design-definition.ts`;一般定義沒有 id 時用 key) */
  selectedFieldId: string | null;
  /** 打開分區設定的分區 key:標題列反白(`aria-current`) */
  selectedSectionKey?: string | null;
  onSelectField: (fieldId: string) => void;
  /** 分區標題旁的操作(設計器:改名、刪分區) */
  renderSectionActions?: (section: LayoutSection) => ReactNode;
}

export interface FormRendererProps {
  /** 這一版的定義(`form_versions` 的四塊) */
  version: FormDefinition;
  /** 存值形狀的值(新增是空物件;編輯 / 詳情是那一筆的 `values`,受保護且無權的是 `"[redacted]"`) */
  values: StoredValues;
  mode: FormRendererMode;
  /** widget 的 lookup 要知道查哪張表單哪一版(預覽是草稿:version null) */
  context: WidgetContext;
  /** 表達式的 `ctx`:填寫 = 現在 + 填寫者;唯讀 = 該修訂的 `ctx`(不拿讀者補值) */
  expressionContext: ExpressionContext;
  /** 欄位級權限;不給 = 不套(設計、預覽) */
  permissions?: FieldPermissionFacts;
  onChange?: (values: StoredValues) => void;
  fieldErrors?: readonly FormFieldErrorLike[];
  displayValues?: readonly {
    fieldKey: string;
    items: readonly FormDisplayItemLike[];
  }[];
  onDownload?: (field: FieldDef) => void;
  /** 後端算的值與狀態(預覽「以後端重算」之後);有就以後端為準 */
  serverState?: ServerFormState | null;
  /**
   * 渲染的是表單**目前版本**時給 true:分區收合紀錄(`form:<formKey>`)打開時清掉這一版沒有的分區。
   * 看綁舊版本的單時不給,免得清掉新版本分區的紀錄。不給 = false(不清)
   */
  pruneMissingSections?: boolean;
  /** 設計模式的選取(畫布由設計器包 `DndContext`) */
  design?: FormRendererDesignProps;
}

const NO_ERRORS: readonly FormFieldErrorLike[] = [];

/** 明細子欄的顯示名:`displayValues` 以 `<明細 key>.<子欄 key>` 回一組。 */
const columnDisplayOf =
  (
    displayValues: NonNullable<FormRendererProps["displayValues"]>,
    arrayKey: string,
  ) =>
  (columnKey: string): readonly FormDisplayItemLike[] =>
    displayValues.find((entry) => entry.fieldKey === `${arrayKey}.${columnKey}`)
      ?.items ?? [];

/**
 * 依版本畫表單(Spec 6a §8 `<FormRenderer version values mode>`)。五種 `mode` 的語意在
 * `lib/base/form-engine/field-states.ts`;版面 12 格制見 `layout-grid.ts`。
 *
 * 欄位級三態:讀者沒有 show → 整格不渲染(不是顯示空值);有 show 沒有 edit → 唯讀並附說明;
 * 都有 → 可填。`visibleWhen` 算出 false 的也不渲染;計算欄位缺依賴時顯示「—」。
 */
export const FormRenderer = ({
  version,
  values,
  mode,
  context,
  expressionContext,
  permissions = OPEN_PERMISSIONS,
  onChange,
  fieldErrors = NO_ERRORS,
  displayValues = [],
  onDownload,
  serverState = null,
  design,
  pruneMissingSections = false,
}: FormRendererProps) => {
  const byKey = useMemo(() => fieldMapOf(version.fields), [version.fields]);
  // 版面格 → 欄位:設計器的定義以內部 id 對(key 重複也對得準),一般定義以 key 對
  const byCell = useMemo(
    () =>
      new Map(
        version.fields.map((field) => [designIdOf(field) ?? field.key, field]),
      ),
    [version.fields],
  );
  const protections = useMemo(
    () => fieldProtections(version.fields),
    [version.fields],
  );
  const resolved = useMemo(
    () =>
      resolveFormState({
        definition: version,
        values,
        ctx: expressionContext,
        mode,
        permissions,
        serverState,
      }),
    [version, values, expressionContext, mode, permissions, serverState],
  );

  // 日期 / 日期時間欄的輸入與顯示時區 = 讀者現在的租戶時區:呼叫端給的 `context.timezone`,
  // 沒給時:唯讀 = 讀者的租戶時區(修訂的 `ctx.timezone` 只用於重算條件,不決定顯示;申請中心詳情這類
  // 沒帶時區的呼叫端也對);填寫 / 預覽 = 表達式 ctx 的時區(兩者本來就相同)
  const tenantTimezone = useTenantTimezone();
  const cellContext = useMemo(
    () => ({
      ...context,
      timezone:
        context.timezone ??
        (mode === "readonly"
          ? (tenantTimezone ?? DEFAULT_TENANT_TIMEZONE)
          : expressionContext.timezone),
    }),
    [context, mode, tenantTimezone, expressionContext.timezone],
  );

  // 每個分區畫得到的欄位 key(版面順序;看不到的不算):送出有錯時找要展開的分區與第一個錯誤
  const fieldKeysBySection = useMemo(
    () =>
      new Map(
        version.layout.sections.map((section) => [
          section.key,
          section.rows
            .flatMap((row) => row.cols)
            .map((col) => byCell.get(designIdOf(col) ?? col.fieldKey))
            .filter(
              (field): field is FieldDef =>
                field !== undefined &&
                resolved.states.get(field.key)?.visible === true,
            )
            .map((field) => field.key),
        ]),
      ),
    [version.layout.sections, byCell, resolved.states],
  );
  const {
    containerRef,
    isCollapsed: isSectionCollapsed,
    toggle: toggleSection,
  } = useFormSections({
    sections: version.layout.sections,
    fieldKeysBySection,
    formKey: context.formKey,
    mode,
    fieldErrors,
    pruneMissingSections,
  });
  const summaryOf = useSectionSummary({
    byKey,
    resolved,
    displayValues,
    timezone: cellContext.timezone,
  });

  // 連動篩選(B2d):被引用欄位的目前值給引用欄查詢;以內容當 memo 鍵,值沒變時同一份物件(明細格子不重繪)
  const links = useMemo(
    () => linkedReferencesOf(version.fields),
    [version.fields],
  );
  const linkValues = filterLinkValuesOf(version.fields, links, resolved.values);
  const linkKey = JSON.stringify(linkValues);
  const filterLinks = useMemo(
    (): FilterLinkValues | undefined =>
      links.length === 0
        ? undefined
        : (JSON.parse(linkKey) as FilterLinkValues),
    [links.length, linkKey],
  );
  const tRenderer = useTranslations("admin.formEngine.renderer");
  const showSnackbar = useSnackbar();

  const handleChange = (fieldKey: string, value: unknown) => {
    const next = { ...values, [fieldKey]: value };
    if (links.length === 0) {
      onChange?.(next);
      return;
    }
    // 被引用欄位改值:清空依賴它的引用欄並提示(編輯既有單據打開時不清,只在改值的這一刻)
    const { values: cleared, cleared: notices } = clearLinkedReferences(
      version.fields,
      links,
      values,
      next,
      fieldKey,
    );
    onChange?.(cleared);
    for (const notice of notices) {
      showSnackbar(
        "info",
        notice.rows === undefined
          ? tRenderer("linkedCleared", { field: notice.label })
          : tRenderer("linkedClearedRows", {
              count: notice.rows,
              field: notice.label,
            }),
      );
    }
  };

  const isDesign = mode === "design";

  return (
    <Stack ref={containerRef} spacing={3}>
      {version.layout.sections.map((section) => {
        const cols = section.rows
          .flatMap((row) => row.cols)
          .map((col) => ({ ...col, cellId: designIdOf(col) ?? col.fieldKey }))
          .filter((col) => byCell.has(col.cellId));
        const cells = cols.flatMap((col) => {
          const field = byCell.get(col.cellId);
          const state =
            field === undefined ? undefined : resolved.states.get(field.key);
          if (field === undefined || state?.visible !== true) {
            return [];
          }
          const cell = (
            <FormFieldCell
              field={field}
              state={state}
              value={resolved.values[field.key] ?? null}
              mode={mode}
              context={cellContext}
              onChange={handleChange}
              errorMessage={
                fieldErrors.find((error) => error.fieldKey === field.key)
                  ?.message ?? null
              }
              {...(field.type === "array" && {
                errors: fieldErrors.filter(
                  (error) => error.fieldKey === field.key,
                ),
                columnDisplay: columnDisplayOf(displayValues, field.key),
              })}
              {...(onDownload !== undefined && { onDownload })}
              {...(filterLinks !== undefined &&
                (field.type === "reference" || field.type === "array") && {
                  filterLinks,
                })}
              display={
                displayValues.find((entry) => entry.fieldKey === field.key)
                  ?.items ?? []
              }
            />
          );
          return [
            <Grid
              key={col.cellId}
              size={cellSize(col.span)}
              sx={{ minWidth: 0 }}
              data-field-key={field.key}
            >
              {isDesign && design !== undefined ? (
                <DesignFieldCell
                  field={field}
                  cellId={col.cellId}
                  protection={protections.get(field.key)}
                  labelOf={(key) => byKey.get(key)?.label ?? key}
                  isSelected={design.selectedFieldId === col.cellId}
                  onSelect={design.onSelectField}
                >
                  {cell}
                </DesignFieldCell>
              ) : (
                cell
              )}
            </Grid>,
          ];
        });

        if (!isDesign) {
          // 填寫 / 預覽 / 唯讀:分區一個有框的卡片 + 標題列,三種模式版面一致(Spec 6a §8 畫面 9 / 11);
          // 設定了「可以收合」的分區可展開 / 收合(底座 10.3)
          return (
            <FormSectionCard
              key={section.key}
              section={section}
              cells={cells}
              collapsible={sectionCollapseOf(section).collapsible}
              collapsed={isSectionCollapsed(section)}
              onCollapsedChange={(collapsed) => {
                toggleSection(section, collapsed);
              }}
              summary={summaryOf(section)}
            />
          );
        }

        // 打開分區設定的那個分區:標題列反白
        const isSectionSelected = design?.selectedSectionKey === section.key;
        return (
          <Stack
            key={section.key}
            component="section"
            spacing={1.5}
            aria-label={section.title}
            aria-current={isSectionSelected ? "true" : undefined}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                px: 1,
                py: 0.5,
                borderRadius: 1,
                bgcolor: isSectionSelected ? "primary.lighter" : "transparent",
              }}
            >
              <Typography
                variant="subtitle1"
                component="h2"
                sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
              >
                {section.title}
              </Typography>
              {design?.renderSectionActions?.(section)}
            </Stack>
            <SortableContext
              items={cols.map((col) => designFieldId(col.cellId))}
              strategy={rectSortingStrategy}
            >
              <Grid
                container
                columns={LAYOUT_COLUMNS}
                spacing={SECTION_SPACING}
              >
                {cells}
                <Grid size={LAYOUT_COLUMNS}>
                  <SectionDropZone sectionKey={section.key} />
                </Grid>
              </Grid>
            </SortableContext>
          </Stack>
        );
      })}
    </Stack>
  );
};
