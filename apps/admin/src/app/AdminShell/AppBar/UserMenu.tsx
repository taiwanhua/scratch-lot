import { type MouseEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { useLogoutAllDevicesMutation, useLogoutMutation } from "@repo/graphql";
import { type Locale, localeLabels, locales } from "@repo/i18n";
import {
  COLOR_MODES,
  type ColorMode,
  useColorMode,
} from "@repo/ui/app-theme-provider";
import { Avatar } from "@repo/ui/avatar";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import {
  DarkModeIcon,
  DevicesIcon,
  LightModeIcon,
  LogoutIcon,
  SystemModeIcon,
} from "@repo/ui/icons";
import { MenuItem, MenuItemIcon, MenuList } from "@repo/ui/menu";
import { Popover } from "@repo/ui/popover";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useRealtimeStatus } from "@/hooks/base/useRealtime";
import { useSession } from "@/hooks/base/useSession";
import { LOGIN_PATH } from "@/lib/base/paths";
import { useLocaleStore } from "@/stores/base/useLocaleStore";

/** 觸發鈕的頭像(theme.spacing 單位;Figma AdminAppBar avatar 32)。 */
const AVATAR_SIZE = 4;
/** 使用者卡的頭像(theme.spacing 單位;Figma AdminUserMenu 275:80,40)。 */
const CARD_AVATAR_SIZE = 5;
/** 選單寬(px;Figma `Draft/AdminUserMenu` 278:77)。 */
const MENU_WIDTH = 260;
/** 選單內各區塊的左右內距(theme.spacing 單位;Figma 12,與 `MenuList` 的項目左緣對齊)。 */
const ITEM_INSET = 1.5;
/** 連線狀態小圓點的直徑(px;疊在觸發鈕頭像右下角)。 */
const STATUS_DOT_SIZE = 10;

const COLOR_MODE_ICONS: Record<ColorMode, ReactNode> = {
  system: <SystemModeIcon />,
  light: <LightModeIcon />,
  dark: <DarkModeIcon />,
};

export interface UserMenuProps {
  /** 登入者名稱:按鈕文字、頭像首字、使用者卡的姓名 */
  name: string;
  /** 登入帳號:使用者卡第二行 */
  account: string;
  /** 當前組織名:使用者卡第二行接在帳號後面;沒有當前組織時只顯示帳號 */
  orgName?: string;
}

/** 選單裡的一段:小標 + 分段按鈕(Figma 275:86 / 275:101)。 */
const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <Stack spacing={0.75} sx={{ px: ITEM_INSET, py: 0.75 }}>
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ fontWeight: 600 }}
    >
      {title}
    </Typography>
    {children}
  </Stack>
);

/** 分隔線(Figma 275:85 / 275:108;`<hr>` 自帶 separator 語意)。 */
const Separator = () => (
  <Box
    component="hr"
    sx={{ m: 0, border: 0, borderTop: 1, borderColor: "divider" }}
  />
);

/**
 * AppBar 的使用者選單(頭像;Figma `Draft/AdminUserMenu` 278:77):
 * - **使用者卡**:頭像 + 姓名 + 「帳號 · 當前組織」,不可點
 * - **外觀**:跟隨系統 / 亮 / 暗(`@repo/ui` 的 `useColorMode`,選擇記在 localStorage,預設跟隨系統)
 * - **語言**:語言只記 localStorage(I18N-05),經 `useLocaleStore` 寫回
 * - 登出 / 登出所有裝置(api 打完先離開受保護路由再清狀態,登出不帶 next)
 *
 * 頭像右下角的小圓點是即時通道的連線狀態(底座規格第 4 章「降級」):綠 = 即時;黃 = 重新連線中(慢速模式,
 * 資料每 60 秒更新一次)。
 *
 * 外觀與語言是分段按鈕,切了立刻生效、**不關選單**。浮層用 `Popover` 而不是 `Menu`:`Menu` 按 Tab 就關、
 * 而且只讓 `MenuItem` 參與鍵盤移動,分段按鈕會變成鍵盤到不了;這裡只有登出兩項是 `MenuList`(上下鍵移動),
 * 其餘靠 Tab 依序走到(Popover 把焦點圈在浮層裡,Esc 關閉)。
 */
