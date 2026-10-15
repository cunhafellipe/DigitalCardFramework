import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testFont } from "./font-fixture.mjs";
import {
  inspectFont,
  fontMeasure,
  fontDiagnostics,
  layoutText,
  accessibleText,
  fontForNode,
  drawText,
} from "../src/presentation/text.js";
import { fixture, admin, code } from "./helpers.js";
import { fixture as artFixture, build } from "./presentation-fixtures.mjs";
import { createProject } from "../src/presentation/project.js";
import { addText } from "../src/presentation/authoring-tools.js";

const realFont = (name, type) =>
  inspectFont(
    new Uint8Array(
      readFileSync(new URL("./fixtures/fonts/" + name, import.meta.url)),
    ),
    type,
  );

test("licensed real fonts decode all four supported containers", () => {
  for (const [name, type, family] of [
    ["SourceSans3-Regular.otf", "font/otf", "Source Sans 3"],
    ["SourceSans3-Regular.ttf.woff", "font/woff", "Source Sans 3"],
    ["SourceSans3VF-Upright.ttf.woff2", "font/woff2", "SourceSans3VF"],
    ["NotoSansHebrew-Full-Regular.ttf", "font/ttf", "Noto Sans Hebrew"],
  ]) {
    const { font, info } = realFont(name, type);
    assert.equal(info.family, family);
    assert(fontMeasure(font, {})("ABC123", 20) > 0);
    assert.deepEqual(fontDiagnostics(font, { id: name }, "ABC123"), []);
    assert.equal(
      fontDiagnostics(font, { id: name }, "\u{10ffff}")[0].code,
      "FONT_GLYPH",
    );
    assert.throws(
      () => realFont(name, type === "font/ttf" ? "font/otf" : "font/ttf"),
      code("FONT"),
    );
  }
});

test("variable WOFF2 weight coordinates produce usable distinct glyphs and reject out-of-range axes", () => {
  const { font, info } = realFont(
    "SourceSans3VF-Upright.ttf.woff2",
    "font/woff2",
  );
  assert.deepEqual(info.axes.wght, {
    name: "Weight",
    min: 200,
    default: 200,
    max: 900,
  });
  assert.throws(
    () => fontForNode(font, { typography: { axes: { wght: 199 } } }),
    code("FONT_AXIS"),
  );
  assert.throws(
    () => fontForNode(font, { typography: { axes: { wght: 901 } } }),
    code("FONT_AXIS"),
  );
  const node = (weight) => ({ typography: { axes: { wght: weight } } }),
    light = fontMeasure(font, node(200))("AAA", 20),
    heavy = fontMeasure(font, node(900))("AAA", 20);
  assert(Number.isFinite(light) && Number.isFinite(heavy));
  assert.notEqual(light, heavy);
  assert.equal(fontMeasure(font, node(200))("AAA", 20), light);
  assert.equal(
    fontMeasure(font, { typography: { weight: 1000 } })("AAA", 20),
    heavy,
  );
  for (const point of [65, 233]) {
    const base = font.glyphForCodePoint(point).path.toSVG(),
      minimum = fontForNode(font, node(200)).glyphForCodePoint(point),
      maximum = fontForNode(font, node(900)).glyphForCodePoint(point);
    assert.equal(minimum.path.toSVG(), base);
    assert.notEqual(maximum.path.toSVG(), base);
    assert.notEqual(minimum.advanceWidth, maximum.advanceWidth);
    assert.equal(
      fontForNode(font, node(info.axes.wght.default))
        .glyphForCodePoint(point)
        .path.toSVG(),
      base,
    );
    assert.equal(
      fontForNode(font, node(200)).glyphForCodePoint(point).path.toSVG(),
      base,
    );
    assert.equal(font.glyphForCodePoint(point).path.toSVG(), base);
  }
});

