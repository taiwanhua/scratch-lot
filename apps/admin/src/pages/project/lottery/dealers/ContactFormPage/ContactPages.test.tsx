import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { contactFixtures } from "@/test/msw/project/dealers-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import { DEALERS_TEST_ROUTES, renderDealers } from "../dealers-test-support";

setupFakeViewport();

const VIEW_CHEN = `${DEALERS_TEST_ROUTES.contactViewPage}/contact-1`;
const EDIT_CHEN = `${DEALERS_TEST_ROUTES.contactEditPage}/contact-1`;

/** 關係人詳情 / 編輯頁(Figma DE-08)。 */
describe("關係人詳情 / 編輯頁", () => {
  it("詳情:身分標籤、關聯的經銷商;有 dealers.contacts.edit 才有 [編輯]", async () => {
    renderDealers({ path: VIEW_CHEN });

    expect(
      await screen.findByRole("heading", { name: "陳小芳" }),
    ).toBeInTheDocument();
    const linked = screen.getByRole("table", { name: "關聯的經銷商" });
    expect(await within(linked).findAllByText("陳志明 #12345678")).toHaveLength(
      2,
    );
    expect(screen.getByRole("button", { name: "編輯" })).toBeInTheDocument();
  });

  it("沒有 dealers.contacts.edit(abilities.canEdit = false):看不到 [編輯]", async () => {
    renderDealers({
      path: VIEW_CHEN,
      contactPermissions: [],
      world: {
        contacts: contactFixtures.map((contact) => ({
          ...contact,
          abilities: { ...contact.abilities, canEdit: false },
        })),
      },
    });
    await screen.findByRole("heading", { name: "陳小芳" });
    expect(
      screen.queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
  });

  it("取消的身分還有關聯:跳確認框列出關聯,確認後一併解除並儲存", async () => {
    const { user, fake } = renderDealers({ path: EDIT_CHEN });
    const trustee = await screen.findByRole("checkbox", { name: "受託人" });

    await user.click(trustee);
    await user.click(screen.getByRole("button", { name: "儲存" }));

    const dialog = await screen.findByRole("dialog", { name: "取消身分" });
    expect(within(dialog).getByText("陳志明 #12345678")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "一併解除並儲存" }),
    );
    await waitFor(() => {
      expect(fake.inputs.updateLotteryDealerContact.at(-1)).toEqual({
        id: "contact-1",
        roles: ["AGENT"],
        releaseRelationships: true,
      });
    });
  });
});
