import { describe, expect, it } from "@jest/globals";

import {
  bookKeyOf,
  displayBookKey,
  displayBookNo,
  displayTicketKey,
  formatTicketRanges,
  normalizeBookNo,
  parseTicketInput,
  ticketKeyOf,
} from "./ticket-code";

describe("parseTicketInput(規格 6.3 四種輸入格式)", () => {
  it.each([
    [
      "背面編號",
      "5164-1-056527-099-0-6",
      {
        format: "back",
        gameCode: "5164",
        printVersion: "1",
        bookNo: "0056527",
        ticketNo: "099",
      },
    ],
    [
      "正面編號(有連字號)",
      "056527-099",
      { format: "front", bookNo: "0056527", ticketNo: "099" },
    ],
    [
      "正面編號(沒有連字號)",
      "056527099",
      { format: "front", bookNo: "0056527", ticketNo: "099" },
    ],
    [
      "正面條碼",
      "0056527099",
      { format: "barcode", bookNo: "0056527", ticketNo: "099" },
    ],
    [
      "背面編號第 5、6 段不驗證",
      "5164-1-056527-012-X-99",
      {
        format: "back",
        gameCode: "5164",
        printVersion: "1",
        bookNo: "0056527",
        ticketNo: "012",
      },
    ],
    [
      "前後空白忽略",
      "  0056527099\n",
      { format: "barcode", bookNo: "0056527", ticketNo: "099" },
    ],
  ])("%s:%s", (_label, raw, expected) => {
    expect(parseTicketInput(raw)).toEqual(expected);
  });

  it.each([
    ["空字串", ""],
    ["位數不對", "05652709"],
    ["夾雜文字", "05652A-099"],
    ["背面編號少一段", "5164-1-056527-099-0"],
    ["遊戲代號不是 4 位", "516-1-056527-099-0-6"],
    ["張號 000 不存在", "0056527000"],
  ])("錯誤格式 → null:%s", (_label, raw) => {
    expect(parseTicketInput(raw)).toBeNull();
  });
});

describe("本號與編號(規格 7.1)", () => {
  it("6 位本號補 0 成 7 位;7 位照存;其他 → null", () => {
    expect(normalizeBookNo("056527")).toBe("0056527");
    expect(normalizeBookNo("1056527")).toBe("1056527");
    expect(normalizeBookNo("56527")).toBeNull();
    expect(normalizeBookNo("05652a")).toBeNull();
  });

  it("開頭 0 時顯示 6 位", () => {
    expect(displayBookNo("0056527")).toBe("056527");
    expect(displayBookNo("1056527")).toBe("1056527");
  });

  it("本編號存 7 位、顯示 6 位;張編號接張號", () => {
    expect(bookKeyOf("5164", "0056527")).toBe("5164-0056527");
    expect(displayBookKey("5164", "0056527")).toBe("5164-056527");
    expect(ticketKeyOf("5164", "0056527", "001")).toBe("5164-0056527-001");
    expect(displayTicketKey("5164", "0056527", "012")).toBe("5164-056527-012");
  });
});

describe("formatTicketRanges(規格 7.5 區段顯示)", () => {
  it("不連號以區段顯示", () => {
    expect(formatTicketRanges(["020", "012", "013", "014", "015", "016"])).toBe(
      "#012–016、#020",
    );
  });

  it("單張、重複、空清單", () => {
    expect(formatTicketRanges(["037", "064"])).toBe("#037、#064");
    expect(formatTicketRanges(["005", "005", "006"])).toBe("#005–006");
    expect(formatTicketRanges([])).toBe("");
  });
});
