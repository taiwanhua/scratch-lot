import { useState } from "react";
import { useTranslations } from "use-intl";

import { type FieldDef, sectionCollapseOf } from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Menu, MenuItem } from "@repo/ui/menu";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type { DesignSection } from "@/lib/base/form-engine/design-definition";
import type { DesignerIssue } from "@/lib/base/form-engine/designer-issues";
import {
  type SectionCollapsePatch,
  sectionCols,
} from "@/lib/base/form-engine/designer-ops";

export interface SectionPropertyPanelProps {
  section: DesignSection;
  fields: readonly FieldDef[];
  /** 檢查器指到這個分區的錯誤與警告(版面位置是這個分區的) */
  issues: readonly DesignerIssue[];
  onChange: (patch: SectionCollapsePatch) => void;
  onBack: () => void;
}

/**
 * 分區設定:可以收合、預設收合、收合時標題列顯示的欄位。
 * 標題列欄位只能挑放在本分區的非明細欄位(檢查器同一條規則);關掉「可以收合」時另兩項停用並清掉。
 */
export const SectionPropertyPanel = ({
  section,
  fields,
  issues,
  onChange,
  onBack,
}: SectionPropertyPanelProps) => {
  const t = useTranslations("admin.forms.sectionProperty");
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const settings = sectionCollapseOf(section);
  const labelOf = (key: string) =>
    fields.find((field) => field.key === key)?.label ?? key;
  const candidates = sectionCols(section)
    .map((col) => fields.find((field) => field.key === col.fieldKey))
    .filter(
      (field): field is FieldDef =>
        field !== undefined &&
        field.type !== "array" &&
        !settings.summaryFieldKeys.includes(field.key),
    );

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t("title", { title: section.title })}
        </Typography>
        <Button variant="text" size="small" onClick={onBack}>
          {t("backToSettings")}
        </Button>
      </Stack>
      {issues.length > 0 && (
        <Stack spacing={0.5} role="list" aria-label={t("issues")}>
          {issues.map((issue, index) => (
            <Typography
              key={`${issue.code}-${String(index)}`}
              role="listitem"
              variant="caption"
              color="error"
            >
              {issue.message}
            </Typography>
          ))}
        </Stack>
      )}
      <Stack spacing={1}>
        <FormControlLabel
          label={t("collapsible")}
          control={
            <Switch
              checked={settings.collapsible}
              onChange={(_event, checked) => {
                onChange({ collapsible: checked });
              }}
            />
          }
        />
        <FormControlLabel
          label={t("defaultCollapsed")}
          disabled={!settings.collapsible}
          control={
            <Switch
              checked={settings.defaultCollapsed}
              onChange={(_event, checked) => {
                onChange({ defaultCollapsed: checked });
              }}
            />
          }
        />
      </Stack>
      <Stack spacing={1}>
        <Typography
          variant="body2"
          color={settings.collapsible ? "text.secondary" : "text.disabled"}
        >
          {t("summaryFields")}
        </Typography>
        <Stack
          direction="row"
          role="list"
          aria-label={t("summaryFields")}
          sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}
        >
          {settings.summaryFieldKeys.map((key) => (
            <span key={key} role="listitem">
              <Tag
                label={labelOf(key)}
                onDelete={() => {
                  onChange({
                    summaryFieldKeys: settings.summaryFieldKeys.filter(
                      (candidate) => candidate !== key,
                    ),
                  });
                }}
              />
            </span>
          ))}
          <Button
            variant="text"
            size="small"
            disabled={!settings.collapsible || candidates.length === 0}
            onClick={(event) => {
              setMenuAnchor(event.currentTarget);
            }}
          >
            {t("addSummaryField")}
          </Button>
        </Stack>
        {!settings.collapsible && (
          <Typography variant="caption" color="text.secondary">
            {t("summaryNeedsCollapsible")}
          </Typography>
        )}
      </Stack>
      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor !== null}
        onClose={() => {
          setMenuAnchor(null);
        }}
      >
        {candidates.map((field) => (
          <MenuItem
            key={field.key}
            onClick={() => {
              onChange({
                summaryFieldKeys: [...settings.summaryFieldKeys, field.key],
              });
              setMenuAnchor(null);
            }}
          >
            {field.label}
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
};
