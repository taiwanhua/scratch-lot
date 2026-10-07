/* Local Figma execution. No network, generated JavaScript transport, or receipt. */
const ROLES = ["lighter", "light", "main", "dark", "darker", "contrast"];
const COLLECTIONS = ["Brand", "Color"];
const STYLE = "Shadow/Primary";
let pending = null;

figma.skipInvisibleInstanceChildren = false;
figma.showUI(__html__, { width: 480, height: 570 });

function send(type, value) {
  figma.ui.postMessage({ type, ...value });
}

function fail(code) {
  throw new Error(code);
}

function unique(items, name) {
  if (items.length > 1) fail(`AMBIGUOUS_${name}`);
  return items[0] || null;
}

function rgba(value) {
  if (
    !value ||
    ["r", "g", "b", "a"].some(
      (key) => !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1,
    )
  ) {
    fail("BRAND_COLOR_INVALID");
  }
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function near(a, b) {
  return Math.abs(a - b) < 0.00001;
}

function sameColor(a, b) {
  return (
    !!a && !!b && ["r", "g", "b", "a"].every((key) => near(a[key], b[key]))
  );
}

function shadowView(effect) {
  if (!effect || effect.type !== "DROP_SHADOW") return null;
  return {
    type: effect.type,
    color: rgba(effect.color),
    offset: { x: effect.offset.x, y: effect.offset.y },
    radius: effect.radius,
    spread: effect.spread,
    visible: effect.visible,
    blendMode: effect.blendMode,
  };
}

function sameShadow(current, expected) {
  const a = current && current.length === 1 ? shadowView(current[0]) : null;
  const b = shadowView(expected);
  return (
    !!a &&
    !!b &&
    sameColor(a.color, b.color) &&
    a.offset.x === b.offset.x &&
    a.offset.y === b.offset.y &&
    a.radius === b.radius &&
    a.spread === b.spread &&
    a.visible === b.visible &&
    a.blendMode === b.blendMode
  );
}

function validatePayload(input) {
  if (
    !input ||
    input.schemaVersion !== 1 ||
    !input.project ||
    typeof input.project.slug !== "string" ||
    !/^[a-z0-9][a-z0-9-]*$/.test(input.project.slug) ||
    typeof input.targetFileKey !== "string" ||
    !/^[A-Za-z0-9]+$/.test(input.targetFileKey) ||
    !input.projection ||
    !input.projection.primary ||
    !input.projection.primaryEffect
  ) {
    fail("BRAND_INPUT_INVALID");
  }
  for (const role of ROLES) rgba(input.projection.primary[role]);
  if (!shadowView(input.projection.primaryEffect)) fail("BRAND_SHADOW_INVALID");
  return input;
}

function assertTargetFile(key) {
  if (!figma.fileKey || figma.fileKey !== key) fail("TARGET_FILE_MISMATCH");
}

async function localBrandState() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const styles = await figma.getLocalEffectStylesAsync();
  const sides = {};
  for (const name of COLLECTIONS) {
    const collection = unique(
      collections.filter((item) => item.name === name),
      "COLLECTION",
    );
    if (
      collection &&
      (collection.modes.length !== 1 || collection.modes[0].name !== "Light")
    ) {
      fail("BRAND_MODE_CONFLICT");
    }
    const entries = {};
    for (const role of ROLES) {
      const variable = unique(
        variables.filter(
          (item) =>
            item.variableCollectionId === collection?.id &&
            item.name === `primary/${role}`,
        ),
        "VARIABLE",
      );
      if (variable && variable.resolvedType !== "COLOR")
        fail("BRAND_TYPE_CONFLICT");
      entries[role] = variable;
    }
    sides[name] = { collection, entries };
  }
  return {
    sides,
    style: unique(
      styles.filter((item) => item.name === STYLE),
      "STYLE",
    ),
  };
}

