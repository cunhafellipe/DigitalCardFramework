import test from "node:test";
import assert from "node:assert/strict";
import { testFont } from "./font-fixture.mjs";
import {
  inspectFont,
  fontMeasure,
  fontDiagnostics,
  layoutText,
  accessibleText,
} from "../src/presentation/text.js";
import { fixture, admin, code } from "./helpers.js";
import { fixture as artFixture, build } from "./presentation-fixtures.mjs";
import { createProject } from "../src/presentation/project.js";
import { addText } from "../src/presentation/authoring-tools.js";

test("embedded font overflow preserves exact ellipsis, clip and grow bounds", () => {
  const { font } = inspectFont(testFont(), "font/ttf"),
    measure = fontMeasure(font, {}),
    node = { width: 36, height: 20, typography: { size: 20, lineHeight: 1 } },
    layout = (overflow) => layoutText(
      { ...node, typography: { ...node.typography, overflow } },
      "ABCDEFGHIJ",
      measure,
    );
  const ellipsis = layout("ellipsis");
  assert.equal(ellipsis.size, 20);
  assert.equal(ellipsis.overflow, true);
  assert.deepEqual(ellipsis.lines, [
    { text: "AB…", start: 0, y: 0, width: 36, x: 0 },
  ]);
  assert.equal(ellipsis.renderHeight, 20);
  const clip = layout("clip");
  assert.deepEqual(clip.lines, [
    { text: "ABCDEFGHIJ", start: 0, y: 0, width: 120, x: 0 },
  ]);
  assert.equal(clip.overflow, true);
  assert.equal(clip.renderHeight, 20);
  const grow = layout("grow");
  assert.deepEqual(grow.lines, [
    { text: "ABC", start: 0, y: 0, width: 36, x: 0 },
    { text: "DEF", start: 3, y: 20, width: 36, x: 0 },
    { text: "GHI", start: 6, y: 40, width: 36, x: 0 },
    { text: "J", start: 9, y: 60, width: 12, x: 0 },
  ]);
  assert.equal(grow.overflow, true);
  assert.equal(grow.height, 80);
  assert.equal(grow.renderHeight, 80);
  assert.equal(node.height, 20);
});

test("embedded font shrink stops at its minimum and reports remaining overflow", () => {
  const { font } = inspectFont(testFont(), "font/ttf"),
    node = {
      width: 12,
      height: 10,
      typography: { size: 20, minSize: 10, lineHeight: 1, overflow: "shrink" },
    },
    result = layoutText(node, "ABC", fontMeasure(font, node));
  assert.equal(result.size, 10);
  assert.equal(result.lineHeight, 10);
  assert.equal(result.overflow, true);
  assert.equal(result.height, 20);
  assert.equal(result.renderHeight, 10);
  assert.deepEqual(result.lines, [
    { text: "AB", start: 0, y: 0, width: 12, x: 0 },
    { text: "C", start: 2, y: 10, width: 6, x: 0 },
  ]);
});

test("accessible text orders nested visible labels and removes inline icon placeholders", () => {
  const scene = { nodes: [
    { type: "text", text: "Last", readingOrder: 4 },
    { type: "group", children: [
      { type: "text", text: "Nested", readingOrder: 2 },
      { type: "text", text: "Hidden", visible: false, readingOrder: -1 },
    ] },
    { type: "text", text: "First", readingOrder: 1 },
    { type: "text", readingOrder: 3, runs: [
      { text: "Icon", icon: "star" }, { text: " label" },
    ] },
  ] };
  assert.equal(accessibleText({}, scene), "First. Nested.  Icon label. Last");
  assert.equal(accessibleText({}, null), "");
});

test("accessible text excludes descendants of hidden ancestors", () => {
  const scene = { nodes: [
    { type: "text", text: "Visible", readingOrder: 1 },
    { type: "group", visible: false, children: [
      { type: "text", text: "Hidden child", readingOrder: 2 },
      { type: "group", children: [
        { type: "text", text: "Hidden grandchild", visible: true, readingOrder: 3 },
      ] },
    ] },
    { type: "group", visible: true, children: [
      { type: "text", text: "Visible sibling", readingOrder: 0 },
    ] },
  ] };
  assert.equal(accessibleText({}, scene), "Visible sibling. Visible");
});

test("custom fonts are parsed, measured and checked for glyph coverage before publication", async () => {
  const bytes = testFont(),
    { font, info } = inspectFont(bytes, "font/ttf");
  assert.equal(info.family, "Test Sans");
  assert.equal(fontMeasure(font, {})("AB", 20), 24);
  assert.equal(fontDiagnostics(font, { id: "label" }, "ABC").length, 0);
  assert.equal(fontDiagnostics(font, { id: "label" }, "雪").length, 1);
  assert.throws(() => inspectFont(bytes, "font/woff2"), code("FONT"));
  const project = createProject(await build(artFixture())),
    asset = await project.addFont(new Blob([bytes], { type: "font/ttf" }));
  const id = addText(project, "front", {
    text: "Long text beyond the permitted region",
    width: 40,
    height: 20,
    typography: { fontAsset: asset.id, size: 20, overflow: "wrap" },
  });
  const pkg = await project.export();
  assert(pkg.manifest.assets.some((a) => a.id === asset.id));
  const { core } = fixture(),
    registration = await core.registerCardPresentation(admin, pkg.archive);
  assert.equal(registration.digest, pkg.digest);
  assert(
    registration.textIssues.some(
      (i) => i.nodeId === id && i.code === "TEXT_OVERFLOW",
    ),
  );
  const doc = {
    schemaVersion: 1,
    id: "font.rules",
    revision: 1,
    name: "Fonts",
    fields: [],
    requirements: { rejectOverflow: true, embeddedFonts: true },
  };
  core.saveCardPolicy(admin, {
    key: "save",
    expectedRevision: 0,
    document: doc,
  });
  const reviewed = core.previewCardPolicy(admin, {
    expectedRevision: 1,
    policy: "font.rules@1",
    assignments: [{ scope: "installation", policy: "font.rules@1" }],
  });
  core.activateCardPolicy(admin, { ...reviewed, key: "activate" });
  const c = core.operatorCatalog(admin),
    card = {
      ...c.cards[0],
      presentation: {
        contract: "digital-card@0.1",
        digest: pkg.digest,
        baseURL: "https://assets.example/",
      },
    };
  assert.throws(
    () =>
      core.previewImport(admin, {
        source: { cards: [card] },
        expectedVersion: c.version,
      }),
    code("CARD_POLICY"),
  );
});
