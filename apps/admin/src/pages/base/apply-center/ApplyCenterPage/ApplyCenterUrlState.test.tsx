import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { FormSubmissionStatus } from "@repo/graphql";

import { APPLY_CENTER_ROUTE } from "@/test/msw/workflow-fixtures";
import { currentSearch, urlJson, urlParam } from "@/test/url-reload";
import { setupFakeViewport } from "@/test/viewport";

import { renderApplyCenter } from "../apply-center-test-support";

setupFakeViewport();

beforeAll(async () => {
  await import("./ApplyCenterPage");
});

describe("申請中心:分頁與篩選存在網址(REACT-14,Figma BS-15a)", () => {
  it("分頁用 PageTabs 記在 `?tab=`、篩選在 `?list=`;重新整理後都還在", async () => {
    const first = renderApplyCenter({ path: APPLY_CENTER_ROUTE });
    await screen.findByRole("table", { name: "我的申請" });

    await first.user.click(screen.getByRole("combobox", { name: "狀態" }));
    await first.user.click(
      await screen.findByRole("option", { name: "已退回" }),
    );
    await waitFor(() => {
      expect(urlJson("list")).toEqual({
        module: null,
        form: null,
        status: FormSubmissionStatus.Returned,
        page: 1,
      });
    });
    first.unmount();

    const second = renderApplyCenter({
      path: `${APPLY_CENTER_ROUTE}${currentSearch()}`,
    });
    await screen.findByRole("table", { name: "我的申請" });
    await waitFor(() => {
      expect(second.runtime.inputs.myApplications.at(-1)?.status).toBe(
        FormSubmissionStatus.Returned,
      );
    });
    expect(screen.getByRole("combobox", { name: "狀態" })).toHaveTextContent(
      "已退回",
    );

    // 切分頁:`?tab=tasks`,共用的 `?list=` 清回預設(不把「我的申請」的狀態帶過去)
    await second.user.click(screen.getByRole("tab", { name: /^待我審核/ }));
    await screen.findByRole("table", { name: "待我審核" });
    await waitFor(() => {
      expect(urlParam("tab")).toBe("tasks");
    });
    expect(urlParam("list")).toBeNull();
    await second.user.click(screen.getByRole("combobox", { name: "處理狀態" }));
    await second.user.click(
      await screen.findByRole("option", { name: "已處理" }),
    );
    await waitFor(() => {
      expect(urlJson("list")).toEqual({
        module: null,
        form: null,
        done: "done",
        page: 1,
      });
    });
    second.unmount();

    const third = renderApplyCenter({
      path: `${APPLY_CENTER_ROUTE}${currentSearch()}`,
    });

    expect(
      await screen.findByRole("tab", { name: /^待我審核/ }),
    ).toHaveAttribute("aria-selected", "true");
    await screen.findByRole("table", { name: "待我審核" });
    await waitFor(() => {
      expect(third.runtime.inputs.myTasks.at(-1)?.done).toBe(true);
    });
  });

  it("頁碼在 `?list=`:帶頁碼打開(重新整理)照那一頁查", async () => {
    const list = encodeURIComponent('{"page":2}');
    const { runtime } = renderApplyCenter({
      path: `${APPLY_CENTER_ROUTE}?tab=mine&list=${list}`,
    });

    await waitFor(() => {
      expect(runtime.inputs.myApplications.at(-1)?.page).toBe(2);
    });
  });
});
