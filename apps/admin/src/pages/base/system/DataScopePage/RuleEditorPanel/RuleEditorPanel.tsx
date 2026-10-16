import { useTranslations } from "use-intl";

import { DataScopeCombineOp } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { OrgNodeLike, OrgOption } from "@/lib/base/org-tree";

import type {
  DataScopeRuleData,
  DataScopeTarget,
  PickerOption,
} from "../data-scope-types";
import { RuleCard } from "./RuleCard";
import { useRuleEditor } from "./useRuleEditor";

export interface RuleEditorPanelProps {
  target: DataScopeTarget;
  /** 這個目標目前存著的規則(`null` = 尚無規則) */
  rule: DataScopeRuleData | null;
  canEdit: boolean;
  roleOptions: readonly PickerOption[];
  userOptions: readonly PickerOption[];
  orgNodes: readonly OrgNodeLike[];
  orgOptions: readonly OrgOption[];
  /** 儲存成功後失效相關查詢(帶目標 id) */
  onSaved: (targetId: string) => void;
  onDirtyChange: (isDirty: boolean) => void;
}

/**
 * 右欄規則編輯器(Figma RuleEditor 167:244):目標說明 + 預設提示 + 頂層合成 + 規則清單 + 儲存。
 *
 * **由頁面以 `key={target.id}` 掛載**:切資料目標等於換一份草稿,重新掛載比在 effect 裡
 * 同步乾淨(REACT-06 / REACT-08)。
 */
export const RuleEditorPanel = ({
  target,
  rule,
  canEdit,
  roleOptions,
  userOptions,
  orgNodes,
  orgOptions,
  onSaved,
  onDirtyChange,
}: RuleEditorPanelProps) => {
  const t = useTranslations("admin.dataScope.editor");
  const tErrors = useTranslations("admin.dataScope.errors");
  const editor = useRuleEditor({ target, rule, onSaved, onDirtyChange });

  const env = {
    fields: target.fields,
    orgNodes,
    orgOptions,
    roleOptions,
    userOptions,
    issues: editor.issues,
    isReadOnly: !canEdit,
  };

  return (
    <Card
      component="section"
      aria-label={t("region")}
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        p: 2.5,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack spacing={2.5} sx={{ flex: 1, minHeight: 0 }}>
        <Stack spacing={0.25}>
          <Typography variant="subtitle1">
            {t("targetName", {
              name: target.moduleName,
              collection: target.collection,
            })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {target.description ?? ""}
          </Typography>
        </Stack>

        <Box
          sx={{
            bgcolor: "background.default",
            borderRadius: 1,
            px: 1.5,
            py: 1.25,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {t("defaultHint")}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <SelectField
            size="small"
            label={t("combineOp")}
            value={editor.draft.combineOp}
            disabled={!canEdit}
            sx={{ width: 320 }}
            options={[
              { value: DataScopeCombineOp.Or, label: t("combineOr") },
              { value: DataScopeCombineOp.And, label: t("combineAnd") },
            ]}
            onChange={editor.setCombineOp}
          />
          <Typography variant="caption" color="text.secondary">
            {t("combineOpHint")}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {canEdit && (
            <Button variant="text" size="small" onClick={editor.addRule}>
              {t("addRule")}
            </Button>
          )}
        </Stack>

        {/* 規則清單佔滿剩下的高度、自己捲(STYLE-08) */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <Stack spacing={2}>
            {editor.draft.rules.length === 0 && (
              <Typography variant="body2">{t("noRules")}</Typography>
            )}
            {editor.draft.rules.map((item, index) => (
              <RuleCard
                key={index}
                rule={item}
                index={index}
                env={env}
                onChange={(next) => {
                  editor.updateRule(index, next);
                }}
                onRemove={() => {
                  editor.removeRule(index);
                }}
              />
            ))}
          </Stack>
        </Box>

        {editor.error !== null && (
          <Alert severity="error">{tErrors(editor.error.code)}</Alert>
        )}

        {canEdit && (
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ justifyContent: "flex-end" }}
          >
            <Button variant="text" size="small" onClick={editor.discard}>
              {t("discard")}
            </Button>
            <Button disabled={editor.isSaving} onClick={editor.submit}>
              {t("save")}
            </Button>
          </Stack>
        )}
      </Stack>
    </Card>
  );
};