async function planBrand(input) {
  validatePayload(input);
  assertTargetFile(input.targetFileKey);
  const state = await localBrandState();
  const items = [];
  const fingerprint = [];
  for (const side of COLLECTIONS) {
    const { collection, entries } = state.sides[side];
    fingerprint.push([side, collection?.id || null, collection?.modes || null]);
    if (!collection) items.push(`建立 ${side} 集合`);
    for (const role of ROLES) {
      const item = entries[role];
      const mode = collection?.modes[0].modeId;
      const value = item && mode ? item.valuesByMode[mode] : null;
      const actual =
        value?.type === "VARIABLE_ALIAS"
          ? (await figma.variables.getVariableByIdAsync(value.id))?.key || null
          : value;
      fingerprint.push([side, role, item?.id || null, actual]);
      const wanted =
        side === "Brand"
          ? input.projection.primary[role]
          : state.sides.Brand.entries[role]?.key;
      const isSame =
        side === "Brand"
          ? sameColor(value, wanted)
          : !!wanted && actual === wanted;
      if (!item || !isSame) items.push(`${side}/primary/${role}`);
    }
  }
  fingerprint.push([
    STYLE,
    state.style?.id || null,
    state.style?.effects || null,
  ]);
  if (!sameShadow(state.style?.effects, input.projection.primaryEffect))
    items.push(STYLE);
  return { input, items, fingerprint: JSON.stringify(fingerprint) };
}

async function applyBrand(input) {
  const now = await planBrand(input);
  if (
    !pending ||
    pending.kind !== "brand" ||
    now.fingerprint !== pending.fingerprint ||
    JSON.stringify(now.items) !== JSON.stringify(pending.items)
  )
    fail("PREVIEW_CHANGED");
  const state = await localBrandState();
  const brandVariables = {};
  for (const side of COLLECTIONS) {
    let collection = state.sides[side].collection;
    if (!collection) {
      collection = figma.variables.createVariableCollection(side);
      collection.renameMode(collection.modes[0].modeId, "Light");
    }
    const mode = collection.modes[0].modeId;
    for (const role of ROLES) {
      let variable = state.sides[side].entries[role];
      if (!variable)
        variable = figma.variables.createVariable(
          `primary/${role}`,
          collection,
          "COLOR",
        );
      if (!state.sides[side].entries[role]) {
        variable.scopes =
          side === "Brand" ? [] : ["ALL_FILLS", "STROKE_COLOR", "EFFECT_COLOR"];
      }
      if (side === "Brand") {
        brandVariables[role] = variable;
        if (
          !sameColor(
            variable.valuesByMode[mode],
            input.projection.primary[role],
          )
        ) {
          variable.setValueForMode(mode, input.projection.primary[role]);
        }
      } else {
        const target = brandVariables[role];
        if (!target) fail("BRAND_TARGET_MISSING");
        const current = variable.valuesByMode[mode];
        if (
          !current ||
          current.type !== "VARIABLE_ALIAS" ||
          current.id !== target.id
        ) {
          variable.setValueForMode(
            mode,
            figma.variables.createVariableAlias(target),
          );
        }
      }
    }
  }
  let style = state.style;
  if (!style) {
    style = figma.createEffectStyle();
    style.name = STYLE;
  }
  if (!sameShadow(style.effects, input.projection.primaryEffect)) {
    style.effects = [input.projection.primaryEffect];
  }
  const after = await planBrand(input);
  if (after.items.length) fail("BRAND_READBACK_FAILED");
  pending = null;
  return { status: "verified", changed: now.items.length, styleKey: style.key };
}

async function libraryChoices() {
  const collections =
    await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  const names = [
    ...new Set(collections.map((item) => item.libraryName)),
  ].sort();
  return names.filter((name) =>
    COLLECTIONS.every((side) =>
      collections.some(
        (item) => item.libraryName === name && item.name === side,
      ),
    ),
  );
}

