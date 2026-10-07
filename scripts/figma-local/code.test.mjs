import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const source = readFileSync(new URL("./code.js", import.meta.url), "utf8");
const roles = ["lighter", "light", "main", "dark", "darker", "contrast"];

function harness() {
  const messages = [];
  const collections = [];
  const variables = [];
  const styles = [];
  const variablesById = new Map();
  const nodes = new Map();
  const available = [];
  const descriptors = new Map();
  const loadedFonts = [];
  let id = 0;
  const next = (prefix) => `${prefix}:${++id}`;
  const figma = {
    fileKey: "testFile123",
    root: { name: "隔離測試檔", children: [] },
    currentPage: { selection: [], children: [] },
    ui: { postMessage: (message) => messages.push(message) },
    showUI: () => {},
    closePlugin: () => {},
    loadFontAsync: async (font) => loadedFonts.push(font),
    loadAllPagesAsync: async () => {},
    getNodeByIdAsync: async (nodeId) => nodes.get(nodeId) || null,
    getLocalEffectStylesAsync: async () => styles,
    createEffectStyle() {
      const item = {
        id: next("style"),
        key: next("style-key"),
        name: "",
        effects: [],
      };
      styles.push(item);
      return item;
    },
    teamLibrary: {
      getAvailableLibraryVariableCollectionsAsync: async () => available,
      getVariablesInLibraryCollectionAsync: async (key) =>
        descriptors.get(key) || [],
    },
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async (type) =>
        variables.filter((item) => !type || item.resolvedType === type),
      getVariableByIdAsync: async (variableId) =>
        variablesById.get(variableId) || null,
      createVariableCollection(name) {
        const modeId = next("mode");
        const item = {
          id: next("collection"),
          name,
          modes: [{ modeId, name: "Mode 1" }],
          renameMode(value, label) {
            assert.equal(value, modeId);
            this.modes[0].name = label;
          },
        };
        collections.push(item);
        return item;
      },
      createVariable(name, collection, resolvedType) {
        const item = {
          id: next("variable"),
          key: next("variable-key"),
          name,
          variableCollectionId: collection.id,
          resolvedType,
          valuesByMode: {},
          setValueForMode(mode, value) {
            this.valuesByMode[mode] = value;
          },
        };
        variables.push(item);
        variablesById.set(item.id, item);
        return item;
      },
      createVariableAlias: (variable) => ({
        type: "VARIABLE_ALIAS",
        id: variable.id,
      }),
      async importVariableByKeyAsync(key) {
        return variables.find((item) => item.key === key) || null;
      },
      setBoundVariableForPaint(paint, field, variable) {
        assert.equal(field, "color");
        return {
          ...paint,
          boundVariables: {
            ...paint.boundVariables,
            color: { type: "VARIABLE_ALIAS", id: variable.id },
          },
        };
      },
    },
  };
  vm.runInNewContext(
    source,
    { figma, __html__: "", console },
    { filename: "code.js" },
  );
  async function send(type, values = {}) {
    await figma.ui.onmessage({ type, ...values });
    return messages.at(-1);
  }
  function library(name) {
    for (const side of ["Brand", "Color"]) {
      const key = `${name}-${side}`;
      available.push({ libraryName: name, name: side, key });
      const list = roles.map((role) => ({
        name: `primary/${role}`,
        key: `${name}-${side}-${role}`,
        resolvedType: "COLOR",
      }));
      descriptors.set(key, list);
      for (const item of list) {
        const variable = { ...item, id: next("remote"), remote: true };
        variables.push(variable);
        variablesById.set(variable.id, variable);
      }
    }
  }
  return {
    figma,
    collections,
    variables,
    styles,
    nodes,
    library,
    send,
    messages,
    loadedFonts,
  };
}

function input() {
  return {
    schemaVersion: 1,
    targetFileKey: "testFile123",
    project: { slug: "scratch-lot", primary: "#234567" },
    projection: {
      primary: Object.fromEntries(
        roles.map((role, index) => [
          role,
          { r: index / 10, g: 0.2, b: 0.3, a: 1 },
        ]),
      ),
      primaryEffect: {
        type: "DROP_SHADOW",
        color: { r: 0.1, g: 0.2, b: 0.3, a: 0.2 },
        offset: { x: 0, y: 2 },
        radius: 8,
        spread: 0,
        visible: true,
        blendMode: "NORMAL",
      },
    },
  };
}

test("brand library creates six colors, aliases and shadow, then repeats as a no-op", async () => {
  const app = harness();
  app.figma.root.name = "scratch-lot Brand Library";
  const brand = input();
  const preview = await app.send("preview-brand", { input: brand });
  assert.equal(preview.type, "preview");
  assert.equal(preview.count, 15);
  const done = await app.send("apply-brand", { input: brand });
  assert.equal(done.result.status, "verified");
  assert.deepEqual(
    app.collections.map((item) => item.name),
    ["Brand", "Color"],
  );
  assert.equal(app.variables.length, 12);
  assert.equal(app.styles[0].name, "Shadow/Primary");
  assert.deepEqual(Array.from(app.variables[0].scopes), []);
  assert.deepEqual(Array.from(app.variables[6].scopes), [
    "ALL_FILLS",
    "STROKE_COLOR",
    "EFFECT_COLOR",
  ]);
  for (const role of roles) {
    const brandVariable = app.variables.find(
      (item) =>
        item.name === `primary/${role}` &&
        item.variableCollectionId === app.collections[0].id,
    );
    const alias = app.variables.find(
      (item) =>
        item.name === `primary/${role}` &&
        item.variableCollectionId === app.collections[1].id,
    );
    assert.equal(
      alias.valuesByMode[app.collections[1].modes[0].modeId].id,
      brandVariable.id,
    );
  }
  const repeat = await app.send("preview-brand", { input: brand });
  assert.equal(repeat.count, 0);
});

