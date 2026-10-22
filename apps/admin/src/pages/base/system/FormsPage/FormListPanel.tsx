import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import type { FormFieldsFragment } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { List, ListItemButton, ListItemText } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

const versionOf = (form: FormFieldsFragment): number | null =>
  form.currentVersion ?? null;

export interface FormListPanelProps {
  forms: readonly FormFieldsFragment[];
  isLoading: boolean;
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  canCreate: boolean;
  onCreate: () => void;
  /** 清單區塊的 id(平板寬收起 / 展開鈕的 `aria-controls`) */
  id?: string;
  /** 標頭右端的 [收起](平板寬才有,`DesignerListCollapseButton`) */
  collapseButton?: ReactNode;
}

/**
 * 表單管理左欄:共用與客製表單、分派與啟用狀態、版本號;
 * 租戶視角另標流程綁定(綁到哪個流程 / 「綁定的流程已失效」)。
 * root 看全部共用表單;租戶看分派來的 + 自己的客製表單(範圍由 api 決定)。
 */
export const FormListPanel = ({
  forms,
  isLoading,
  keyword,
  onKeywordChange,
  selectedKey,
  onSelect,
  canCreate,
  onCreate,
  id,
  collapseButton,
}: FormListPanelProps) => {
  const t = useTranslations("admin.forms.list");

  return (
    <Card
      component="section"
      id={id}
      aria-label={t("region")}
      sx={{
        // 手機寬(主從一次只顯示一邊)清單滿版
        width: { xs: "100%", sm: 320 },
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Stack spacing={1.5} sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            {t("title")}
          </Typography>
          {canCreate && (
            <Button size="small" onClick={onCreate}>
              {t("create")}
            </Button>
          )}
          {collapseButton}
        </Stack>
        <TextField
          label={t("search")}
          placeholder={t("searchPlaceholder")}
          size="small"
          value={keyword}
          onChange={(event) => {
            onKeywordChange(event.target.value);
          }}
        />
      </Stack>
      {isLoading ? (
        <Stack sx={{ alignItems: "center", py: 3 }}>
          <CircularProgress aria-label={t("loading")} />
        </Stack>
      ) : (
        <List
          aria-label={t("region")}
          sx={{ flex: 1, minHeight: 0, overflow: "auto" }}
        >
          {forms.length === 0 && (
            <Typography variant="body2" color="textSecondary" sx={{ px: 2 }}>
              {t("empty")}
            </Typography>
          )}
          {forms.map((form) => (
            <ListItemButton
              key={form.key}
              selected={form.key === selectedKey}
              onClick={() => {
                onSelect(form.key);
              }}
            >
              <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                {/* ListItemText 自帶上下 6px margin;Stack 用 gap 後不再被歸零,這裡歸零維持列高 */}
                <ListItemText
                  primary={form.name}
                  secondary={form.key}
                  sx={{ my: 0 }}
                />
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                  <Tag
                    tone={form.isShared ? "primary" : "grey"}
                    label={form.isShared ? t("shared") : t("custom")}
                  />
                  <Tag
                    tone={versionOf(form) === null ? "warning" : "success"}
                    label={
                      versionOf(form) === null
                        ? t("noVersion")
                        : t("version", { version: versionOf(form) ?? 0 })
                    }
                  />
                  {form.tenantEnabled === false && (
                    <Tag tone="grey" label={t("disabled")} />
                  )}
                  {form.hasDraft && <Tag tone="grey" label={t("hasDraft")} />}
                  {form.workflowBinding !== null &&
                    form.workflowBinding !== undefined && (
                      <Tag
                        tone={
                          form.workflowBinding.isValid ? "primary" : "error"
                        }
                        label={
                          form.workflowBinding.isValid
                            ? t("workflow", {
                                name:
                                  form.workflowBinding.workflowName ??
                                  form.workflowBinding.workflowKey,
                              })
                            : t("workflowInvalid")
                        }
                      />
                    )}
                </Stack>
              </Stack>
            </ListItemButton>
          ))}
        </List>
      )}
    </Card>
  );
};