test("Hebrew font preserves RTL letter order and positions vowel marks without advance", () => {
  const { font } = realFont("NotoSansHebrew-Full-Regular.ttf", "font/ttf"),
    rtl = font.layout("שלום", undefined, undefined, "he", "rtl");
  assert.deepEqual(
    rtl.glyphs.map((g) => g.codePoints[0]),
    [..."םולש"].map((c) => c.codePointAt(0)),
  );
  const pointed = font.layout("שָׁלוֹם", undefined, undefined, "he", "rtl"),
    marks = new Set([0x05b8, 0x05b9, 0x05c1]);
  assert.deepEqual(
    pointed.glyphs
      .filter((g) => !marks.has(g.codePoints[0]))
      .map((g) => g.codePoints[0]),
    [..."םולש"].map((c) => c.codePointAt(0)),
  );
  assert.deepEqual(
    new Set(
      pointed.glyphs
        .filter((g) => marks.has(g.codePoints[0]))
        .map((g) => g.codePoints[0]),
    ),
    marks,
  );
  pointed.glyphs.forEach((glyph, index) => {
    if (marks.has(glyph.codePoints[0])) {
      assert.equal(pointed.positions[index].xAdvance, 0);
      assert(pointed.positions[index].xOffset > 0);
    }
  });
  assert.deepEqual(
    fontDiagnostics(font, { id: "hebrew" }, "ABC שָׁלוֹם 123"),
    [],
  );
});

test("mixed styled RTL text retains logical accessibility and LTR digits when drawn", () => {
  const { font } = realFont("NotoSansHebrew-Full-Regular.ttf", "font/ttf"),
    shaped = [],
    observed = new Proxy(font, {
      get(target, key) {
        if (key === "layout")
          return (...args) => {
            const run = target.layout(...args);
            shaped.push({
              text: args[0],
              points: run.glyphs.flatMap((g) => g.codePoints),
            });
            return run;
          };
        return Reflect.get(target, key, target);
      },
    }),
    node = {
      type: "text",
      width: 1000,
      height: 40,
      typography: {
        size: 20,
        overflow: "clip",
        direction: "rtl",
        language: "he",
      },
      runs: [
        { text: "ABC ", color: "#ff0000" },
        { text: "שלום ", color: "#0000ff" },
        { text: "123", color: "#00ff00" },
      ],
    },
    ctx = Object.fromEntries(
      [
        "save",
        "restore",
        "beginPath",
        "rect",
        "clip",
        "translate",
        "scale",
        "moveTo",
        "lineTo",
        "quadraticCurveTo",
        "bezierCurveTo",
        "closePath",
        "fill",
        "stroke",
      ].map((name) => [name, () => {}]),
    );
  assert.equal(accessibleText({}, { nodes: [node] }), "ABC שלום 123");
  drawText(ctx, node, {}, observed);
  assert.deepEqual(
    shaped.findLast((run) => run.text === "123").points,
    [49, 50, 51],
  );
  assert.deepEqual(
    shaped
      .findLast((run) => run.text.trim() === "ABC")
      .points.filter((c) => c !== 32),
    [65, 66, 67],
  );
});

function paintText(font, node, icons = new Map()) {
  let painting = false;
  const runs = [],
    images = [],
    observed = new Proxy(font, {
      get(target, key) {
        if (key === "layout")
          return (...args) => {
            const run = target.layout(...args);
            if (painting)
              runs.push({
                text: args[0],
                points: run.glyphs.flatMap((g) => g.codePoints),
              });
            return run;
          };
        return Reflect.get(target, key, target);
      },
    }),
    ctx = Object.fromEntries(
      [
        "restore",
        "beginPath",
        "rect",
        "clip",
        "translate",
        "scale",
        "moveTo",
        "lineTo",
        "quadraticCurveTo",
        "bezierCurveTo",
        "closePath",
        "fill",
        "stroke",
      ].map((name) => [name, () => {}]),
    );
  ctx.save = () => {
    painting = true;
  };
  ctx.drawImage = (...args) => images.push(args);
  return { layout: drawText(ctx, node, {}, observed, icons), runs, images };
}

test("paragraph bidi orders mixed text within one styled span in both base directions", () => {
  const { font } = realFont("NotoSansHebrew-Full-Regular.ttf", "font/ttf");
  for (const [direction, expected] of [
    ["rtl", "123םולשABC"],
    ["ltr", "ABC123םולש"],
  ]) {
    const node = {
        type: "text",
        width: 1000,
        height: 40,
        typography: { size: 20, overflow: "clip", direction },
        runs: [{ text: "ABC שלום 123", color: "#ff0000" }],
      },
      painted = paintText(font, node);
    assert.equal(
      String.fromCodePoint(
        ...painted.runs.flatMap((run) => run.points),
      ).replaceAll(" ", ""),
      expected,
    );
    assert.equal(accessibleText({}, { nodes: [node] }), "ABC שלום 123");
    assert.equal(
      painted.layout.lines[0].width,
      fontMeasure(font, node)("ABC שלום 123", 20),
    );
  }
});

