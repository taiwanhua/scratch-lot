import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";
import { type ReactElement, createElement } from "react";

import { defaultLocale, messages } from "@repo/i18n";

import {
  RealtimeContext,
  type RealtimeContextValue,
} from "@/hooks/base/useRealtime";
import { authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { RootOrgNotice } from "./RootOrgNotice";
import { withTenantRequired } from "./WithTenantRequired";

const ROOT = { id: "org-root", name: "根組織" };
const TENANT = { id: "org-tenant", name: "示範組織" };
/** 預設主訊息(取自組裝後的字典:專案可以替換這一句)。 */
const DEFAULT_MESSAGE =
  messages[defaultLocale].admin.shell.rootOrgNotice.message;

const GuardedContent = () => <p>受保護的內容</p>;
const Guarded = withTenantRequired(GuardedContent);

/** 探針掛在路由旁(殼外面):切換器要的即時通道 context 給一份不連線的。 */
const noop = () => null;
const offlineRealtime: RealtimeContextValue = {
  status: "connecting",
  listen: () => noop,
  setBoard: () => null,
  refresh: () => null,
};

/** 站在根組織(`tenantId = null`)或最上層組織底下,渲染指定元件(掛在路由旁)。 */
const renderAt = (atRoot: boolean, element: ReactElement) => {
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      // 當前組織預設 = 清單第一個
      orgs: atRoot ? [ROOT, TENANT] : [TENANT, ROOT],
      currentOrgTenantId: (orgId) => (orgId === ROOT.id ? null : orgId),
    }).handlers,
  );
  return renderApp({
    path: "/overview",
    extra: createElement(
      RealtimeContext.Provider,
      { value: offlineRealtime },
      element,
    ),
  });
};

/** 提示本身(主訊息所在的那一段)。 */
const findNotice = async (): Promise<HTMLElement> => {
  const message = await screen.findByText(DEFAULT_MESSAGE);
  const notice = message.closest<HTMLElement>(".MuiCard-root");
  if (notice === null) {
    throw new Error("找不到提示卡片");
  }
  return notice;
};

describe("RootOrgNotice / withTenantRequired", () => {
  it("站在根組織:守門只顯示提示與當前組織切換器,不掛頁面本身", async () => {
    renderAt(true, createElement(Guarded));
    const notice = await findNotice();
    expect(screen.queryByText("受保護的內容")).toBeNull();
    // 提示裡附當前組織切換器(與 AppBar 同一個元件)
    expect(
      within(notice).getByRole("combobox", { name: "當前組織" }),
    ).toBeVisible();
  });

  it("站在最上層組織底下:照常顯示頁面", async () => {
    renderAt(false, createElement(Guarded));
    expect(await screen.findByText("受保護的內容")).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_MESSAGE)).toBeNull();
  });

  it("用提示裡的切換器切到最上層組織底下 → 頁面照常顯示", async () => {
    const { user } = renderAt(true, createElement(Guarded));
    const notice = await findNotice();
    await user.click(
      within(notice).getByRole("combobox", { name: "當前組織" }),
    );
    await user.click(await screen.findByRole("option", { name: TENANT.name }));
    expect(await screen.findByText("受保護的內容")).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_MESSAGE)).toBeNull();
  });

  it("頁內版(inline)可換主訊息與補充說明,不包卡片", async () => {
    renderAt(
      true,
      createElement(RootOrgNotice, {
        variant: "inline",
        message: "這裡只能在組織內設定",
        hint: "切換後再回來調整。",
      }),
    );
    const message = await screen.findByText("這裡只能在組織內設定");
    expect(screen.getByText("切換後再回來調整。")).toBeInTheDocument();
    expect(message.closest(".MuiCard-root")).toBeNull();
  });
});
