import test from "node:test";
import assert from "node:assert/strict";
import { readPsd } from "../src/presentation/node_modules/ag-psd/dist/index.js";
import { parseLayeredSource } from "../src/presentation/layered-source.js";
import { layeredPackage } from "../src/presentation/layered-package.js";
import { writeZip, importPackage } from "../src/presentation/package.js";
import { utf8 } from "../src/presentation/data.js";
import { pngRGBA } from "./presentation-fixtures.mjs";
const bitmap = (w, h, color) => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(
    Array.from({ length: w * h }, () => color).flat(),
  ),
});
const encodeRGBA = async (image) =>
  pngRGBA(image.width, image.height, image.data);
import { sourceFixtures, psdFixture, maskedPsdFixture, oraAlphaFixture } from "./presentation-layered-fixtures.mjs";

async function decodedPsd(bytes, limits) {
  const decoded = [];
  const doc = await parseLayeredSource(bytes, { format: "psd", limits, encodeRGBA: async image => {
    decoded.push({ width: image.width, height: image.height, data: [...image.data] });
    return encodeRGBA(image);
  } });
  return { doc, pixels: decoded.find(image => image.width === 2 && image.height === 1)?.data };
}

test("PSD raster masks multiply soft alpha with offsets, default coverage and density", async () => {
  for (const [mask, alpha] of [
    [{}, [0, 64]],
    [{ defaultColor: 255 }, [128, 64]],
    [{ userMaskDensity: 128 / 255 }, [64, 96]],
    [{ left: 1, top: 0, positionRelativeToLayer: true }, [0, 64]],
    [{ disabled: true }, [128, 128]],
  ]) {
    const { doc, pixels } = await decodedPsd(maskedPsdFixture(mask));
    assert.deepEqual(pixels, [80, 120, 160, alpha[0], 80, 120, 160, alpha[1]]);
    assert.deepEqual([doc.layers[0].x, doc.layers[0].y], [2, 3]);
    assert.deepEqual(doc.report.issues, []);
  }
  const feather = await decodedPsd(maskedPsdFixture({ userMaskFeather: 2 }));
  assert.deepEqual(feather.pixels, [80, 120, 160, 0, 80, 120, 160, 64]);
  assert.deepEqual(feather.doc.report.issues.map(issue => issue.code), ["MASK_FEATHER"]);
});

test("PSD unsupported real mask is reported instead of silently losing coverage", async () => {
  const bytes = maskedPsdFixture({ defaultColor: 255, imageData: bitmap(1, 1, [255, 255, 255, 255]) },
    { left: 2, top: 3, defaultColor: 0, imageData: bitmap(2, 1, [0, 0, 0, 255]) });
  const stored = readPsd(bytes, { useImageData: true, skipThumbnail: true });
  assert.equal(stored.children[0].realMask.imageData.data[0], 0);
  const { doc, pixels } = await decodedPsd(bytes);
  assert.deepEqual(pixels, [80, 120, 160, 128, 80, 120, 160, 128]);
  assert.ok(doc.report.issues.some(issue => issue.layer === "Soft raster" && issue.code === "REAL_MASK"), JSON.stringify(doc.report));
  const disabled = await decodedPsd(maskedPsdFixture({}, { left: 2, top: 3, disabled: true, imageData: bitmap(2, 1, [0, 0, 0, 255]) }));
  assert.deepEqual(disabled.doc.report.issues, []);
  assert.deepEqual(disabled.pixels, [80, 120, 160, 0, 80, 120, 160, 64]);
});

test("PSD and ORA retain supported blend aliases and report unsupported blending and groups", async () => {
  const children = ["normal", "screen", "multiply", "linear dodge", "overlay"].map((blendMode, i) =>
    ({ name: "Mode " + i, blendMode, imageData: bitmap(2, 1, [80, 120, 160, 128]) }));
  const psd = await decodedPsd(psdFixture([{ name: "Approximate group", opacity: 0.5, children }]));
  const ora = oraAlphaFixture(), openRaster = await parseLayeredSource(ora.bytes, { format: "ora", encodeRGBA });
  for (const doc of [psd.doc, openRaster]) {
    const group = doc.layers[0];
    assert.equal(group.type, "group");
    assert.deepEqual(group.children.map(node => node.blend), ["normal", "add", "multiply", "screen", "normal"]);
    assert.deepEqual(doc.report.issues.map(issue => issue.code).sort(), ["BLEND", "GROUP_COMPOSITE"]);
    assert.equal(doc.report.layerCount, 5);
  }
  for (const node of openRaster.layers[0].children) assert.deepEqual(node.bytes, ora.png);
});

test("layer count, nesting and decoded mask pixels enforce small exact boundaries", async () => {
  const image = { name: "Leaf", imageData: bitmap(2, 1, [80, 120, 160, 128]) };
  const nested = psdFixture([{ name: "Group", children: [image] }]);
  await decodedPsd(nested, { layers: 2, depth: 1 });
  await assert.rejects(decodedPsd(nested, { layers: 1 }), { code: "LAYER_LIMIT" });
  await assert.rejects(decodedPsd(nested, { depth: 0 }), { code: "LAYER_LIMIT" });
  const masked = maskedPsdFixture();
  await decodedPsd(masked, { pixels: 39 });
  await assert.rejects(decodedPsd(masked, { pixels: 38 }), { code: "LAYER_LIMIT" });
});
test("PSD, OpenRaster and layer ZIP preserve placement, dimensions, order and opacity", async () => {
  for (const [key, bytes] of Object.entries(sourceFixtures())) {
    const doc = await parseLayeredSource(bytes, {
      format: key === "zip" ? "layer-zip" : key,
      encodeRGBA,
    });
    assert.equal(doc.width, 6);
    assert.equal(doc.height, 8);
    assert.equal(doc.layers.length, 2);
    assert.equal(doc.layers[0].name, "Background");
    assert.equal(doc.layers[1].x, 3);
    assert.equal(doc.layers[1].y, 4);
    assert.equal(doc.report.issues.length, 0);
    if (key !== "zip")
      assert.equal(doc.layers[1].opacity, key === "psd" ? 128 / 255 : 0.5);
    else assert.equal(doc.layers[1].material.kind, "glitter");
    const pkg = await layeredPackage(doc, { poster: doc.merged });
    assert.equal(
      (await importPackage(pkg.archive)).scenes.get("scenes/front.json").nodes
        .length,
      2,
    );
  }
});
test("layered sources reject DTDs, traversal, oversized decode and unsupported PSD bit depth", async () => {
  const fixtures = sourceFixtures();
  await assert.rejects(
    parseLayeredSource(fixtures.psd, {
      format: "psd",
      encodeRGBA,
      limits: { pixels: 1 },
    }),
    /budget/,
  );
  const bad = fixtures.psd.slice();
  new DataView(bad.buffer).setUint16(22, 16);
  await assert.rejects(
    parseLayeredSource(bad, { format: "psd", encodeRGBA }),
    /8-bit/,
  );
  const ora = writeZip(
    new Map([
      ["mimetype", utf8("image/openraster")],
      [
        "stack.xml",
        utf8(
          '<!DOCTYPE image [<!ENTITY x SYSTEM "file:///secret">]><image w="6" h="8"><stack/></image>',
        ),
      ],
    ]),
  );
  await assert.rejects(
    parseLayeredSource(ora, { format: "ora", encodeRGBA }),
    /entities/,
  );
});
