import { HttpResponse, http } from "msw";

import type {
  CreateDemoItemOneMutationVariables,
  CreateUploadUrlMutationVariables,
  DeleteDemoItemOneMutationVariables,
  DemoItemOneHistoryQuery,
  DemoItemOneQueryVariables,
  DemoItemsOneQuery,
  DemoItemsOneQueryVariables,
  SetDemoItemOneEnabledMutationVariables,
  UpdateDemoItemOneMutationVariables,
} from "@repo/graphql";
import { DemoItemOneStatus } from "@repo/graphql";

import { type GraphqlErrorCode, graphqlError } from "./auth-handlers";
import { api } from "./server";

export type TestDemoItem = DemoItemsOneQuery["demoItemsOne"]["items"][number];
export type TestDemoHistoryEntry =
  DemoItemOneHistoryQuery["demoItemOneHistory"]["items"][number];

/** 簽名上傳網址的假位址(與 `org-manager-handlers` 各一份,兩個 world 不會同時上場)。 */
export const TEST_DEMO_UPLOAD_ORIGIN = "https://demo-storage.test";
/** 附件現簽回來的短效網址。 */
export const TEST_DEMO_DOWNLOAD_URL = "https://demo-storage.test/signed/read";

export type DemoOperation =
  | "CreateDemoItemOne"
  | "UpdateDemoItemOne"
  | "DeleteDemoItemOne"
  | "SetDemoItemOneEnabled"
  | "CreateUploadUrl";

export interface DemoFailure {
  code: GraphqlErrorCode;
  /** 附加在 `extensions` 上的欄位(`reason` / `fields`) */
  extensions?: Record<string, unknown>;
}

export interface DemoWorldOptions {
  items?: TestDemoItem[];
  history?: TestDemoHistoryEntry[];
  /**
   * 操作者有沒有 `show-internal-note`。**false 時 api 不把 `internalNote` 放進回傳物件**
   * (序列化成 null)—— 假伺服器照做,前端才不會寫出「拿值去猜權限」的測試。
   */
  canShowInternalNote?: boolean;
  /** 指定某個寫入操作失敗(值是 `errors[0].extensions.code` 與要附加的 extensions) */
  failures?: Partial<Record<DemoOperation, DemoFailure>>;
}

export interface DemoWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  inputs: {
    /** 清單查詢的條件(驗篩選、頁碼有照網址送出) */
    demoItemsOne: DemoItemsOneQueryVariables["input"][];
    createDemoItemOne: CreateDemoItemOneMutationVariables["input"][];
    updateDemoItemOne: UpdateDemoItemOneMutationVariables["input"][];
    deleteDemoItemOne: DeleteDemoItemOneMutationVariables["input"][];
    setDemoItemOneEnabled: SetDemoItemOneEnabledMutationVariables["input"][];
    createUploadUrl: CreateUploadUrlMutationVariables["input"][];
  };
  /** 各查詢被打到的次數(驗 invalidate、驗「點了才現簽」) */
  calls: {
    demoItemsOne: number;
    demoItemOne: number;
    history: number;
    demoItemOneAttachmentUrl: number;
  };
  /** 直傳到簽名網址的檔案(ADR-0010 第 2 步) */
  uploadedFiles: { url: string; contentType: string | null; size: number }[];
}

/**
 * 看不到的資料一律 `NOT_FOUND`,不透露它存在(`GraphqlErrorCode` 沒有這一碼,所以轉型;
 * `graphqlError` 的第一個參數才是 `extensions.code`,第二個只是給開發者看的 message)。
 */
const notFound = () => graphqlError("NOT_FOUND", "NOT_FOUND");

/** input 裡出現 `internalNote`(含送 null 清空)而那一筆不能改 → 欄位級權限拒絕。 */
const fieldForbidden = (
  hasInternalNote: boolean,
  canEditInternalNote: boolean,
) =>
  hasInternalNote && !canEditInternalNote
    ? graphqlError("FORBIDDEN", "FORBIDDEN", { reason: "FIELD_FORBIDDEN" })
    : null;

