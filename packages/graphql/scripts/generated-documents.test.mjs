import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildSchema, parse, validate } from "graphql";

const { dirname, join, resolve } = path;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = join(packageRoot, "src", "generated", "index.ts");
const schemaPath = join(packageRoot, "..", "..", "apps", "api", "schema.gql");

/**
 * 從 codegen 產物抓出每個 `*Document` / `*FragmentDoc` 的樣板字串,
 * 把 `${XxxFragmentDoc}` 遞迴展開成送到 api 的完整文字。
 */
function expandGeneratedDocuments(source) {
  const raw = new Map();
  const pattern = /export const (\w+(?:Document|FragmentDoc)) = `([\s\S]*?)`;/g;
  for (const match of source.matchAll(pattern)) raw.set(match[1], match[2]);
  const expanded = new Map();
  const expand = (name, stack = []) => {
    if (expanded.has(name)) return expanded.get(name);
    if (!raw.has(name)) throw new Error(`產物裡找不到 ${name}`);
    if (stack.includes(name))
      throw new Error(`fragment 循環:${[...stack, name].join(" → ")}`);
    const text = raw
      .get(name)
      .replace(/\$\{(\w+)\}/g, (_, ref) => expand(ref, [...stack, name]));
    expanded.set(name, text);
    return text;
  };
  const documents = new Map();
  for (const name of raw.keys()) {
    if (name.endsWith("Document")) documents.set(name, expand(name));
  }
  return documents;
}

function validateAll(schema, documents) {
  const failures = [];
  for (const [name, text] of documents) {
    const errors = validate(schema, parse(text));
    if (errors.length > 0)
      failures.push(`${name}: ${errors.map((e) => e.message).join("; ")}`);
  }
  return failures;
}

const schema = buildSchema(readFileSync(schemaPath, "utf8"));

test("產物:每個 Document 展開 fragment 後都能通過 schema 驗證(不重複定義、不缺 fragment)", () => {
  const documents = expandGeneratedDocuments(
    readFileSync(generatedPath, "utf8"),
  );
  assert.ok(documents.size > 0, "產物裡沒有任何 Document");
  assert.deepEqual(validateAll(schema, documents), []);
});

test("負例:同一 fragment 經兩條路徑引用而重複展開時會被擋", () => {
  const fixture = [
    "export const OrgFieldsFragmentDoc = `\n    fragment OrgFields on Org {\n  id\n}\n    `;",
    "export const WithOrgAFragmentDoc = `\n    fragment WithOrgA on Org {\n  ...OrgFields\n}\n    ${OrgFieldsFragmentDoc}`;",
    "export const MeDocument = `\n    query Me {\n  me {\n    id\n  }\n}\n    ${OrgFieldsFragmentDoc}\n${WithOrgAFragmentDoc}`;",
  ].join("\n");
  const fixtureSchema = buildSchema(
    "type Org { id: ID! }\ntype Query { me: Org }",
  );
  const failures = validateAll(
    fixtureSchema,
    expandGeneratedDocuments(fixture),
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /There can be only one fragment named "OrgFields"/);
});

test("負例:引用了產物裡沒有的 fragment 會被擋", () => {
  const fixture =
    "export const MeDocument = `\n    query Me {\n  me {\n    ...OrgFields\n  }\n}\n    `;";
  const fixtureSchema = buildSchema(
    "type Org { id: ID! }\ntype Query { me: Org }",
  );
  const failures = validateAll(
    fixtureSchema,
    expandGeneratedDocuments(fixture),
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Unknown fragment "OrgFields"/);
});
