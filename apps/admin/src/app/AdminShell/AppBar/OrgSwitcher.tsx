import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import { type MeQuery, useMeQuery, useSwitchOrgMutation } from "@repo/graphql";
import { SelectField } from "@repo/ui/select-field";

import { useRealtimeRefresh } from "@/hooks/base/useRealtime";
import { useSession } from "@/hooks/base/useSession";

export interface OrgSwitcherProps {
  me: MeQuery["me"];
}

/** 下拉的最小寬(px):組織名短時也和其他下拉一樣有個像樣的寬度。 */
const MIN_WIDTH = 180;

/**
 * AppBar 的當前組織切換器:標題「當前組織」的 `SelectField`(和其他表單下拉同一個外觀);
 * `switchOrg` 換發 access token 後精準 invalidate `me`(DATA-02 / DATA-04),當前組織隨之更新;
 * 並立即換發即時通道的訂閱憑證(換到別的租戶時改連新租戶的 Durable Object,不必等到期前的換發)。
 */
export const OrgSwitcher = ({ me }: OrgSwitcherProps) => {
  const t = useTranslations("admin.shell");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const refreshRealtime = useRealtimeRefresh();

  const switchOrg = useSwitchOrgMutation(session.client, {
    onSuccess: ({ switchOrg: payload }) => {
      session.store.getState().setAccessToken(payload.accessToken);
      void queryClient.invalidateQueries({ queryKey: useMeQuery.getKey() });
      refreshRealtime();
    },
  });

  return (
    <SelectField
      label={t("currentOrg")}
      size="small"
      value={me.currentOrg?.id ?? ""}
      options={me.orgs.map((org) => ({ value: org.id, label: org.name }))}
      onChange={(orgId) => {
        switchOrg.mutate({ input: { orgId } });
      }}
      disabled={switchOrg.isPending || me.orgs.length === 0}
      sx={{ minWidth: MIN_WIDTH }}
    />
  );
};
