import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import { formFragment } from "@/test/msw/form-fixtures";
import { api, server } from "@/test/msw/server";
import { urlParam } from "@/test/url-reload";

import {
  defaultDesignOptions,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

const created = formFragment({ id: "form-trip", key: "trip", name: "出差單" });

/**
 * 假世界之上掛「建立表單」與一支可控的清單查詢:建立之後的那一次清單重查停住,
 * 等測試放行(`true` = 帶回新表單;`false` = 重抓失敗)。
 */
const renderWithGatedList = () => {
  const options = defaultDesignOptions();
  const forms = options.forms ?? [];
  let isCreated = false;
  const { promise: refetched, resolve: settleRefetch } =
    Promise.withResolvers<boolean>();
  const rendered = renderFormsPage(options);
  // 掛在 renderFormsPage 之後:後掛的 handler 優先,蓋過假世界的 Forms / CreateForm
  server.use(
    api.mutation("CreateForm", () => {
      isCreated = true;
      return HttpResponse.json({ data: { createForm: { form: created } } });
    }),
    api.query("Forms", async () => {
      if (isCreated && !(await refetched)) {
        return new HttpResponse(null, { status: 500 });
      }
      const items = isCreated ? [...forms, created] : forms;
      return HttpResponse.json({
        data: {
          forms: { items, totalCount: items.length, page: 1, pageSize: 100 },
        },
      });
    }),
  );
  return { ...rendered, settleRefetch };
};

const createTrip = async (user: ReturnType<typeof renderFormsPage>["user"]) => {
  expect(
    await screen.findByRole("heading", { name: "購物單" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "+ 建立表單" }));
  const dialog = await screen.findByRole("dialog", { name: "建立表單" });
  await user.type(within(dialog).getByLabelText(/表單 key/), "trip");
  await user.type(within(dialog).getByLabelText(/名稱/), "出差單");
  await user.click(within(dialog).getByLabelText(/所屬模組/));
  await user.click(
    await screen.findByRole("option", { name: "示範表單(頂層)" }),
  );
  await user.click(within(dialog).getByRole("button", { name: "建立" }));
  await waitFor(() => {
    expect(urlParam("detail")).toBe("trip");
  });
};

describe("表單管理:建立後選中新表單,清單還沒帶回它之前不先閃第一張", () => {
  it("建立 → 清單重查期間右欄顯示載入中、不出現第一張;清單帶回來後才顯示新表單", async () => {
    const { user, settleRefetch } = renderWithGatedList();
    await createTrip(user);

    // 清單還沒帶回新表單:右欄是載入中,不是第一張(購物單)
    expect(await screen.findByText("載入中")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "購物單" })).toBeNull();

    settleRefetch(true);

    expect(
      await screen.findByRole("heading", { name: "出差單" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "購物單" })).toBeNull();
  });

  it("建立後清單重抓失敗 → 不再等,退回第一張,右欄不會一直停在載入中", async () => {
    const { user, settleRefetch } = renderWithGatedList();
    await createTrip(user);
    expect(await screen.findByText("載入中")).toBeInTheDocument();

    settleRefetch(false);

    expect(
      await screen.findByRole("heading", { name: "購物單" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("載入中")).toBeNull();
  });
});
