import type { MeQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";

import type { ShellModule } from "@/lib/base/module-tree";

import { HelpButton } from "../AppBar/HelpButton";
import { UserMenu } from "../AppBar/UserMenu";

export interface MobileNavFooterProps {
  me: MeQuery["me"];
  /** 目前網址對上的模組;非模組路由為 undefined,不顯示「?」 */
  module?: ShellModule;
}

/**
 * 抽屜底部(精簡版,< `md`):精簡版 AppBar 移走的頭像選單(個人設定、外觀、語言、登出…)與「?」模組說明,
 * 直接沿用 AppBar 的 `UserMenu` / `HelpButton`,行為與 `md` 以上相同。
 */
export const MobileNavFooter = ({ me, module }: MobileNavFooterProps) => (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1,
      pt: 1.5,
      mt: 1,
      borderTop: 1,
      borderColor: "divider",
    }}
  >
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <UserMenu
        name={me.name}
        account={me.account}
        orgName={me.currentOrg?.name}
        placement="above"
      />
    </Box>
    {module !== undefined && (
      <HelpButton
        moduleKey={module.key}
        moduleName={module.name}
        moduleEngine={module.engine}
      />
    )}
  </Box>
);
