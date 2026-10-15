import {validateFrameworkEvent} from '../src/action-contracts.js';
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/store.js";
import { fixture, admin, code } from "./helpers.js";
import { fixture as art, build } from "./presentation-fixtures.mjs";
import { createProject } from "../src/presentation/project.js";
import {
  createMemoryLibrary,
  saveTemplate,
  loadTemplate,
  previewTemplateMigration,
  applyTemplateMigration,
  configureAuthoring,
} from "../src/presentation/authoring-tools.js";
import {
  exportStatsCSV,
  importStatsCSV,
} from "../src/presentation/stats-csv.js";
import {
  deriveStats,
  resolveCardPolicy,
  inspectCardPolicy,
} from "../src/card-policy.js";
const policy = (fields = [], requirements = {}) => ({
  schemaVersion: 1,
  id: "governance",
  revision: 1,
  name: "Governance",
  fields,
  requirements,
});
function activate(
  core,
  d,
  assignments = [{ scope: "installation", policy: d.id + "@" + d.revision }],
) {
  core.saveCardPolicy(admin, {
    key: crypto.randomUUID(),
    expectedRevision: core.cardPolicies(admin).revision,
    document: d,
  });
  const preview = core.previewCardPolicy(admin, {
    expectedRevision: core.cardPolicies(admin).revision,
    policy: d.id + "@" + d.revision,
    assignments,
  });
  core.activateCardPolicy(admin, { ...preview, key: crypto.randomUUID() });
}
function publish(core, card) {
  const p = core.previewImport(admin, {
    expectedVersion: core.catalog().version,
    source: { cards: [card] },
  });
  return core.commitImport(admin, { ...p, key: crypto.randomUUID() });
}
test("template sets enforce actual structure, retain required dependencies, and restore immutable resources", async () => {
  const { core } = fixture(),
    project = createProject(await build(art())),
    library = createMemoryLibrary();
  const a = await saveTemplate(project, library, { id: "portrait" }),
    b = await saveTemplate(project, library, { id: "alternate" });
  await core.registerCardPresentation(admin, a.archive);
  for (const entry of [a, b])
    core.saveCardResource(admin, {
      key: crypto.randomUUID(),
      expectedRevision: core.cardPolicies(admin).revision,
      resource: { kind: entry.kind, document: entry.document },
    });
  core.saveCardResource(admin, {
    key: "set",
    expectedRevision: 2,
    resource: {
      kind: "template-set",
      document: {
        id: "frames",
        revision: 1,
        name: "Frames",
        templates: [a.key, b.key],
        default: a.key,
      },
    },
  });
  activate(core, {
    ...policy([], { templateSets: ["frames@1"] }),
    defaults: { template: a.key },
  });
  for(const type of ['card-policy.saved','card-policy.activated','card-library.saved','card-presentation.registered']){
    const event=core.events(admin,{limit:1000}).find(row=>row.type===type);assert(event,type);assert.equal(validateFrameworkEvent(event,type),event);assert.equal(event.data.userId,null);
  }
  const e = core.effectiveCardPolicy(admin, { cardId: "dawn" });
  assert.deepEqual(e.policy.requirements.templates, [a.key, b.key]);
  const pkg = await loadTemplate(a);
  await core.registerCardPresentation(admin, pkg.archive);
  const card = {
    ...core.operatorCatalog(admin).cards.find((c) => c.id === "dawn"),
    presentation: {
      contract: "digital-card@0.1",
      digest: pkg.digest,
      baseURL: "https://assets.example/",
    },
  };
  publish(core, card);
  const candidate = createProject(pkg);
  candidate.edit((p) =>
    p.scenes.get(p.manifest.faces.front.scene).nodes.reverse(),
  );
  const issues = inspectCardPolicy(e.policy, {
    card,
    presentation: { manifest: candidate.manifest, scenes: candidate.scenes },
    templates: [a.document, b.document],
  });
  // A one-layer fixture is extended with an overlay to verify exact slot structure.
  candidate.edit((p) =>
    p.scenes
      .get(p.manifest.faces.front.scene)
      .nodes.push({
        id: "overlay",
        type: "text",
        text: "Cover",
        x: 0,
        y: 0,
        width: 30,
        height: 20,
      }),
  );
  assert(
    inspectCardPolicy(e.policy, {
      card,
      presentation: { manifest: candidate.manifest, scenes: candidate.scenes },
      templates: [a.document],
    }).some((i) => i.code === "TEMPLATE_STRUCTURE"),
  );
  assert.throws(
    () =>
      core.retireCardResource(admin, {
        key: "retire",
        expectedRevision: core.cardPolicies(admin).revision,
        kind: "template-set",
        reference: "frames@1",
      }),
    code("LIBRARY_IN_USE"),
  );
  activate(core, { ...policy(), revision: 2 });
  core.retireCardResource(admin, {
    key: "retire-unused",
    expectedRevision: core.cardPolicies(admin).revision,
    kind: "template-set",
    reference: "frames@1",
  });
  assert.deepEqual(
    core.effectiveCardPolicy(admin, { cardId: "dawn" }).policy.requirements,
    {},
  );
  core.restoreCardResource(admin, {
    key: "restore",
    expectedRevision: core.cardPolicies(admin).revision,
    kind: "template-set",
    reference: "frames@1",
  });
  assert.equal(
    core.cardPolicies(admin).resources.find((r) => r.kind === "template-set")
      .retired,
    false,
  );
});
test("copy metadata uses pinned schemas, source permissions, concurrency and immutable issuance values", () => {
  const { core, open, alice, bob } = fixture();
  activate(
    core,
    policy([
      {
        key: "level",
        label: "Level",
        type: "integer",
        scope: "copy",
        source: "provider",
        required: true,
        default: 1,
        maximum: 10,
      },
      {
        key: "private",
        label: "Owner note",
        type: "string",
        scope: "copy",
        source: "provider",
        visibility: "owner",
        default: "initial",
      },
      {
        key: "audit",
        label: "Audit",
        type: "integer",
        scope: "copy",
        source: "admin",
        visibility: "operator",
        default: 0,
      },
    ]),
  );
  const card = core.operatorCatalog(admin).cards.find((c) => c.id === "dawn");
  publish(core, { ...card, name: card.name + " revision" });
  const copy = open()[0];
  assert.equal(copy.stats.level, 1);
  assert.equal(copy.stats.private, "initial");
  assert.equal(copy.stats.audit, undefined);
  assert.throws(
    () =>
      core.updateCopyStats(alice, {
        key: "denied",
        copyId: copy.id,
        expectedVersion: copy.version,
        values: { level: 2 },
      }),
    code("FORBIDDEN"),
  );
  const provider = {
    userId: alice.userId,
    permissions: ["card-stats.provide"],
  };
  const update = {
    key: "level-update",
    copyId: copy.id,
    expectedVersion: copy.version,
    values: { level: 2 },
  };
  const result = core.updateCopyStats(provider, update);
  assert.deepEqual(core.updateCopyStats(provider, update), result);
  assert.equal(core.inspectCard(alice, copy.id).issuedStats.level, 1);
  assert.equal(core.inspectCard(alice, copy.id).stats.level, 2);
  assert.throws(
    () =>
      core.updateCopyStats(provider, {
        ...update,
        key: "stale",
        values: { level: 3 },
      }),
    code("STALE_VERSION"),
  );
  assert.throws(
    () =>
      core.updateCopyStats(provider, {
        ...update,
        key: "admin",
        expectedVersion: result.version,
        values: { audit: 1 },
      }),
    code("FORBIDDEN"),
  );
  const album = core.saveAlbum(alice, {
    key: "album",
    name: "Public",
    visibility: "public",
    placements: [{ copyId: copy.id, x: 0, y: 0, width: 100, height: 140 }],
  });
  assert(
    !JSON.stringify(core.viewAlbum(bob, album.id)).includes(
      '"private":"initial"',
    ),
  );
});
test("private values stay hidden after field removal and cannot accidentally be republished as public", () => {
  const { core } = fixture();
  activate(
    core,
    policy([
      {
        key: "secret",
        label: "Secret",
        type: "string",
        visibility: "operator",
      },
    ]),
  );
  let card = core.operatorCatalog(admin).cards[0];
  publish(core, { ...card, stats: { secret: "retained" } });
  activate(core, { ...policy(), revision: 2 });
  assert.equal(core.catalog().cards[0].stats.secret, undefined);
  card = core.operatorCatalog(admin).cards[0];
  assert.throws(
    () => publish(core, { ...card, name: "Changed" }),
    code("CARD_POLICY"),
  );
});

