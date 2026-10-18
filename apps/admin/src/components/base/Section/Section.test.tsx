import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { sectionsStorageKey } from "@/lib/base/section-collapse";
import { authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { Section } from "./Section";

const stored = (userId = "user-1"): unknown =>
  JSON.parse(localStorage.getItem(sectionsStorageKey(userId)) ?? "null");

const seed = (value: unknown, userId = "user-1") => {
  localStorage.setItem(sectionsStorageKey(userId), JSON.stringify(value));
};

/** 等殼載完登入者(`me`):收合記憶依 `me.id` 分把,載到之前一律用預設值。 */
const renderPage = async (extra: ReactNode, userId?: string) => {
  const world = authWorld({
    hasRefreshCookie: true,
    ...(userId !== undefined && { userId }),
  });
  server.use(...world.handlers);
  const view = renderApp({ path: "/overview", extra });
  // 殼的使用者選單出現 = me 已載到(hook 已改讀這位使用者的紀錄)
  await screen.findByRole("button", { name: "小華" });
  return view;
};

const header = (name: string) => screen.getByRole("button", { name });

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe("Section(一般頁面):收合狀態依頁面 id + 區塊 key 記在 localStorage", () => {
  it("第一次進頁:依 defaultCollapsed", async () => {
    await renderPage(
      <>
        <Section pageId="vendors.detail" sectionKey="contact" title="聯絡方式">
          內容一
        </Section>
        <Section
          pageId="vendors.detail"
          sectionKey="attachments"
          title="附件"
          defaultCollapsed
        >
          內容二
        </Section>
      </>,
    );

    expect(header("聯絡方式")).toHaveAttribute("aria-expanded", "true");
    expect(header("附件")).toHaveAttribute("aria-expanded", "false");
    expect(stored()).toBeNull();
  });

  it("手動改成和預設不同:寫入 `<頁面 id>.<區塊 key>`", async () => {
    const { user } = await renderPage(
      <Section pageId="vendors.detail" sectionKey="contact" title="聯絡方式">
        內容
      </Section>,
    );

    await user.click(header("聯絡方式"));

    expect(header("聯絡方式")).toHaveAttribute("aria-expanded", "false");
    expect(stored()).toEqual({ "vendors.detail": { contact: true } });
  });

  it("手動改回預設:刪除那一筆;頁面底下沒資料就刪掉頁面", async () => {
    seed({
      "vendors.detail": { contact: true },
      "vendors.create": { contact: true },
    });
    const { user } = await renderPage(
      <Section pageId="vendors.detail" sectionKey="contact" title="聯絡方式">
        內容
      </Section>,
    );
    await waitFor(() => {
      expect(header("聯絡方式")).toHaveAttribute("aria-expanded", "false");
    });

    await user.click(header("聯絡方式"));

    expect(header("聯絡方式")).toHaveAttribute("aria-expanded", "true");
    expect(stored()).toEqual({ "vendors.create": { contact: true } });
  });

  it("同一模組的新增頁 / 詳情頁:各記各的,互不影響", async () => {
    seed({ "vendors.create": { contact: true } });
    await renderPage(
      <>
        <Section pageId="vendors.create" sectionKey="contact" title="聯絡方式">
          新增頁
        </Section>
        <Section pageId="vendors.detail" sectionKey="attachments" title="附件">
          詳情頁
        </Section>
      </>,
    );

    await waitFor(() => {
      expect(header("聯絡方式")).toHaveAttribute("aria-expanded", "false");
    });
    expect(header("附件")).toHaveAttribute("aria-expanded", "true");
  });

  it("換使用者登入:讀另一個使用者的 key", async () => {
    seed({ "vendors.detail": { contact: true } }, "user-1");
    seed({ "vendors.detail": { attachments: true } }, "user-2");
    await renderPage(
      <>
        <Section pageId="vendors.detail" sectionKey="contact" title="聯絡方式">
          一
        </Section>
        <Section pageId="vendors.detail" sectionKey="attachments" title="附件">
          二
        </Section>
      </>,
      "user-2",
    );

    await waitFor(() => {
      expect(header("附件")).toHaveAttribute("aria-expanded", "false");
    });
    expect(header("聯絡方式")).toHaveAttribute("aria-expanded", "true");
  });

  it("localStorage 不可用:一律用預設,畫面照常收合 / 展開", async () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { user } = await renderPage(
      <Section
        pageId="vendors.detail"
        sectionKey="contact"
        title="聯絡方式"
        defaultCollapsed
      >
        內容
      </Section>,
    );

    expect(header("聯絡方式")).toHaveAttribute("aria-expanded", "false");
    await user.click(header("聯絡方式"));
    expect(header("聯絡方式")).toHaveAttribute("aria-expanded", "true");
  });
});
