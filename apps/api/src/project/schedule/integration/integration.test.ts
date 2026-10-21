import { afterEach, describe, expect, it } from "@jest/globals";

import {
  blockedEntryIdsOf,
  clearEntryDeletionGuardsForTest,
  registerEntryDeletionGuard,
} from "./entry-deletion-guards";
import {
  clearPositionAnnotationProvidersForTest,
  positionAnnotationsOf,
  registerPositionAnnotationProvider,
} from "./position-annotations";

describe("給刮刮樂的登記接縫(規格 14.9)", () => {
  afterEach(() => {
    clearPositionAnnotationProvidersForTest();
    clearEntryDeletionGuardsForTest();
  });

  it("沒有登記:崗位沒有註記、排班都能刪", async () => {
    expect(await positionAnnotationsOf("t", "o")).toEqual({});
    expect(await blockedEntryIdsOf("t", ["e1"])).toEqual(new Set());
  });

  it("崗位註記:依登記順序合併,收到租戶與分店", async () => {
    const calls: string[] = [];
    registerPositionAnnotationProvider((tenantId, orgId) => {
      calls.push(`${tenantId}/${orgId}`);
      return Promise.resolve({ "in-store-counter": "櫃台 A", restock: "x" });
    });
    registerPositionAnnotationProvider(() =>
      Promise.resolve({ restock: "補貨區" }),
    );
    expect(await positionAnnotationsOf("tenant", "branch")).toEqual({
      "in-store-counter": "櫃台 A",
      restock: "補貨區",
    });
    expect(calls).toEqual(["tenant/branch"]);
  });

  it("刪除擋板:各登記的聯集;沒有要問的排班就不呼叫", async () => {
    let calls = 0;
    registerEntryDeletionGuard((_tenantId, entryIds) => {
      calls += 1;
      return Promise.resolve(new Set(entryIds.filter((id) => id === "e1")));
    });
    registerEntryDeletionGuard(() => Promise.resolve(new Set(["e3"])));
    expect(await blockedEntryIdsOf("t", ["e1", "e2", "e3"])).toEqual(
      new Set(["e1", "e3"]),
    );
    expect(await blockedEntryIdsOf("t", [])).toEqual(new Set());
    expect(calls).toBe(1);
  });
});