test("catalog publication rechecks current grants after review and before receipt replay", (t) => {
  const store = new MemoryStore(), { core, alice } = fixture({ store });
  t.after(() => core.close());
  activate(core, policy([{ key: "level", label: "Level", type: "integer", minimum: 0, maximum: 10 }]));
  const grants = ["catalog.read", "catalog.preview", "catalog.publish"],
    publisher = { ...alice, permissions: [...grants] },
    catalog = core.operatorCatalog(publisher),
    card = { ...catalog.cards[0], name: "Reviewed governed card", stats: { level: 5 } },
    preview = core.previewImport(publisher, { source: { cards: [card] }, expectedVersion: catalog.version }),
    input = { ...preview, key: "reviewed-publication" },
    before = store.read((state) => state);
  publisher.permissions = ["catalog.read", "catalog.preview"];
  assert.throws(() => core.commitImport(publisher, input), code("FORBIDDEN"));
  assert.deepEqual(store.read((state) => state), before);
  publisher.permissions = [...grants];
  const receipt = core.commitImport(publisher, input), committed = store.read((state) => state);
  assert.equal(receipt.version, catalog.version + 1);
  assert.equal(committed.catalog.cards.find((candidate) => candidate.id === card.id).stats.level, 5);
  assert.equal(committed.events.filter((event) => event.type === "catalog.imported").length, before.events.filter((event) => event.type === "catalog.imported").length + 1);
  publisher.permissions = [];
  assert.throws(() => core.commitImport(publisher, input), code("FORBIDDEN"));
  assert.deepEqual(store.read((state) => state), committed);
  publisher.permissions = [...grants];
  assert.deepEqual(core.commitImport(publisher, input), receipt);
  assert.deepEqual(store.read((state) => state), committed);
  assert.equal(core.audit(admin).ok, true);
});
test("catalog review rejects a permitted dependency registry revision change without consuming its key", async (t) => {
  const store = new MemoryStore(), { core } = fixture({ store }),
    entry = await saveTemplate(createProject(await build(art())), createMemoryLibrary(), { id: "review-frame" });
  t.after(() => core.close());
  await core.registerCardPresentation(admin, entry.archive);
  core.saveCardResource(admin, { key: "frame-one", expectedRevision: core.cardPolicies(admin).revision, resource: { kind: "template", document: entry.document } });
  activate(core, policy([], { templates: [entry.key] }));
  const applied = await loadTemplate(entry);
  await core.registerCardPresentation(admin, applied.archive);
  const catalog = core.operatorCatalog(admin), card = { ...catalog.cards[0], name: "Reviewed dependency", presentation: {
    contract: "digital-card@0.1", digest: applied.digest, baseURL: "https://assets.example/",
  } }, source = { cards: [card] },
    preview = core.previewImport(admin, { source, expectedVersion: catalog.version }),
    input = { ...preview, key: "dependency-review" };
  core.saveCardResource(admin, { key: "frame-two", expectedRevision: core.cardPolicies(admin).revision,
    resource: { kind: "template", document: { ...entry.document, revision: entry.document.revision + 1 } } });
  const changed = store.read((state) => state);
  assert.equal(core.cardPolicies(admin).revision, preview.policyRevision + 1);
  assert.throws(() => core.commitImport(admin, input), code("POLICY_CHANGED"));
  assert.deepEqual(store.read((state) => state), changed);
  const refreshed = core.previewImport(admin, { source, expectedVersion: catalog.version }),
    receipt = core.commitImport(admin, { ...refreshed, key: input.key }), committed = store.read((state) => state);
  assert.equal(receipt.version, catalog.version + 1);
  assert.equal(committed.events.filter((event) => event.type === "catalog.imported").length, changed.events.filter((event) => event.type === "catalog.imported").length + 1);
  assert.deepEqual(core.commitImport(admin, { ...refreshed, key: input.key }), receipt);
  assert.deepEqual(store.read((state) => state), committed);
  assert.equal(core.audit(admin).ok, true);
});
test("calculated fields discard supplied dependent values and cannot reveal private inputs", () => {
  const fields = [
    {
      key: "total",
      label: "Total",
      type: "number",
      source: "calculated",
      calculate: ["add", ["field", "double"], 1],
    },
    {
      key: "double",
      label: "Double",
      type: "number",
      source: "calculated",
      calculate: ["mul", ["field", "base"], 2],
    },
    { key: "base", label: "Base", type: "number" },
  ];
  assert.equal(
    deriveStats(fields, { base: 3, double: 100, total: 100 }).total,
    7,
  );
  const d = policy([
    { key: "secret", label: "Secret", type: "number", visibility: "operator" },
    {
      key: "public",
      label: "Public",
      type: "number",
      source: "calculated",
      calculate: ["mul", ["field", "secret"], 2],
    },
  ]);
  assert.throws(
    () =>
      resolveCardPolicy(
        [d],
        [{ scope: "installation", policy: "governance@1" }],
        {},
      ),
    code("PRIVATE_CALCULATION"),
  );
});
test("CSV changes are typed and atomic; template migrations are reviewed and stale drafts reject", async () => {
  const project = createProject(await build(art()));
  configureAuthoring(project, {
    policy: {
      defaults: {},
      fields: [
        { key: "zero", label: "Zero", type: "integer", required: true },
        { key: "nullable", label: "Nullable", type: "string", nullable: true },
      ],
    },
  });
  importStatsCSV(project, "scope,key,value\ncard,zero,0\ncard,nullable,null");
  assert.equal(project.manifest.authoring.values.card.zero, 0);
  assert.equal(project.manifest.authoring.values.card.nullable, null);
  assert.equal(exportStatsCSV(project).includes('"0"'), true);
  assert.throws(
    () =>
      importStatsCSV(project, "scope,key,value\ncard,zero,2\ncard,unknown,3"),
    code("STAT_AUTHORITY"),
  );
  assert.equal(project.manifest.authoring.values.card.zero, 0);
  const entry = await saveTemplate(project, createMemoryLibrary(), {
    id: "migration",
  });
  const preview = await previewTemplateMigration(project, entry);
  project.edit((p) => (p.manifest.title = "Changed after review"));
  await assert.rejects(
    () => applyTemplateMigration(project, preview),
    code("STALE_DRAFT"),
  );
  const current = await previewTemplateMigration(project, entry);
  await applyTemplateMigration(project, current);
  assert.equal(project.manifest.authoring.template, entry.key);
  assert(project.undoEdit());
});