test("paragraph bidi mirrors parentheses and retains combining marks and inline icon offsets", () => {
  const { font } = realFont("NotoSansHebrew-Full-Regular.ttf", "font/ttf"),
    base = {
      type: "text",
      width: 1000,
      height: 40,
      typography: { size: 20, overflow: "clip", direction: "rtl" },
    },
    brackets = paintText(font, { ...base, text: "(שלום)" });
  assert.equal(
    String.fromCodePoint(...brackets.runs.flatMap((run) => run.points)),
    "(םולש)",
  );
  const icon = {},
    node = {
      ...base,
      runs: [
        { text: "ABC ", color: "#ff0000" },
        { icon: "star", text: " " },
        { text: "שָׁלוֹם 123", color: "#0000ff" },
      ],
    },
    painted = paintText(font, node, new Map([["star", icon]]));
  assert.equal(painted.images.length, 1);
  assert.equal(painted.images[0][0], icon);
  assert.deepEqual(painted.images[0].slice(-2), [20, 20]);
  assert.equal(accessibleText({}, { nodes: [node] }), "ABC   שָׁלוֹם 123");
  const points = painted.runs.flatMap((run) => run.points);
  for (const mark of [0x05b8, 0x05b9, 0x05c1]) assert(points.includes(mark));
  assert(
    points.indexOf(49) < points.indexOf(50) &&
      points.indexOf(50) < points.indexOf(51),
  );
});

test("wrapped bidi keeps LTR words and digits in their logical order after the first line", () => {
  const { font } = realFont("NotoSansHebrew-Full-Regular.ttf", "font/ttf"),
    node = {
      type: "text",
      text: "אב ABC DEF 123 GHI",
      width: 55,
      height: 200,
      typography: {
        size: 20,
        lineHeight: 1,
        overflow: "wrap",
        direction: "rtl",
      },
    },
    painted = paintText(font, node);
  assert(painted.layout.lines.length > 2);
  assert(painted.layout.lines.some((line) => line.start > 0));
  const words = painted.runs
    .map((run) => run.text.trim())
    .filter((value) => /[A-Z0-9]/u.test(value));
  assert.deepEqual(words, ["ABC", "DEF", "123", "GHI"]);
  for (const run of painted.runs.filter((r) => /[A-Z0-9]/u.test(r.text))) {
    assert.equal(String.fromCodePoint(...run.points).trim(), run.text.trim());
  }
});

test("embedded font overflow preserves exact ellipsis, clip and grow bounds", () => {
  const { font } = inspectFont(testFont(), "font/ttf"),
    measure = fontMeasure(font, {}),
    node = { width: 36, height: 20, typography: { size: 20, lineHeight: 1 } },
    layout = (overflow) =>
      layoutText(
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
  const scene = {
    nodes: [
      { type: "text", text: "Last", readingOrder: 4 },
      {
        type: "group",
        children: [
          { type: "text", text: "Nested", readingOrder: 2 },
          { type: "text", text: "Hidden", visible: false, readingOrder: -1 },
        ],
      },
      { type: "text", text: "First", readingOrder: 1 },
      {
        type: "text",
        readingOrder: 3,
        runs: [{ text: "Icon", icon: "star" }, { text: " label" }],
      },
    ],
  };
  assert.equal(accessibleText({}, scene), "First. Nested.  Icon label. Last");
  assert.equal(accessibleText({}, null), "");
});

test("accessible text excludes descendants of hidden ancestors", () => {
  const scene = {
    nodes: [
      { type: "text", text: "Visible", readingOrder: 1 },
      {
        type: "group",
        visible: false,
        children: [
          { type: "text", text: "Hidden child", readingOrder: 2 },
          {
            type: "group",
            children: [
              {
                type: "text",
                text: "Hidden grandchild",
                visible: true,
                readingOrder: 3,
              },
            ],
          },
        ],
      },
      {
        type: "group",
        visible: true,
        children: [{ type: "text", text: "Visible sibling", readingOrder: 0 }],
      },
    ],
  };
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
