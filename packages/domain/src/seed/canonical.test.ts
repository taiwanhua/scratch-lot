import { createHash } from "node:crypto";

import { describe, expect, it } from "@jest/globals";

import { field } from "../form/form-test-support";
import type { FieldDef } from "../form/types";
import { review } from "../workflow/workflow-test-support";
import {
  SEED_HASH_PATTERN,
  SeedSerializationError,
  canonicalJson,
  definitionContentCanonical,
  hashDefinitionSeed,
} from "./canonical";
import type { DefinitionSeedSet } from "./declaration";
import { formSeed, userReference, workflowSeed } from "./seed-test-support";

/** 上層(Node)注入的雜湊函式:本套件自己不碰 crypto。 */
const sha256Hex = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

const hashesOf = (seed: DefinitionSeedSet) =>
  hashDefinitionSeed(seed, sha256Hex);

describe("canonicalJson", () => {
  it("物件鍵排序、陣列順序保留、undefined 的鍵視同缺席", () => {
    expect(canonicalJson({ b: 1, a: [3, 1, 2], c: undefined })).toBe(
      '{"a":[3,1,2],"b":1}',
    );
    expect(canonicalJson({ a: [3, 1, 2], b: 1 })).toBe(
      canonicalJson({ b: 1, a: [3, 1, 2] }),
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("null 與缺席不同、空字串與 null 不同(沒有契約說它們等價就保留差異)", () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
    expect(canonicalJson({ a: "" })).not.toBe(canonicalJson({ a: null }));
  });

  it("不是純 JSON 的值報出位置", () => {
    expect(() => canonicalJson({ a: [1, { b: new Date(0) }] })).toThrow(
      SeedSerializationError,
    );
    expect(() => canonicalJson({ a: [1, { b: Number.NaN }] })).toThrow("a.1.b");
    expect(() => canonicalJson([undefined])).toThrow("0");
  });
});

const fields = (): FieldDef[] => [
  field("title", "text"),
  userReference("applicant"),
];

describe("contentHash / snapshotHash", () => {
  it("格式固定為 sha256:<hex>;雜湊函式回傳的不是 SHA-256 十六進位就拒絕", () => {
    const { contentHash, snapshotHash } = hashesOf(formSeed(fields()));
    expect(contentHash).toMatch(SEED_HASH_PATTERN);
    expect(snapshotHash).toMatch(SEED_HASH_PATTERN);
    expect(() => hashDefinitionSeed(formSeed(fields()), () => "abc")).toThrow(
      TypeError,
    );
  });

  it("revision / changelog / desiredStatus 只影響 snapshotHash;contentHash 不變", () => {
    const base = hashesOf(formSeed(fields()));
    for (const overrides of [
      { revision: "r2" },
      { changelog: "修正說明" },
      { desiredStatus: "retired" as const },
    ]) {
      const changed = hashesOf(formSeed(fields(), overrides));
      expect(changed.contentHash).toBe(base.contentHash);
      expect(changed.snapshotHash).not.toBe(base.snapshotHash);
    }
  });

  it("kind / key、受管 metadata 與 definition 任何一項變了,兩個 hash 都變", () => {
    const base = hashesOf(formSeed(fields()));
    const variants: DefinitionSeedSet[] = [
      formSeed(fields(), { key: "leave_request_2" }),
      formSeed(fields(), { name: "請假單(新)" }),
      formSeed(fields(), { moduleKey: "demo.form" }),
      formSeed(fields(), { tabLabelTemplate: "{{title}}" }),
      formSeed([...fields(), field("note", "text")]),
      // 欄位順序是有語意的陣列順序
      formSeed(fields().toReversed()),
    ];
    for (const variant of variants) {
      const changed = hashesOf(variant);
      expect(changed.contentHash).not.toBe(base.contentHash);
      expect(changed.snapshotHash).not.toBe(base.snapshotHash);
    }
    expect(hashesOf(workflowSeed()).contentHash).not.toBe(
      hashesOf(workflowSeed(undefined, { checkFormKey: "leave_request" }))
        .contentHash,
    );
  });

  it("允許存草稿:缺席與 true 同一份內容(既有宣告的 hash 不變);false 兩個 hash 都變", () => {
    const base = hashesOf(formSeed(fields()));
    expect(hashesOf(formSeed(fields(), { allowDraft: true }))).toEqual(base);
    const off = hashesOf(formSeed(fields(), { allowDraft: false }));
    expect(off.contentHash).not.toBe(base.contentHash);
    expect(off.snapshotHash).not.toBe(base.snapshotHash);
  });

  it("單號格式:缺席與這個欄位之前同一份內容;有宣告兩個 hash 都變", () => {
    const base = hashesOf(formSeed(fields()));
    const withSerial = hashesOf(
      formSeed(fields(), {
        serial: { prefix: "PU", period: "month", digits: 4 },
      }),
    );
    expect(withSerial.contentHash).not.toBe(base.contentHash);
    expect(withSerial.snapshotHash).not.toBe(base.snapshotHash);
  });

  it("作廢原因類別:缺席與這個欄位之前同一份內容;有宣告兩個 hash 都變", () => {
    const base = hashesOf(formSeed(fields()));
    const withCategory = hashesOf(
      formSeed(fields(), { voidReasonCategoryKey: "void-reason" }),
    );
    expect(withCategory.contentHash).not.toBe(base.contentHash);
    expect(withCategory.snapshotHash).not.toBe(base.snapshotHash);
  });

  it("物件鍵的先後不影響 hash", () => {
    const reordered = fields().map(
      (item) =>
        Object.fromEntries(
          Object.entries(item).toReversed(),
        ) as unknown as FieldDef,
    );
    expect(hashesOf(formSeed(reordered))).toEqual(hashesOf(formSeed(fields())));
  });

  it("契約明訂等價的未設定寫法算同一份內容:欄位的 null / 缺席、lookup 來源的預設值", () => {
    const explicit = formSeed([
      field("title", "text", {
        options: null,
        rules: null,
        default: null,
        permission: null,
        help: null,
        source: null,
        columns: null,
      }),
      userReference("applicant", {
        source: {
          provider: "user",
          labelField: "name",
          labelTemplate: "",
          valueField: "id",
          completedOnly: true,
          filter: {},
        },
      }),
    ]);
    expect(hashesOf(explicit)).toEqual(hashesOf(formSeed(fields())));
    // 有語意的差異仍然保留:說明文字從沒有變成空字串、valueField 改成別的欄位
    expect(
      hashesOf(
        formSeed([
          field("title", "text", { help: "" }),
          userReference("applicant"),
        ]),
      ).contentHash,
    ).not.toBe(hashesOf(formSeed(fields())).contentHash);
    expect(
      hashesOf(
        formSeed([
          field("title", "text"),
          userReference("applicant", {
            source: {
              provider: "user",
              labelField: "name",
              valueField: "account",
            },
          }),
        ]),
      ).contentHash,
    ).not.toBe(hashesOf(formSeed(fields())).contentHash);
  });

  it("流程:沒有 edges、null、空陣列都是直線;kind 省略 = review、allowReturn 省略 = true、skipWhen 未設定", () => {
    const implicit = workflowSeed({ steps: [review("boss"), review("hr")] });
    const explicit = workflowSeed({
      steps: [
        review("boss", { kind: "review", allowReturn: true, skipWhen: null }),
        review("hr", { kind: "review" }),
      ],
      edges: [],
    });
    const withNullEdges = workflowSeed({
      steps: [review("boss"), review("hr")],
      edges: null,
    });
    expect(hashesOf(explicit)).toEqual(hashesOf(implicit));
    expect(hashesOf(withNullEdges)).toEqual(hashesOf(implicit));
    // allowReturn 明寫 false、有連線:是不同的內容
    expect(
      hashesOf(
        workflowSeed({
          steps: [review("boss", { allowReturn: false }), review("hr")],
        }),
      ).contentHash,
    ).not.toBe(hashesOf(implicit).contentHash);
    expect(
      hashesOf(
        workflowSeed({
          steps: [review("boss"), review("hr")],
          edges: [{ from: "boss", to: "hr" }],
        }),
      ).contentHash,
    ).not.toBe(hashesOf(implicit).contentHash);
  });

  it("流程:skipOrgs / autoApprove 省略、null、{} 都是沒設(autoApprove 的 false = 照常審核);有設才是不同內容", () => {
    const implicit = workflowSeed({ steps: [review("boss")] });
    for (const unset of [null, {}]) {
      expect(
        hashesOf(
          workflowSeed({
            steps: [
              review("boss", {
                skipOrgs: unset as never,
                autoApprove: unset as never,
              }),
            ],
          }),
        ),
      ).toEqual(hashesOf(implicit));
    }
    expect(
      hashesOf(
        workflowSeed({
          steps: [
            review("boss", {
              autoApprove: { applicant: false, priorApprover: false },
            }),
          ],
        }),
      ),
    ).toEqual(hashesOf(implicit));
    expect(
      hashesOf(
        workflowSeed({
          steps: [review("boss", { autoApprove: { applicant: true } })],
        }),
      ).contentHash,
    ).not.toBe(hashesOf(implicit).contentHash);
    expect(
      hashesOf(
        workflowSeed({
          steps: [
            review("boss", {
              skipOrgs: { orgIds: ["tenant"], includeDescendants: true },
            }),
          ],
        }),
      ).contentHash,
    ).not.toBe(hashesOf(implicit).contentHash);
  });

  it("流程:逾時提醒、關卡知會、整個流程的知會省略與 null 都是沒設;有設才是不同內容", () => {
    const implicit = workflowSeed({ steps: [review("boss")] });
    expect(
      hashesOf(
        workflowSeed({
          steps: [review("boss", { overdue: null, cc: null })],
          cc: null,
        }),
      ),
    ).toEqual(hashesOf(implicit));
    const cc = { kind: "manager", level: 1 } as const;
    expect(
      hashesOf(workflowSeed({ steps: [review("boss", { cc })] })).contentHash,
    ).not.toBe(hashesOf(implicit).contentHash);
    expect(
      hashesOf(workflowSeed({ steps: [review("boss")], cc })).contentHash,
    ).not.toBe(hashesOf(implicit).contentHash);
  });

  it("contentHash 的來源字串不含 revision、changelog 與 desiredStatus", () => {
    const canonical = definitionContentCanonical(
      formSeed(fields(), { revision: "rev-marker", changelog: "log-marker" }),
    );
    expect(canonical).not.toContain("rev-marker");
    expect(canonical).not.toContain("log-marker");
    expect(canonical).not.toContain("desiredStatus");
  });
});
