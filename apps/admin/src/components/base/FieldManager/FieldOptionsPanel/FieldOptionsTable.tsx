import { useTranslations } from "use-intl";

import { type TagPaletteKey, isTagPaletteKey } from "@repo/domain/tag-palette";
import { Button } from "@repo/ui/button";
import { Switch } from "@repo/ui/switch";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography, type TypographyColor } from "@repo/ui/typography";

import { TagPaletteChip } from "@/components/base/TagPaletteChip/TagPaletteChip";
import { TagPaletteSelect } from "@/components/base/TagPaletteSelect/TagPaletteSelect";

import type { FieldOptionLike } from "../field-manager-types";
import {
  canEditOption,
  canSetOptionColor,
  canToggleOption,
  fieldSourceView,
  isSeedOption,
  managedByOrgOf,
} from "../field-source";

export interface FieldOptionsTableProps {
  fields: readonly FieldOptionLike[];
  isLoading: boolean;
  canEdit: boolean;
  canToggleEnabled: boolean;
  /** 正在送出的那一筆(同時只會有一筆) */
  pendingFieldId: string | null;
  onToggleEnabled: (field: FieldOptionLike, enabled: boolean) => void;
  onEdit: (field: FieldOptionLike) => void;
  /** 選了色票(`null` = 清掉顏色) */
  onSetColor: (field: FieldOptionLike, color: TagPaletteKey | null) => void;
}

/**
 * 選項表格(Figma 90:232 起):顯示名稱、顏色(Figma BS-13 289:87534)、值、排序、來源、啟用、操作。
 *
 * 「顏色」欄:改得動(`edit` 權限 ∩ 這一層切得動)→ 色票標籤本身可點、開色票面板(沒有顏色時是「不設定」);
 * 改不動 → 只顯示標籤,沒有顏色顯示「不設定」文字(Figma 289:87612)。只能從十組色票選,不能輸入色碼。
 *
 * 合併清單含**上層組織**加的選項與**可見範圍內的下層**加的:兩種都看得到、
 * 都改不動,整列以淡色呈現 + 提示「由 <組織名> 管理」。一列能做什麼一律讀 api 給的
 * `canEdit` / `canToggleEnabled`,解讀集中在 `field-source.ts`,這裡不推組織關係。
 *
 * 與 Figma 的兩處差異(PR 差異表有列):設計稿把「狀態」畫成唯讀 Tag、開關另計,
 * 這裡依票直接用 `Switch`(停用 / 啟用直接送,不另開確認);沒有 `toggle-enabled`
 * 權限時才退回 Tag。改不動的列是**唯讀**的開關 + 一句說明,不是把它藏起來 ——
 * 看得到但動不了,跟「這個動作我沒有權限」是兩回事。理由用 `Tooltip` 提示(REACT-10)。
 */
export const FieldOptionsTable = ({
  fields,
  isLoading,
  canEdit,
  canToggleEnabled,
  pendingFieldId,
  onToggleEnabled,
  onEdit,
  onSetColor,
}: FieldOptionsTableProps) => {
  const t = useTranslations("admin.fieldManager.options");
  const tPalette = useTranslations("admin.tagPalettes.select");

  /** 動不了的理由:別的組織在管 → 帶組織名;種子 → 由系統管理員維護。 */
  const lockedHintOf = (field: FieldOptionLike): string => {
    const org = managedByOrgOf(field);
    return org === null ? t("seedManagedHint") : t("managedByOrgHint", { org });
  };

  /** 操作欄在改不動時顯示的短句。 */
  const lockedLabelOf = (field: FieldOptionLike): string => {
    const org = managedByOrgOf(field);
    if (org !== null) {
      return t("managedByOrg", { org });
    }
    return isSeedOption(field) ? t("seedManaged") : t("none");
  };

  /** 別的組織加的選項整列淡色(反灰):看得到,但這一頁的人碰不到它。 */
  const textColorOf = (field: FieldOptionLike): TypographyColor =>
    managedByOrgOf(field) === null ? "textPrimary" : "textDisabled";

  const columns: TableColumn<FieldOptionLike>[] = [
    {
      key: "label",
      header: t("label"),
      width: 180,
      isEmphasized: true,
      render: (field) => (
        <Typography
          component="span"
          variant="subtitle2"
          color={textColorOf(field)}
        >
          {field.label}
        </Typography>
      ),
    },
    {
      key: "color",
      header: t("color"),
      width: 96,
      render: (field) => {
        // 認不得的代號(色票改版前的舊資料)當沒有顏色
        const color = isTagPaletteKey(field.color) ? field.color : null;
        if (!canSetOptionColor(field, { canEdit })) {
          return color === null ? (
            <Typography component="span" variant="body2" color="textSecondary">
              {tPalette("none")}
            </Typography>
          ) : (
            <TagPaletteChip paletteKey={color} />
          );
        }
        return (
          <TagPaletteSelect
            value={color}
            label={t("colorAria", { name: field.label })}
            disabled={pendingFieldId === field.id}
            onChange={(next) => {
              onSetColor(field, next);
            }}
          />
        );
      },
    },
    {
      key: "value",
      header: t("value"),
      width: 140,
      render: (field) => (
        <Typography variant="body2" color="textSecondary">
          {field.value}
        </Typography>
      ),
    },
    {
      key: "order",
      header: t("order"),
      width: 64,
      render: (field) => (
        <Typography component="span" variant="body2" color={textColorOf(field)}>
          {field.order}
        </Typography>
      ),
    },
    {
      key: "source",
      header: t("source"),
      width: 160,
      render: (field) => {
        const view = fieldSourceView(field);
        return (
          <Tag
            tone={view.tone}
            label={
              view.labelKey === "sourceGlobal"
                ? t("sourceGlobal")
                : t("sourceOwn", { org: view.org })
            }
          />
        );
      },
    },
    {
      key: "enabled",
      header: t("enabled"),
      width: 96,
      render: (field) => {
        const isToggleable = canToggleOption(field, { canToggleEnabled });
        if (!canToggleEnabled) {
          return (
            <Tag
              tone={field.enabled ? "success" : "error"}
              label={field.enabled ? t("stateEnabled") : t("stateDisabled")}
            />
          );
        }
        return (
          <Tooltip title={isToggleable ? "" : lockedHintOf(field)}>
            <Switch
              checked={field.enabled}
              disabled={!isToggleable || pendingFieldId === field.id}
              onChange={(_event, checked) => {
                onToggleEnabled(field, checked);
              }}
              slotProps={{
                input: { "aria-label": t("toggleAria", { name: field.label }) },
              }}
            />
          </Tooltip>
        );
      },
    },
    {
      key: "actions",
      header: t("actions"),
      render: (field) => {
        if (canEditOption(field, { canEdit })) {
          return (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                onEdit(field);
              }}
            >
              {t("edit")}
            </Button>
          );
        }
        // 改不動的列講明「誰在管它」;只是沒有 edit 權限的自己人列不需要解釋
        return (
          <Tooltip title={field.canEdit ? "" : lockedHintOf(field)}>
            <Typography component="span" variant="body2" color="textDisabled">
              {lockedLabelOf(field)}
            </Typography>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Table
      columns={columns}
      rows={fields}
      getRowKey={(field) => field.id}
      isLoading={isLoading}
      size="small"
      minWidth={720}
      emptyMessage={t("empty")}
      aria-label={t("tableAria")}
    />
  );
};