test("consumer updates only Base primary bindings and preserves unrelated content", async () => {
  const app = harness();
  app.figma.root.name = "scratch-lot Screens";
  app.library("wowgo-base Design System");
  app.library("scratch-lot Brand Library");
  const base = app.variables.find(
    (item) => item.key === "wowgo-base Design System-Color-main",
  );
  const target = app.variables.find(
    (item) => item.key === "scratch-lot Brand Library-Color-main",
  );
  const privateColor = { id: "private-id", key: "private-key" };
  app.variables.push(privateColor);
  const rectangle = {
    id: "rect",
    type: "RECTANGLE",
    name: "Keep this name",
    strokes: [],
    fills: [base, privateColor, target].map((variable) => ({
      type: "SOLID",
      color: { r: 0, g: 0, b: 0 },
      boundVariables: { color: { type: "VARIABLE_ALIAS", id: variable.id } },
    })),
  };
  app.nodes.set(rectangle.id, rectangle);
  app.figma.currentPage.selection = [rectangle];
  app.figma.variables.getVariableByIdAsync = async (id) =>
    app.variables.find((item) => item.id === id) || null;
  const options = {
    fileKey: "testFile123",
    source: "wowgo-base Design System",
    target: "scratch-lot Brand Library",
    scope: "selection",
  };
  const preview = await app.send("preview-screens", { options });
  assert.equal(preview.count, 1);
  assert.equal(preview.alreadyProject, 1);
  assert.equal(preview.issueCount, 0);
  const done = await app.send("apply-screens", { options });
  assert.equal(done.result.status, "verified");
  assert.equal(done.result.changed, 1);
  assert.equal(rectangle.fills[0].boundVariables.color.id, target.id);
  assert.equal(rectangle.fills[1].boundVariables.color.id, privateColor.id);
  assert.equal(rectangle.name, "Keep this name");
});

test("consumer refuses a changed binding after preview", async () => {
  const app = harness();
  app.figma.root.name = "scratch-lot Screens";
  app.library("Base");
  app.library("Project");
  const main = app.variables.find((item) => item.key === "Base-Color-main");
  const lighter = app.variables.find(
    (item) => item.key === "Base-Color-lighter",
  );
  const rectangle = {
    id: "rect",
    type: "RECTANGLE",
    strokes: [],
    fills: [{ type: "SOLID", boundVariables: { color: { id: main.id } } }],
  };
  app.figma.currentPage.selection = [rectangle];
  app.nodes.set(rectangle.id, rectangle);
  const options = {
    fileKey: "testFile123",
    source: "Base",
    target: "Project",
    scope: "selection",
  };
  assert.equal((await app.send("preview-screens", { options })).count, 1);
  rectangle.fills[0].boundVariables.color.id = lighter.id;
  const result = await app.send("apply-screens", { options });
  assert.equal(result.type, "error");
  assert.equal(result.code, "PREVIEW_CHANGED");
  assert.equal(rectangle.fills[0].boundVariables.color.id, lighter.id);
});

test("consumer loads a text node's own font before rebinding its color", async () => {
  const app = harness();
  app.library("Base");
  app.library("Project");
  const source = app.variables.find((item) => item.key === "Base-Color-main");
  const target = app.variables.find(
    (item) => item.key === "Project-Color-main",
  );
  const node = {
    id: "text",
    type: "TEXT",
    getStyledTextSegments: () => [
      { fontName: { family: "Noto Sans TC", style: "Regular" } },
    ],
    strokes: [],
    fills: [
      {
        type: "SOLID",
        boundVariables: { color: { id: source.id } },
      },
    ],
  };
  app.nodes.set(node.id, node);
  app.figma.currentPage.selection = [node];
  const options = {
    fileKey: "testFile123",
    source: "Base",
    target: "Project",
    scope: "selection",
  };
  assert.equal((await app.send("preview-screens", { options })).count, 1);
  assert.equal((await app.send("apply-screens", { options })).type, "done");
  assert.equal(app.loadedFonts.length, 1);
  assert.equal(app.loadedFonts[0].family, "Noto Sans TC");
  assert.equal(node.fills[0].boundVariables.color.id, target.id);
});

test("brand write refuses a different file key before creating any assets", async () => {
  const app = harness();
  const brand = input();
  brand.targetFileKey = "otherFile123";
  const result = await app.send("preview-brand", { input: brand });
  assert.equal(result.type, "error");
  assert.equal(result.code, "TARGET_FILE_MISMATCH");
  assert.equal(app.collections.length, 0);
});

test("screen preview refuses a different file key", async () => {
  const app = harness();
  const result = await app.send("preview-screens", {
    options: {
      fileKey: "otherFile123",
      source: "Base",
      target: "Project",
      scope: "page",
    },
  });
  assert.equal(result.type, "error");
  assert.equal(result.code, "TARGET_FILE_MISMATCH");
});
