import { describe, expect, it } from "@jest/globals";

import { defaultBrand } from "./brands/default";
import { createAppTheme } from "./create-theme";
import { tableHeaderSx } from "./table-header";

const theme = createAppTheme(defaultBrand);

describe("tableHeaderSx(表頭格外觀的正本)", () => {
  it("主題 MuiTableCell head 覆寫就是 tableHeaderSx(Table / DataTable 與時間軸表頭同一份)", () => {
    const head = theme.components?.MuiTableCell?.styleOverrides?.head;
    const resolved =
      typeof head === "function" ? head({ theme, ownerState: {} }) : head;

    expect(resolved).toEqual(tableHeaderSx(theme));
    expect(tableHeaderSx(theme)).toMatchObject({
      color: expect.stringContaining("text-secondary"),
      backgroundColor: expect.stringContaining("background-default"),
      fontWeight: 600,
    });
  });
});
