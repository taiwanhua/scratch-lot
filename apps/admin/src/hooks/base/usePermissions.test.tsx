import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { type TestModule, authWorld } from "../../test/msw/auth-handlers";
import { server } from "../../test/msw/server";
import { renderApp } from "../../test/render";
import { usePermissions } from "./usePermissions";

const modules: TestModule[] = [
  {
    id: "m-demo",
    key: "demo",
    name: "示範",
    parentId: null,
    sidebarType: ModuleSidebarType.Group,
    engine: ModuleEngine.Fixed,
    order: 1,
    route: "/demo",
    permissions: ["demo.*"],
  },
  {
    id: "m-sample-one",
    key: "demo.sub.sample-one",
    name: "示範模組1",
    parentId: "m-demo",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 1,
    route: "/demo/sub/sample-one",
    permissions: ["demo.sub.sample-one.*", "demo.sub.sample-one.view"],
  },
  {
    id: "m-org",
    key: "system.org-manager",
    name: "組織管理",
    parentId: null,
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 2,
    route: "/system/org-manager",
    permissions: ["system.org-manager.view"],
  },
];

const KEYS = [
  "system.org-manager.view", // 精確持有
  "demo.sub.sample-one.edit", // 擁有模組的 `*`
  "system.org-manager.edit", // 無(同模組但沒給、也沒 `*`)
  "demo.sub.sample-two.view", // 無(父模組的 `*` 不涵蓋子模組)
];

const PermissionProbe = () => {
  const { hasPermission, isReady } = usePermissions();
  if (!isReady) {
    return null;
  }
  return (
    <ul>
      {KEYS.map((key) => (
        <li key={key} data-testid={key}>
          {hasPermission(key) ? "yes" : "no"}
        </li>
      ))}
    </ul>
  );
};

describe("hasPermission(全域權限結構)", () => {
  it("精確持有 / 擁有模組 `*` / 無,三種結果", async () => {
    server.use(...authWorld({ hasRefreshCookie: true, modules }).handlers);

    renderApp({ path: "/", extra: <PermissionProbe /> });

    expect(
      await screen.findByTestId("system.org-manager.view"),
    ).toHaveTextContent("yes");
    expect(screen.getByTestId("demo.sub.sample-one.edit")).toHaveTextContent(
      "yes",
    );
    expect(screen.getByTestId("system.org-manager.edit")).toHaveTextContent(
      "no",
    );
    expect(screen.getByTestId("demo.sub.sample-two.view")).toHaveTextContent(
      "no",
    );
  });
});