export const UserMenu = ({ name, account, orgName }: UserMenuProps) => {
  const t = useTranslations("admin.shell.userMenu");
  const tSession = useTranslations("admin.session");
  const tRealtime = useTranslations("admin.realtime");
  const isLive = useRealtimeStatus() === "live";
  const realtimeLabel = tRealtime(isLive ? "live" : "slow");
  const { session } = useSession();
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const colorMode = useColorMode();
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);

  // 先離開受保護路由再清狀態,登出不帶 next
  const signOut = () => {
    void navigate(LOGIN_PATH, { replace: true });
    session.signOut();
  };
  const logout = useLogoutMutation(session.client, { onSettled: signOut });
  const logoutAllDevices = useLogoutAllDevicesMutation(session.client, {
    onSettled: signOut,
  });

  const openMenu = (event: MouseEvent<HTMLElement>) => {
    setMenuAnchor(event.currentTarget);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
  };

  const initial = name.charAt(0);

  return (
    <>
      <Button
        variant="text"
        color="inherit"
        aria-haspopup="dialog"
        aria-expanded={menuAnchor === null ? undefined : true}
        onClick={openMenu}
        startIcon={
          <Box sx={{ position: "relative", display: "inline-flex" }}>
            <Avatar
              aria-hidden
              sx={{
                width: (theme) => theme.spacing(AVATAR_SIZE),
                height: (theme) => theme.spacing(AVATAR_SIZE),
                bgcolor: "primary.lighter",
                color: "primary.dark",
                typography: "subtitle2",
              }}
            >
              {initial}
            </Avatar>
            <Box
              component="span"
              // 不進按鈕的可及名稱(按鈕名稱維持使用者姓名);滑過顯示狀態文字
              aria-hidden
              title={realtimeLabel}
              data-testid="realtime-status"
              data-status={isLive ? "live" : "slow"}
              sx={{
                position: "absolute",
                right: -1,
                bottom: -1,
                width: STATUS_DOT_SIZE,
                height: STATUS_DOT_SIZE,
                borderRadius: "50%",
                border: 2,
                borderColor: "background.paper",
                bgcolor: isLive ? "success.main" : "warning.main",
              }}
            />
          </Box>
        }
        sx={{ typography: "subtitle2" }}
      >
        {name}
      </Button>
      <Popover
        anchorEl={menuAnchor}
        open={menuAnchor !== null}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            role: "dialog",
            "aria-label": t("title"),
            sx: { width: MENU_WIDTH, p: 1 },
          },
        }}
      >
        <Stack spacing={0.5}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center", px: ITEM_INSET, pt: 1, pb: 1.25 }}
          >
            <Avatar
              aria-hidden
              sx={{
                width: (theme) => theme.spacing(CARD_AVATAR_SIZE),
                height: (theme) => theme.spacing(CARD_AVATAR_SIZE),
                bgcolor: "primary.lighter",
                color: "primary.dark",
                typography: "subtitle1",
              }}
            >
              {initial}
            </Avatar>
            <Stack spacing={0.25} sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap>
                {name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {orgName === undefined ? account : `${account} · ${orgName}`}
              </Typography>
            </Stack>
          </Stack>
          <Separator />
          <Section title={t("appearance")}>
            <SegmentedControl<ColorMode>
              aria-label={t("appearance")}
              value={colorMode.mode}
              onChange={colorMode.setMode}
              options={COLOR_MODES.map((mode) => ({
                value: mode,
                label: t(`modes.${mode}`),
                icon: COLOR_MODE_ICONS[mode],
              }))}
            />
          </Section>
          <Section title={t("language")}>
            <SegmentedControl<Locale>
              aria-label={t("language")}
              value={locale}
              onChange={setLocale}
              options={locales.map((item) => ({
                value: item,
                label: localeLabels[item],
              }))}
            />
          </Section>
          <Separator />
          <MenuList dense disablePadding>
            <MenuItem
              disabled={logout.isPending}
              onClick={() => {
                closeMenu();
                logout.mutate({});
              }}
            >
              <MenuItemIcon>
                <LogoutIcon />
              </MenuItemIcon>
              {tSession("logout")}
            </MenuItem>
            <MenuItem
              disabled={logoutAllDevices.isPending}
              onClick={() => {
                closeMenu();
                logoutAllDevices.mutate({});
              }}
            >
              <MenuItemIcon>
                <DevicesIcon />
              </MenuItemIcon>
              {tSession("logoutAllDevices")}
            </MenuItem>
          </MenuList>
        </Stack>
      </Popover>
    </>
  );
};
