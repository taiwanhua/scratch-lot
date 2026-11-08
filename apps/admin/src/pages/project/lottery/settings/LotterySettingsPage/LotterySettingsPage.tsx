import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  useCancelLotteryCountModeConversionMutation,
  useCustomizeLotterySettingMutation,
  useLotterySettingsQuery,
  useRestoreLotterySettingMutation,
} from "@repo/graphql";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";

import { CancelConversionDialog } from "../CancelConversionDialog/CancelConversionDialog";
import { CountModeHistoryDialog } from "../CountModeHistoryDialog/CountModeHistoryDialog";
import { SettingDialog } from "../SettingDialog/SettingDialog";
import { SettingRow } from "../SettingRow/SettingRow";
import { lotterySettingsErrorOf } from "../lottery-settings-error";
import type { LotterySettingItem, LotterySettings } from "../setting-display";

/** `?org=`:設定頁看的組織;空字串 = 當前組織(關帳彈窗連進來帶入那家店)。 */
const orgSchema = z.string().default("");

/**
 * 刮刮樂設定(`lottery-settings`;Figma CS-50a～h;張數店規格第 4 節):照排班設定的規則分頁(SC-10)。
 *
 * - 上方分店選擇器(`OrgTreeSelect`,可見範圍,記在網址 `?org=`),下方一條設定一列(`SettingRow`)
 * - 點一列 → 編輯對話框(`SettingDialog`);能不能改由 api 算好的 `canEdit` 決定
 *   (最上層組織看 `edit-default`、其他看 `edit-org`;沒有時看不到 [自訂] [還原])
 * - 盤點制度那一列:分店才有 [變更紀錄];轉換中值寫「張數盤點 → 編號盤點(轉換中,等補點編號)」並有 [取消轉換]
 */
export const LotterySettingsPage = () => {
  const t = useTranslations("admin.lotterySettings");
  const tErrors = useTranslations("admin.lotterySettings.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [orgId, setOrgId] = useUrlState("org", orgSchema);
  const variables = { input: orgId === "" ? null : { orgId } };
  const query = useLotterySettingsQuery(session.client, variables);
  const settings = query.data?.lotterySettings;
  const [editing, setEditing] = useState<LotterySettingItem | null>(null);
  const [isHistoryOpen, setHistoryOpen] = useState(false);
  const [isCancelling, setCancelling] = useState(false);

  const write = (next: LotterySettings) => {
    queryClient.setQueryData(useLotterySettingsQuery.getKey(variables), {
      lotterySettings: next,
    });
    setEditing(null);
    setCancelling(false);
  };
  const error = (cause: unknown) => tErrors(lotterySettingsErrorOf(cause).code);
  const customize = useCustomizeLotterySettingMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.saveSuccess"),
      error,
      onSuccess: (data) => {
        write(data.customizeLotterySetting.settings);
      },
    }),
  );
  const restore = useRestoreLotterySettingMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.restoreSuccess"),
      error,
      onSuccess: (data) => {
        write(data.restoreLotterySetting.settings);
      },
    }),
  );
  const cancelConversion = useCancelLotteryCountModeConversionMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.cancelConversionSuccess"),
      error,
      onSuccess: (data) => {
        write(data.cancelLotteryCountModeConversion.settings);
      },
    }),
  );
  const isPending =
    customize.isPending || restore.isPending || cancelConversion.isPending;

  if (settings === undefined) {
    return (
      <Typography color="textSecondary">
        {query.isError ? error(query.error) : null}
      </Typography>
    );
  }

  const orgInput = { orgId: settings.orgId };
  const storeMode = settings.storeCountMode?.mode ?? null;
  const openHistory = () => {
    setHistoryOpen(true);
  };

  return (
    <Stack spacing={2}>
      <OrgTreeSelect
        // 業務頁:可見範圍內的才能選(用法表 ④)
        scope="visible"
        label={t("org")}
        value={[settings.orgId]}
        size="small"
        onChange={(ids) => {
          setOrgId(ids.at(0) ?? "");
        }}
      />
      <Card variant="outlined">
        {settings.items.map((item) => {
          const isCountMode = item.key === "count_mode";
          return (
            <SettingRow
              key={item.key}
              item={item}
              isTenantTop={settings.isTenantTop}
              canEdit={settings.canEdit}
              isPending={isPending}
              storeMode={isCountMode ? storeMode : null}
              {...(isCountMode && settings.isStore
                ? { onHistory: openHistory }
                : {})}
              {...(isCountMode &&
              settings.storeCountMode?.canCancelConversion === true
                ? {
                    onCancelConversion: () => {
                      setCancelling(true);
                    },
                  }
                : {})}
              onOpen={() => {
                setEditing(item);
              }}
              onRestore={() => {
                restore.mutate({ input: { ...orgInput, key: item.key } });
              }}
            />
          );
        })}
      </Card>
      {editing !== null && (
        <SettingDialog
          item={editing}
          settings={settings}
          isPending={isPending}
          {...(editing.key === "count_mode" && settings.isStore
            ? { onHistory: openHistory }
            : {})}
          onSave={(option) => {
            customize.mutate({
              input: { ...orgInput, key: editing.key, option },
            });
          }}
          onRestore={() => {
            restore.mutate({ input: { ...orgInput, key: editing.key } });
          }}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {isHistoryOpen && (
        <CountModeHistoryDialog
          orgId={settings.orgId}
          orgName={settings.orgName}
          onClose={() => {
            setHistoryOpen(false);
          }}
        />
      )}
      {isCancelling && (
        <CancelConversionDialog
          orgName={settings.orgName}
          isPending={isPending}
          onConfirm={() => {
            cancelConversion.mutate({ input: orgInput });
          }}
          onClose={() => {
            setCancelling(false);
          }}
        />
      )}
    </Stack>
  );
};
