import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Switch } from "@repo/ui/switch";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import type { FieldOptionLike } from "../field-manager-types";
import {
  canEditOption,
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
  /** 接在「顯示名稱」之後的擴充欄(客製替換頁用;底座頁為空) */
  extraColumns?: readonly TableColumn<FieldOptionLike>[];
}

/**
 * 選項表格(Figma 90:232 起):顯示名稱、值、排序、來源、啟用、操作。
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
  extraColumns = [],
}: FieldOptionsTableProps) => {
  const t = useTranslations("admin.fieldManager.options");

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
  const textColorOf = (field: FieldOptionLike): string =>
    managedByOrgOf(field) === null ? "text.primary" : "text.disabled";

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
    ...extraColumns,
    {
      key: "value",
      header: t("value"),
      width: 140,
      render: (field) => (
        <Typography variant="body2" color="text.secondary">
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
            <Typography component="span" variant="body2" color="text.disabled">
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