async function libraryMap(sourceName, targetName) {
  if (!sourceName || !targetName || sourceName === targetName)
    fail("LIBRARY_SELECTION_INVALID");
  const available =
    await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  const map = new Map();
  const sourceKeys = new Set();
  const targetKeys = new Set();
  for (const side of COLLECTIONS) {
    const sourceCollection = unique(
      available.filter(
        (item) => item.libraryName === sourceName && item.name === side,
      ),
      "SOURCE_COLLECTION",
    );
    const targetCollection = unique(
      available.filter(
        (item) => item.libraryName === targetName && item.name === side,
      ),
      "TARGET_COLLECTION",
    );
    if (!sourceCollection || !targetCollection)
      fail("LIBRARY_COLLECTION_MISSING");
    const source = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(
      sourceCollection.key,
    );
    const target = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(
      targetCollection.key,
    );
    for (const role of ROLES) {
      const name = `primary/${role}`;
      const from = unique(
        source.filter(
          (item) => item.name === name && item.resolvedType === "COLOR",
        ),
        "SOURCE_ROLE",
      );
      const to = unique(
        target.filter(
          (item) => item.name === name && item.resolvedType === "COLOR",
        ),
        "TARGET_ROLE",
      );
      if (!from || !to) fail(`ROLE_MISSING_${role}`);
      map.set(from.key, { role, side, targetKey: to.key });
      targetKeys.add(to.key);
    }
    for (const item of source)
      if (item.name.startsWith("primary/")) sourceKeys.add(item.key);
  }
  return { map, sourceKeys, targetKeys };
}

async function rootsFor(scope) {
  if (scope === "selection") {
    if (!figma.currentPage.selection.length) fail("SELECTION_EMPTY");
    return figma.currentPage.selection;
  }
  if (scope === "page") return figma.currentPage.children;
  if (scope === "all") {
    await figma.loadAllPagesAsync();
    return figma.root.children.flatMap((page) => page.children);
  }
  fail("SCOPE_INVALID");
}

async function analyzeScreens(options) {
  assertTargetFile(options.fileKey);
  const { map, sourceKeys, targetKeys } = await libraryMap(
    options.source,
    options.target,
  );
  const roots = await rootsFor(options.scope);
  const stack = [...roots];
  const seen = new Set();
  const variableCache = new Map();
  const actions = [];
  const issues = [];
  let alreadyProject = 0;
  let remoteInstances = 0;
  let inspected = 0;
  async function variableById(id) {
    if (!variableCache.has(id))
      variableCache.set(id, await figma.variables.getVariableByIdAsync(id));
    return variableCache.get(id);
  }
  while (stack.length) {
    const node = stack.pop();
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    inspected += 1;
    if (node.type === "INSTANCE") {
      const main = await node.getMainComponentAsync();
      if (main?.remote) remoteInstances += 1;
      if (!main)
        issues.push({ code: "INSTANCE_SOURCE_MISSING", nodeId: node.id });
    }
    for (const prop of ["fills", "strokes"]) {
      if (!(prop in node)) continue;
      const paints = node[prop];
      if (paints === figma.mixed) {
        issues.push({ code: "MIXED_PAINTS", nodeId: node.id, prop });
        continue;
      }
      if (!Array.isArray(paints)) continue;
      for (let index = 0; index < paints.length; index += 1) {
        const paint = paints[index];
        const id = paint?.boundVariables?.color?.id;
        if (!id) continue;
        const variable = await variableById(id);
        if (!variable) {
          issues.push({
            code: "BOUND_VARIABLE_MISSING",
            nodeId: node.id,
            prop,
            index,
          });
          continue;
        }
        if (targetKeys.has(variable.key)) {
          alreadyProject += 1;
          continue;
        }
        if (!sourceKeys.has(variable.key)) continue;
        const mapping = map.get(variable.key);
        if (!mapping) {
          issues.push({
            code: "SOURCE_ROLE_UNMAPPED",
            nodeId: node.id,
            prop,
            index,
          });
          continue;
        }
        const styleProp = prop === "fills" ? "fillStyleId" : "strokeStyleId";
        if (node[styleProp] && node[styleProp] !== "") {
          issues.push({
            code: "PAINT_STYLE_PRESENT",
            nodeId: node.id,
            prop,
            index,
          });
          continue;
        }
        actions.push({
          nodeId: node.id,
          prop,
          index,
          fromKey: variable.key,
          toKey: mapping.targetKey,
          role: mapping.role,
        });
      }
    }
    if ("children" in node) stack.push(...node.children);
  }
  actions.sort((a, b) =>
    `${a.nodeId}|${a.prop}|${a.index}`.localeCompare(
      `${b.nodeId}|${b.prop}|${b.index}`,
    ),
  );
  const signature = JSON.stringify({ options, actions, issues });
  return {
    signature,
    actions,
    issues,
    alreadyProject,
    remoteInstances,
    inspected,
  };
}