/**
 * 示範模組1 的假 api(四個 query + 四個 mutation;規則正本
 * `docs/modules/demo.sub.sample-one.md`「api 介面」)。
 *
 * 有狀態:新增 / 編輯 / 刪除寫回同一份清單,所以「mutation → invalidate → 重新查」
 * 在測試裡看得到新值(TEST-08)。跟著 api 的三條規則走,不要比 api 寬鬆:
 *
 * - `keyword` 只比對 `name` / `note`,**不比對 `internalNote`**
 * - 沒有 `show-internal-note` 時 `internalNote` 一律回 null(欄位投影)
 * - `internalNote` 出現在 create / update 的 input 裡(**含 null**)而操作者不能改 →
 *   `FORBIDDEN` + `extensions.reason = "FIELD_FORBIDDEN"`;能不能改看那一筆的
 *   `abilities.canEditInternalNote`(新增時看第一筆夾具的值,夾具沒有就當可以)
 */
export const demoWorld = (options: DemoWorldOptions = {}): DemoWorld => {
  const {
    items = [],
    history = [],
    canShowInternalNote = true,
    failures = {},
  } = options;

  const state: TestDemoItem[] = structuredClone(items);
  const inputs: DemoWorld["inputs"] = {
    demoItemsOne: [],
    createDemoItemOne: [],
    updateDemoItemOne: [],
    deleteDemoItemOne: [],
    setDemoItemOneEnabled: [],
    createUploadUrl: [],
  };
  const calls = {
    demoItemsOne: 0,
    demoItemOne: 0,
    history: 0,
    demoItemOneAttachmentUrl: 0,
  };
  const uploadedFiles: DemoWorld["uploadedFiles"] = [];
  let created = 0;

  const fail = (operation: DemoOperation) => {
    const failure = failures[operation];
    return failure === undefined
      ? null
      : graphqlError(failure.code, failure.code, failure.extensions ?? {});
  };

  /** 欄位投影:沒有 `show-internal-note` 就不把這個欄位放進回傳物件。 */
  const project = (item: TestDemoItem): TestDemoItem =>
    canShowInternalNote ? item : { ...item, internalNote: null };

  const findItem = (id: string) => state.find((item) => item.id === id);

  const handlers = [
    api.query("DemoItemsOne", ({ variables }) => {
      const { input } = variables as DemoItemsOneQueryVariables;
      calls.demoItemsOne += 1;
      inputs.demoItemsOne.push(input);
      const keyword = input.keyword?.trim().toLowerCase() ?? "";
      const matched = state.filter((item) => {
        if (input.category != null && item.category !== input.category) {
          return false;
        }
        if (input.enabled != null && item.enabled !== input.enabled) {
          return false;
        }
        if (keyword === "") {
          return true;
        }
        const haystack = `${item.name} ${item.note ?? ""}`.toLowerCase();
        return haystack.includes(keyword);
      });
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      return HttpResponse.json({
        data: {
          demoItemsOne: {
            items: matched
              .slice(start, start + pageSize)
              .map((item) => project(item)),
            totalCount: matched.length,
            page,
            pageSize,
          },
        },
      });
    }),
    api.query("DemoItemOne", ({ variables }) => {
      const { id } = variables as DemoItemOneQueryVariables;
      calls.demoItemOne += 1;
      const item = findItem(id);
      // 看不到的資料一律 NOT_FOUND,不透露它存在
      return item === undefined
        ? notFound()
        : HttpResponse.json({ data: { demoItemOne: { item: project(item) } } });
    }),
    api.query("DemoItemOneHistory", () => {
      calls.history += 1;
      return HttpResponse.json({
        data: {
          demoItemOneHistory: { items: history, totalCount: history.length },
        },
      });
    }),
    api.query("DemoItemOneAttachmentUrl", () => {
      calls.demoItemOneAttachmentUrl += 1;
      return HttpResponse.json({
        data: { demoItemOneAttachmentUrl: { url: TEST_DEMO_DOWNLOAD_URL } },
      });
    }),
    api.mutation("CreateDemoItemOne", ({ variables }) => {
      const { input } = variables as CreateDemoItemOneMutationVariables;
      inputs.createDemoItemOne.push(input);
      const denied = fieldForbidden(
        "internalNote" in input,
        state[0]?.abilities.canEditInternalNote ?? true,
      );
      const failure = fail("CreateDemoItemOne") ?? denied;
      if (failure !== null) {
        return failure;
      }
      created += 1;
      const item: TestDemoItem = {
        id: `demo-new-${String(created)}`,
        name: input.name,
        category: input.category ?? null,
        categoryLabel: input.category ?? null,
        note: input.note ?? null,
        internalNote: input.internalNote ?? null,
        coverPath: input.coverPath ?? null,
        coverUrl: null,
        // 附件原樣存原始檔名 / 大小 / 檔型,與 api 同
        attachment: input.attachment ?? null,
        status: input.status ?? DemoItemOneStatus.Draft,
        enabled: true,
        createdBy: null,
        createdAt: "2026-09-22T00:00:00.000Z",
        updatedAt: "2026-09-22T00:00:00.000Z",
        abilities: {
          canEdit: true,
          canDelete: true,
          canEditInternalNote: state[0]?.abilities.canEditInternalNote ?? true,
        },
      };
      state.push(item);
      return HttpResponse.json({
        data: { createDemoItemOne: { item: project(item) } },
      });
    }),
    api.mutation("UpdateDemoItemOne", ({ variables }) => {
      const { input } = variables as UpdateDemoItemOneMutationVariables;
      inputs.updateDemoItemOne.push(input);
      const target = findItem(input.id);
      if (target === undefined) {
        return notFound();
      }
      const denied = fieldForbidden(
        "internalNote" in input,
        target.abilities.canEditInternalNote,
      );
      const failure = fail("UpdateDemoItemOne") ?? denied;
      if (failure !== null) {
        return failure;
      }
      // 缺席 = 不動、null = 清空(GQL-06);name / status 送 null 視同缺席
      target.name = input.name ?? target.name;
      target.status = input.status ?? target.status;
      if ("category" in input) {
        target.category = input.category ?? null;
        target.categoryLabel = input.category ?? null;
      }
      if ("note" in input) {
        target.note = input.note ?? null;
      }
      if ("internalNote" in input) {
        target.internalNote = input.internalNote ?? null;
      }
      if ("coverPath" in input) {
        target.coverPath = input.coverPath ?? null;
      }
      if ("attachment" in input) {
        target.attachment = input.attachment ?? null;
      }
      return HttpResponse.json({
        data: { updateDemoItemOne: { item: project(target) } },
      });
    }),
    api.mutation("DeleteDemoItemOne", ({ variables }) => {
      const { input } = variables as DeleteDemoItemOneMutationVariables;
      inputs.deleteDemoItemOne.push(input);
      const failure = fail("DeleteDemoItemOne");
      if (failure !== null) {
        return failure;
      }
      const index = state.findIndex((item) => item.id === input.id);
      if (index !== -1) {
        state.splice(index, 1);
      }
      return HttpResponse.json({
        data: { deleteDemoItemOne: { success: true, deletedId: input.id } },
      });
    }),
    api.mutation("SetDemoItemOneEnabled", ({ variables }) => {
      const { input } = variables as SetDemoItemOneEnabledMutationVariables;
      inputs.setDemoItemOneEnabled.push(input);
      const failure = fail("SetDemoItemOneEnabled");
      if (failure !== null) {
        return failure;
      }
      const target = findItem(input.id);
      if (target === undefined) {
        return notFound();
      }
      // 有狀態:寫回同一份清單,列表 invalidate 後才看得到新狀態(TEST-08)
      target.enabled = input.enabled;
      return HttpResponse.json({
        data: { setDemoItemOneEnabled: { item: project(target) } },
      });
    }),
    api.mutation("CreateUploadUrl", ({ variables }) => {
      const { input } = variables as CreateUploadUrlMutationVariables;
      inputs.createUploadUrl.push(input);
      const serial = String(inputs.createUploadUrl.length);
      return (
        fail("CreateUploadUrl") ??
        HttpResponse.json({
          data: {
            createUploadUrl: {
              uploadUrl: `${TEST_DEMO_UPLOAD_ORIGIN}/signed/${serial}`,
              objectPath: `demo/${serial}.png`,
              expiresAt: "2026-09-22T00:10:00.000Z",
            },
          },
        })
      );
    }),
    http.put(`${TEST_DEMO_UPLOAD_ORIGIN}/signed/*`, async ({ request }) => {
      const body = await request.arrayBuffer();
      uploadedFiles.push({
        url: request.url,
        contentType: request.headers.get("content-type"),
        size: body.byteLength,
      });
      return new HttpResponse(null, { status: 200 });
    }),
  ];

  return {
    handlers: handlers as DemoWorld["handlers"],
    inputs,
    calls,
    uploadedFiles,
  };
};
