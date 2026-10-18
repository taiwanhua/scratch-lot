import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { projectPublic } from "@repo/project-config/public";

import {
  formSectionPageId,
  isSectionCollapsed,
  pruneSectionPage,
  readSectionStore,
  sectionsStorageKey,
  setSectionCollapsed,
  writeSectionStore,
} from "./section-collapse";

const KEY = sectionsStorageKey("user-1");

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe("可收合區塊的收合記憶:儲存規則", () => {
  it("key 是 `<slug>-admin-sections:<userId>`;表單的頁面 id 是 `form:<formKey>`", () => {
    expect(KEY).toBe(`${projectPublic.slug}-admin-sections:user-1`);
    expect(formSectionPageId("purchase")).toBe("form:purchase");
  });

  it("只記與預設不同的:和預設相同的切換不寫入", () => {
    const same = setSectionCollapsed(
      {},
      "vendors.detail",
      "contact",
      true,
      true,
    );
    expect(same).toEqual({});

    const different = setSectionCollapsed(
      {},
      "vendors.detail",
      "contact",
      false,
      true,
    );
    expect(different).toEqual({ "vendors.detail": { contact: false } });
  });

  it("改回預設就刪那一筆;同頁還有別筆時頁面保留", () => {
    const store = {
      "vendors.detail": { attachments: false, billing: false },
    };
    expect(
      setSectionCollapsed(store, "vendors.detail", "attachments", true, true),
    ).toEqual({ "vendors.detail": { billing: false } });
  });

  it("頁面空了刪頁面;整把 key 空了連 key 一起刪", () => {
    const store = {
      "vendors.detail": { attachments: false },
      "form:purchase": { notes: true },
    };
    const next = setSectionCollapsed(
      store,
      "vendors.detail",
      "attachments",
      true,
      true,
    );
    expect(next).toEqual({ "form:purchase": { notes: true } });

    writeSectionStore(KEY, next);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual({
      "form:purchase": { notes: true },
    });
    writeSectionStore(
      KEY,
      setSectionCollapsed(next, "form:purchase", "notes", false, false),
    );
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("清除不存在的 key:只動那一頁,空了刪頁;沒有變動時回原物件", () => {
    const store = {
      "form:purchase": { notes: true, removed: false },
      "form:leave": { reason: true },
    };
    expect(
      pruneSectionPage(store, "form:purchase", ["notes", "items"]),
    ).toEqual({
      "form:purchase": { notes: true },
      "form:leave": { reason: true },
    });
    expect(pruneSectionPage(store, "form:purchase", ["items"])).toEqual({
      "form:leave": { reason: true },
    });
    expect(pruneSectionPage(store, "form:leave", ["reason"])).toBe(store);
    expect(pruneSectionPage(store, "form:none", [])).toBe(store);
  });

  it("讀不到用預設:沒有值、格式壞、localStorage 擲錯都當空", () => {
    expect(readSectionStore(KEY)).toEqual({});
    expect(isSectionCollapsed(undefined, "contact", true)).toBe(true);

    localStorage.setItem(KEY, "{壞掉的 JSON");
    expect(readSectionStore(KEY)).toEqual({});

    // 形狀不對的頁面與值丟掉,其餘保留
    localStorage.setItem(
      KEY,
      JSON.stringify({ a: { x: true, y: "no" }, b: [1], c: { z: 1 } }),
    );
    expect(readSectionStore(KEY)).toEqual({ a: { x: true } });

    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(readSectionStore(KEY)).toEqual({});
    expect(() => {
      writeSectionStore(KEY, { a: { x: true } });
    }).not.toThrow();
  });
});
