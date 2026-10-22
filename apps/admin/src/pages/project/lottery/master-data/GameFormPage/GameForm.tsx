import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import type { LotteryGameFieldsFragment } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { Section } from "@/components/base/Section/Section";
import { TagPaletteSelect } from "@/components/project/TagPaletteSelect/TagPaletteSelect";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useUnsavedGuard } from "@/hooks/base/useUnsavedGuard";

import { MASTER_DATA_MODULE_KEYS } from "../master-data-config";
import type { MasterDataAccess } from "../useMasterDataAccess";
import { GameDeleteDialog } from "./GameDeleteDialog";
import { GameInfoFields } from "./GameInfoFields";
import { useGameDelete } from "./useGameDelete";
import { useGameForm } from "./useGameForm";

export interface GameFormProps {
  /** 編輯的那一筆;null = 新增 */
  game: LotteryGameFieldsFragment | null;
  access: MasterDataAccess;
}

/**
 * 遊戲新增 / 編輯(Figma MD-02 97:456、手機 97:1054):三個可收合區塊(遊戲資訊 / 顏色 / 備註),
 * 儲存列固定在底部([刪除] ……… [取消] [儲存],REACT-16)。有庫存時上方提示、代號 / 單張金額 / 整本張數唯讀;
 * [刪除] 只在 `abilities.canDelete`(有 `games.delete` 且從未被引用)時出現。
 */
export const GameForm = ({ game, access }: GameFormProps) => {
  const t = useTranslations("admin.lotteryMasterData");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const pageId =
    game === null
      ? `${MASTER_DATA_MODULE_KEYS.games}.create`
      : `${MASTER_DATA_MODULE_KEYS.games}.edit`;
  const form = useGameForm(game, (id) => {
    if (access.gameViewRoute !== null) {
      void navigate(`${access.gameViewRoute}/${id}`);
    } else if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  });
  const deletion = useGameDelete(game?.id ?? "", access);
  useUnsavedGuard(form.isDirty && !form.isSubmitting);

  const isLocked = game?.inUse === true;
  const leave = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Stack
        spacing={2}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          pb: 2,
          // 區塊不被捲動容器壓扁(內容自己撐高,容器捲動)
          "& > *": { flexShrink: 0 },
        }}
      >
        <Typography variant="h6">
          {game === null ? t("gameForm.createTitle") : t("gameForm.editTitle")}
        </Typography>
        {isLocked && <Alert severity="info">{t("gameForm.locked")}</Alert>}
        {form.errorCode !== null && (
          <Alert severity="error">{t(`errors.${form.errorCode}`)}</Alert>
        )}
        <Section
          pageId={pageId}
          sectionKey="info"
          title={t("gameForm.sections.info")}
        >
          <GameInfoFields
            values={form.values}
            change={form.change}
            invalidFields={form.invalidFields}
            isLocked={isLocked}
          />
        </Section>
        <Section
          pageId={pageId}
          sectionKey="color"
          title={t("gameForm.sections.color")}
        >
          <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
            <Typography variant="body2" color="textSecondary">
              {t("gameForm.colorHint")}
            </Typography>
            <TagPaletteSelect
              value={form.values.color}
              onChange={(value) => {
                form.change("color", value);
              }}
            />
          </Stack>
        </Section>
        <Section
          pageId={pageId}
          sectionKey="note"
          title={t("gameForm.sections.note")}
        >
          <TextField
            label={t("gameForm.fields.note")}
            value={form.values.note}
            multiline
            minRows={2}
            fullWidth
            error={form.invalidFields.includes("note")}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
            onChange={(event) => {
              form.change("note", event.target.value);
            }}
          />
        </Section>
      </Stack>

      {/* 儲存列固定在底部(RW-02):內容自己捲,這一列不跟著捲;[刪除] 不屬於送出流程,放左側 */}
      <FormActions
        {...(game?.abilities.canDelete === true && {
          start: (
            <Button variant="text" color="error" onClick={deletion.ask}>
              {t("gameForm.delete")}
            </Button>
          ),
        })}
        cancel={{ label: t("gameForm.cancel"), onClick: leave }}
        submit={{
          label: t("gameForm.save"),
          disabled: form.isSubmitting,
          onClick: form.submit,
        }}
      />

      {game !== null && deletion.isConfirming && (
        <GameDeleteDialog
          gameName={game.name}
          isSubmitting={deletion.isSubmitting}
          errorCode={deletion.errorCode}
          onCancel={deletion.cancel}
          onConfirm={deletion.confirm}
        />
      )}
    </Stack>
  );
};