async function applyScreens(options) {
  const now = await analyzeScreens(options);
  if (
    !pending ||
    pending.kind !== "screens" ||
    now.signature !== pending.signature
  )
    fail("PREVIEW_CHANGED");
  if (now.issues.length) fail("SCREEN_ISSUES_PRESENT");
  const imported = new Map();
  const loadedFonts = new Set();
  for (const action of now.actions) {
    const node = await figma.getNodeByIdAsync(action.nodeId);
    if (node?.type === "TEXT") {
      for (const segment of node.getStyledTextSegments(["fontName"])) {
        const font = segment.fontName;
        const key = `${font.family}\u0000${font.style}`;
        if (!loadedFonts.has(key)) {
          await figma.loadFontAsync(font);
          loadedFonts.add(key);
        }
      }
    }
    const paints = node?.[action.prop];
    const paint = Array.isArray(paints) ? paints[action.index] : null;
    const current = paint?.boundVariables?.color?.id
      ? await figma.variables.getVariableByIdAsync(
          paint.boundVariables.color.id,
        )
      : null;
    if (!current || current.key !== action.fromKey)
      fail("SCREEN_SOURCE_CHANGED");
    if (!imported.has(action.toKey)) {
      imported.set(
        action.toKey,
        await figma.variables.importVariableByKeyAsync(action.toKey),
      );
    }
    const copy = [...paints];
    copy[action.index] = figma.variables.setBoundVariableForPaint(
      paint,
      "color",
      imported.get(action.toKey),
    );
    node[action.prop] = copy;
    const read = node[action.prop][action.index]?.boundVariables?.color?.id;
    const verified = read
      ? await figma.variables.getVariableByIdAsync(read)
      : null;
    if (verified?.key !== action.toKey) fail("SCREEN_READBACK_FAILED");
  }
  const after = await analyzeScreens(options);
  if (after.actions.length || after.issues.length)
    fail("SCREEN_FINAL_CHECK_FAILED");
  pending = null;
  return {
    status: "verified",
    changed: now.actions.length,
    inspected: after.inspected,
    alreadyProject: after.alreadyProject,
    remoteInstances: after.remoteInstances,
  };
}

figma.ui.onmessage = async (message) => {
  try {
    if (message.type === "init") {
      const libraries = await libraryChoices();
      send("ready", { fileKey: figma.fileKey || null, libraries });
      return;
    }
    if (message.type === "preview-brand") {
      const plan = await planBrand(message.input);
      pending = {
        kind: "brand",
        fingerprint: plan.fingerprint,
        items: plan.items,
      };
      send("preview", {
        kind: "brand",
        count: plan.items.length,
        details: plan.items.slice(0, 15),
      });
      return;
    }
    if (message.type === "apply-brand") {
      send("done", { kind: "brand", result: await applyBrand(message.input) });
      return;
    }
    if (message.type === "preview-screens") {
      const result = await analyzeScreens(message.options);
      pending = { kind: "screens", signature: result.signature };
      send("preview", {
        kind: "screens",
        count: result.actions.length,
        inspected: result.inspected,
        alreadyProject: result.alreadyProject,
        remoteInstances: result.remoteInstances,
        issues: result.issues.slice(0, 20),
        issueCount: result.issues.length,
      });
      return;
    }
    if (message.type === "apply-screens") {
      send("done", {
        kind: "screens",
        result: await applyScreens(message.options),
      });
      return;
    }
    if (message.type === "close") figma.closePlugin();
  } catch (error) {
    pending = null;
    send("error", { code: error?.message || "PLUGIN_FAILED" });
  }
};
