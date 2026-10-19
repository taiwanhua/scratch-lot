import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  type TestOrg,
  type TestOrgNode,
  orgWorld,
} from "@/test/msw/org-manager-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 「搬走子組織後父節點仍有展開箭頭」的重現 / 迴歸測試。
 *
 * 重現時查過三層:`@repo/ui/tree`(`children: []` 與「葉節點 id 也在 expandedIds 裡」都不長箭頭)、
 * api(`moveOrg` 之後 `orgTree` 的舊父 `children` 已經是 `[]`),以及這一條 —
 * 搬移成功 → 失效 `orgTree` → 重新取回 → 舊父不再有箭頭。三層都對,整條路徑也對。
 * 這個測試把整條路徑釘住:哪一層退化(沒 invalidate、空陣列被當成可展開)都會紅。
 */
const node = (
  id: string,
  name: string,
  parentId: string | null,
  children: TestOrgNode[] = [],
): TestOrgNode => ({
  id,
  name,
  parentId,
  enabled: true,
  outOfScope: false,
  ownerUserId: null,
  children,
});

const org = (id: string, name: string, parentId: string | null): TestOrg => ({
  id,
  name,
  description: null,
  parentId,
  enabled: true,
  isSystem: parentId === null,
  ownerUserId: null,
  visibility: null,
  logoUrl: null,
});

const labelOf = (item: Element) =>
  item.querySelector(".MuiTreeItem-label")?.textContent ?? "";

const PERMISSIONS = [
  "system.org-manager.view",
  "system.org-manager.edit",
  "system.org-manager.move",
];

describe("組織樹:搬走子組織之後", () => {
  it("舊父節點不再有展開箭頭,子組織出現在新的上層底下", async () => {
    // 根 > 租戶 A > (內容組 > 小組, 台北分店)
    const team = node("org-team", "小組", "org-content");
    const content = node("org-content", "內容組", "org-tenant-a", [team]);
    const store = node("org-store", "台北分店", "org-tenant-a");
    const tenant = node("org-tenant-a", "租戶 A", "org-root", [content, store]);
    const tree: TestOrgNode[] = [node("org-root", "CookHome", null, [tenant])];

    const fake = orgWorld({
      orgTree: tree,
      orgs: [
        org("org-root", "CookHome", null),
        org("org-tenant-a", "租戶 A", "org-root"),
        org("org-content", "內容組", "org-tenant-a"),
        org("org-store", "台北分店", "org-tenant-a"),
        org("org-team", "小組", "org-content"),
      ],
    });
    server.use(
      ...fake.handlers,
      ...authWorld({
        hasRefreshCookie: true,
        modules: [
          overviewModule,
          {
            id: "m-org",
            key: "system.org-manager",
            name: "組織管理",
            parentId: null,
            sidebarType: ModuleSidebarType.Link,
            engine: ModuleEngine.Fixed,
            order: 1,
            route: "/system/org-manager",
            permissions: PERMISSIONS,
          },
        ],
      }).handlers,
    );

    const { user: actor } = renderApp({ path: "/system/org-manager" });

    const orgTree = () => screen.getByRole("tree", { name: "組織樹" });
    const itemOf = (name: string) =>
      within(orgTree())
        .getAllByRole("treeitem")
        .find((item) => labelOf(item).startsWith(name));
    const hasExpandArrow = (name: string) =>
      itemOf(name)?.querySelector(".MuiTreeItem-iconContainer svg") != null;

    await waitFor(() => {
      expect(within(orgTree()).getByText("內容組")).toBeInTheDocument();
    });
    expect(hasExpandArrow("內容組")).toBe(true);
    expect(hasExpandArrow("台北分店")).toBe(false);

    await actor.click(await within(orgTree()).findByText("小組"));
    await actor.click(
      await within(screen.getByRole("region", { name: "組織資料" })).findByRole(
        "button",
        { name: "編輯" },
      ),
    );
    await actor.click(await screen.findByLabelText("上層組織(搬移)"));
    await actor.click(
      screen.getByRole("option", { name: "租戶 A / 台北分店" }),
    );

    // 假 api 的樹跟著搬移改變(真 api 的 orgTree 會回搬移後的狀態)
    content.children = [];
    store.children = [team];
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.moveOrg).toHaveLength(1);
    });
    await waitFor(() => {
      expect(itemOf("台北分店")?.textContent).toContain("小組");
    });

    expect(hasExpandArrow("內容組")).toBe(false);
    expect(hasExpandArrow("台北分店")).toBe(true);
  });
});
