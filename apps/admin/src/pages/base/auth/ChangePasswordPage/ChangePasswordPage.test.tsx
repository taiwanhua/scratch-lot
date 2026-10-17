import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { useModuleTreeQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { authWorld, graphqlError } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

const fillAndSubmit = async (
  user: ReturnType<typeof renderApp>["user"],
  currentPassword: string,
  newPassword = "new-secret-1",
) => {
  await user.type(screen.getByLabelText("目前密碼"), currentPassword);
  await user.type(screen.getByLabelText("新密碼"), newPassword);
  await user.type(screen.getByLabelText("確認新密碼"), newPassword);
  await user.click(screen.getByRole("button", { name: "確定" }));
};

/** 代表「其他受保護操作」的探針:一掛上就打 ModuleTree(底座既有的受保護查詢) */
const ProtectedProbe = () => {
  const { session } = useSession();
  useModuleTreeQuery(session.client);
  return null;
};

describe("改密碼頁(/change-password;首登強改)", () => {
  it("首登須改密碼者進入後台被導向改密碼頁;改完後 me 重取、回到原本要去的頁", async () => {
    const world = authWorld({
      hasRefreshCookie: true,
      mustChangePassword: true,
    });
    server.use(...world.handlers);
    const { user } = renderApp({ path: "/overview?tab=sample" });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/change-password?next=%2Foverview%3Ftab%3Dsample",
      );
    });
    expect(screen.getByText(/首次登入請先變更密碼/)).toBeInTheDocument();

    await fillAndSubmit(user, "secret-1234");

    expect(await screen.findByText("小華,你好")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/overview?tab=sample",
    );
    expect(world.calls.changePassword).toBe(1);
  });

  it("目前密碼錯誤顯示對應文案,停留在改密碼頁", async () => {
    const world = authWorld({ hasRefreshCookie: true });
    server.use(...world.handlers);
    const { user } = renderApp({ path: "/change-password" });

    expect(await screen.findByLabelText("目前密碼")).toBeInTheDocument();
    await fillAndSubmit(user, "wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent("目前密碼錯誤");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/change-password",
    );
  });

  it("受保護操作回 MUST_CHANGE_PASSWORD(me 尚未反映)→ client 攔截並導向改密碼頁", async () => {
    const world = authWorld({ hasRefreshCookie: true });
    server.use(
      api.query("ModuleTree", () => graphqlError("MUST_CHANGE_PASSWORD")),
      ...world.handlers,
    );
    renderApp({ path: "/", extra: <ProtectedProbe /> });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/change-password?next=%2F",
      );
    });
  });

  it("未登入者進改密碼頁被導回登入頁", async () => {
    server.use(...authWorld({ hasRefreshCookie: false }).handlers);
    renderApp({ path: "/change-password" });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/login?next=%2Fchange-password",
      );
    });
  });
});
