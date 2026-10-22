import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { type MeQuery, useMeQuery, useSwitchOrgMutation } from "@repo/graphql";
import { Avatar } from "@repo/ui/avatar";
import { Button } from "@repo/ui/button";
import { ChevronDownIcon, moduleIconOf } from "@repo/ui/icons";
import { Menu, MenuItem } from "@repo/ui/menu";
import { SelectField } from "@repo/ui/select-field";

import { useRealtimeRefresh } from "@/hooks/base/useRealtime";
import { useSession } from "@/hooks/base/useSession";

export interface OrgSwitcherProps {
  me: MeQuery["me"];
  /** 手機寬的精簡版:只顯示當前組織名稱首字的小按鈕,點了展開組織清單 */
  isCompact?: boolean;
}

/** 下拉的最小寬(px):組織名短時也和其他下拉一樣有個像樣的寬度。 */
const MIN_WIDTH = 180;
/** 精簡版首字圓框的大小(theme.spacing 單位;與頭像同 32)。 */
const COMPACT_BADGE_SIZE = 4;
/** 沒有當前組織時精簡鈕的佔位圖示(模組圖示白名單的「組織」;模組層取出,不在 render 內宣告) */
const OrgPlaceholderIcon = moduleIconOf("business");

/**
 * AppBar 的當前組織切換器:標題「當前組織」的 `SelectField`(和其他表單下拉同一個外觀);
 * `switchOrg` 換發 access token 後精準 invalidate `me`(DATA-02 / DATA-04),當前組織隨之更新;
 * 並立即換發即時通道的訂閱憑證(換到別的租戶時改連新租戶的 Durable Object,不必等到期前的換發)。
 *
 * 精簡版頂部列(`isCompact`,殼 < `md`)放不下 180 寬的下拉:改成組織名首字的小按鈕(可及名稱「當前組織:名稱」),
 * 點了展開同一份組織清單(`Menu`,當前組織標為選中),選了走同一個切換流程;點目前組織不重複切換。
 * 沒有當前組織時首字換成組織佔位圖示,可及名稱「當前組織:尚未選擇」。
 */
export const OrgSwitcher = ({ me, isCompact = false }: OrgSwitcherProps) => {
  const t = useTranslations("admin.shell");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const refreshRealtime = useRealtimeRefresh();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const switchOrg = useSwitchOrgMutation(session.client, {
    onSuccess: ({ switchOrg: payload }) => {
      session.store.getState().setAccessToken(payload.accessToken);
      void queryClient.invalidateQueries({ queryKey: useMeQuery.getKey() });
      refreshRealtime();
    },
  });
  const select = (orgId: string) => {
    switchOrg.mutate({ input: { orgId } });
  };
  const currentId = me.currentOrg?.id ?? "";
  const isDisabled = switchOrg.isPending || me.orgs.length === 0;

  if (!isCompact) {
    return (
      <SelectField
        label={t("currentOrg")}
        size="small"
        value={currentId}
        options={me.orgs.map((org) => ({ value: org.id, label: org.name }))}
        onChange={select}
        disabled={isDisabled}
        sx={{ minWidth: MIN_WIDTH }}
      />
    );
  }

  const currentName = me.currentOrg?.name;
  return (
    <>
      <Button
        variant="text"
        color="inherit"
        aria-label={
          currentName === undefined
            ? t("currentOrgNone")
            : t("currentOrgNamed", { name: currentName })
        }
        aria-haspopup="menu"
        aria-expanded={menuAnchor !== null}
        disabled={isDisabled}
        onClick={(event) => {
          setMenuAnchor(event.currentTarget);
        }}
        endIcon={<ChevronDownIcon fontSize="small" />}
        sx={{ minWidth: 0, flexShrink: 0, px: 0.5 }}
      >
        <Avatar
          aria-hidden
          variant="rounded"
          sx={{
            width: (theme) => theme.spacing(COMPACT_BADGE_SIZE),
            height: (theme) => theme.spacing(COMPACT_BADGE_SIZE),
            bgcolor: "action.selected",
            color: "text.primary",
            typography: "subtitle2",
          }}
        >
          {currentName === undefined ? (
            <OrgPlaceholderIcon fontSize="small" />
          ) : (
            currentName.slice(0, 1)
          )}
        </Avatar>
      </Button>
      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor !== null}
        onClose={() => {
          setMenuAnchor(null);
        }}
        slotProps={{ list: { "aria-label": t("currentOrg") } }}
      >
        {me.orgs.map((org) => (
          <MenuItem
            key={org.id}
            selected={org.id === currentId}
            onClick={() => {
              setMenuAnchor(null);
              if (org.id !== currentId) {
                select(org.id);
              }
            }}
          >
            {org.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
