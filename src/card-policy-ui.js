import {createLocalization} from "./localization.js";
import { validatePolicy } from "./card-policy.js";
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
export function mountCardPolicyAdmin(root, { client,locale,messages,localization }) {
  const l=localization??createLocalization({locale,messages}),t=l.text;
  const originalLang=root.getAttribute("lang"),originalDir=root.getAttribute("dir");root.lang=l.locale;root.dir=l.dir;
  root.classList.add("dcs-policy-admin");
  let registry,
    preview,
    disposed = false,
    version = 0;
  const events = new AbortController(),
    status = el("p"),
    editor = el("textarea"),
    assignments = el("textarea"),
    selection = el("select"),
    history = el("div"),
    impact = el("div"),
    review = el("input");
  status.setAttribute("role", "status");
  editor.rows = 20;
  assignments.rows = 5;
  editor.setAttribute("aria-label", t("policyUI.policyDocument"));
  assignments.setAttribute("aria-label", t("policyUI.policyAssignments"));
  selection.setAttribute("aria-label", t("policyUI.savedPolicyRevision"));
  review.type = "checkbox";
  const checkbox = el("label");
  checkbox.append(
    review,
    el("span", t("policyUI.iReviewedThePolicyChangesAndAffectedCards")),
  );
  const activate = el("button", t("policyUI.activateReviewedPolicy"));
  activate.type = "button";
  activate.disabled = true;
  const draft = () => ({
    schemaVersion: 1,
    id: "cards.standard",
    revision: 1,
    name: "Standard cards",
    inherits: [],
    defaults: {},
    fields: [
      {
        key: "custom.value",
        label: "Value",
        type: "integer",
        scope: "card",
        visibility: "public",
        source: "author",
        required: true,
        minimum: 0,
        maximum: 999,
      },
    ],
    requirements: { allowUnknownStats: true },
  });
  const parse = () => validatePolicy(JSON.parse(editor.value));
  const invalidate = () => {
    version++;
    preview = null;
    review.checked = false;
    activate.disabled = true;
    impact.replaceChildren();
  };
  function action(fn) {
    return async () => {
      try {
        status.textContent = t("policyUI.working");
        await fn();
      } catch (e) {
        if (!disposed) status.textContent = e.message;
      }
    };
  }
  function button(label, fn) {
    const b = el("button", label);
    b.type = "button";
    b.addEventListener("click", action(fn), { signal: events.signal });
    return b;
  }
  async function refresh() {
    registry = await client.cardPolicies();
    if (disposed) return;
    selection.replaceChildren(el("option", t("policyUI.chooseSavedPolicy")));
    for (const row of registry.documents) {
      const d = row.document,
        o = el(
          "option",
          t('policyUI.savedRevision',{name:d.name,id:d.id,revision:d.revision,state:t('policyUI.state.'+row.state)}),
        );
      o.value = d.id + "@" + d.revision;
      selection.append(o);
    }
    assignments.value = JSON.stringify(registry.assignments, null, 2);
    history.replaceChildren(el("h3", t("policyUI.policyHistory")));
    for (const row of registry.history.slice(-20).reverse())
      history.append(
        el("p", t('policyUI.historyRevision',{revision:row.revision,type:t('policyUI.history.'+row.type),date:l.date(row.at)})),
      );
    status.textContent = t('policyUI.libraryRevision',{revision:registry.revision});
    libraryRows.replaceChildren();
    for (const item of registry.resources) {
      const row = el(
        "p",
        t('policyUI.resourceRevision',{name:item.document.name,kind:t('policyUI.kind.'+item.kind),id:item.document.id,revision:item.document.revision})+' ',
      );
      row.append(
        button(
          item.retired ? t("policyUI.restoreResource") : t("policyUI.retireResource"),
          async () => {
            await client[
              item.retired ? "restoreCardResource" : "retireCardResource"
            ]({
              key: crypto.randomUUID(),
              expectedRevision: registry.revision,
              kind: item.kind,
              reference: item.document.id + "@" + item.document.revision,
            });
            invalidate();
            await refresh();
          },
        ),
      );
      libraryRows.append(row);
    }
  }
  root.append(
    el("h2", t("policyUI.administratorCardPolicies")),
    el(
      "p",
      t("policyUI.defaultsStartADraftRequiredRulesAndFixed"),
    ),
    selection,
    editor,
    el("h3", t("policyUI.assignments")),
    el(
      "p",
      t("policyUI.assignAnActiveRevisionToInstallationLineCardType"),
    ),
    assignments,
  );
  selection.addEventListener(
    "change",
    () => {
      const row = registry.documents.find(
        (x) => x.document.id + "@" + x.document.revision === selection.value,
      );
      if (row) {
        editor.value = JSON.stringify(row.document, null, 2);
        invalidate();
      }
    },
    { signal: events.signal },
  );
  for (const e of [editor, assignments])
    e.addEventListener("input", invalidate, { signal: events.signal });
  review.addEventListener(
    "change",
    () => (activate.disabled = !preview || !review.checked),
    { signal: events.signal },
  );
  root.append(
    button(t("policyUI.newPolicyDraft"), () => {
      editor.value = JSON.stringify(draft(), null, 2);
      invalidate();
      status.textContent = t("policyUI.newDraftChooseAUniquePolicyID");
    }),
    button(t("policyUI.createNextRevision"), () => {
      const d = parse();
      d.revision =
        Math.max(
          ...registry.documents
            .filter((r) => r.document.id === d.id)
            .map((r) => r.document.revision),
          d.revision,
        ) + 1;
      editor.value = JSON.stringify(d, null, 2);
      invalidate();
      status.textContent = t("policyUI.newRevisionPrepared");
    }),
    button(t("policyUI.validatePolicyDocument"), () => {
      parse();
      status.textContent =
        t("policyUI.documentStructureIsValidImpactPreviewChecksAssignments");
    }),
    button(t("policyUI.savePolicyDraft"), async () => {
      const d = parse();
      await client.saveCardPolicy({
        key: crypto.randomUUID(),
        expectedRevision: registry.revision,
        document: d,
      });
      invalidate();
      await refresh();
      selection.value = d.id + "@" + d.revision;
    }),
    button(t("policyUI.previewPolicyImpact"), async () => {
      const d = parse();
      const saved = registry.documents.find(
        (r) => r.document.id === d.id && r.document.revision === d.revision,
      );
      if (JSON.stringify(saved?.document) !== JSON.stringify(d))
        throw new Error(
          t("policyUI.saveTheCurrentDocumentBeforePreviewingItsActivation"),
        );
      const previous = registry.documents
        .filter(
          (r) => r.document.id === d.id && r.document.revision < d.revision,
        )
        .sort((a, b) => b.document.revision - a.document.revision)[0]?.document;
      const current = version,
        result = await client.previewCardPolicy({
          expectedRevision: registry.revision,
          policy: d.id + "@" + d.revision,
          assignments: JSON.parse(assignments.value),
        });
      if (disposed || current !== version) return;
      preview = result;
      impact.replaceChildren(
        el(
          "h3",
          t('policyUI.affectedVariants',{count:result.affected.length}),
        ),
        el(
          "p",
          t("policyUI.existingPublishedCardsAndOwnedCopiesRetainTheir"),
        ),
      );
      const diff = el(
        "pre",
        ["defaults", "fields", "requirements", "inherits"]
          .filter((k) => JSON.stringify(previous?.[k]) !== JSON.stringify(d[k]))
          .map(
            (k) =>
              t("policyUI.diff."+k) +
              "\n" + t("policyUI.before") + ": " +
              JSON.stringify(previous?.[k] ?? null) +
              "\n" + t("policyUI.after") + ": " +
              JSON.stringify(d[k] ?? null),
          )
          .join("\n\n"),
      );
      impact.append(diff);
      for (const item of result.affected) {
        const details = el("details");
        details.append(el("summary", item.cardId + " · " + item.variantId));
        for (const issue of item.issues)
          details.append(el("p", issue.path + ": " + issue.message));
        impact.append(details);
      }
      status.textContent = t("policyUI.reviewTheImpactBeforeActivation");
    }),
    checkbox,
    activate,
    button(t("policyUI.retireSelectedRevision"), async () => {
      const d = parse();
      await client.retireCardPolicy({
        key: crypto.randomUUID(),
        expectedRevision: registry.revision,
        policy: d.id + "@" + d.revision,
        reason: "Retired through policy administration",
      });
      invalidate();
      await refresh();
    }),
    button(t("policyUI.restoreRetiredRevision"), async () => {
      const d = parse();
      await client.restoreCardPolicy({
        key: crypto.randomUUID(),
        expectedRevision: registry.revision,
        policy: d.id + "@" + d.revision,
      });
      invalidate();
      await refresh();
    }),
    button(t("policyUI.exportPolicyDocument"), () => {
      const d = parse(),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
        ),
        a = el("a");
      a.href = url;
      a.download = d.id + "-" + d.revision + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
    button(t("policyUI.importPolicyAsDraft"), () => {
      const input = el("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = action(async () => {
        const file = input.files[0];
        if (!file || file.size > 262144)
          throw new Error(t('policyUI.importSize',{size:256}));
        const d = validatePolicy(JSON.parse(await file.text()));
        editor.value = JSON.stringify(d, null, 2);
        invalidate();
        status.textContent =
          t("policyUI.importedForReviewSaveTheDraftBeforeActivation");
      });
      input.click();
    }),
    button(t("policyUI.reloadPolicies"), refresh),
    status,
    impact,
    history,
  );
  activate.addEventListener(
    "click",
    action(async () => {
      if (!preview || !review.checked)
        throw new Error(t("policyUI.reviewTheCurrentImpactFirst"));
      await client.activateCardPolicy({
        ...preview,
        key: crypto.randomUUID(),
        reason: "Activated after impact review",
      });
      invalidate();
      await refresh();
    }),
    { signal: events.signal },
  );
  const libraryRows = el("div"),
    resourceEditor = el("textarea");
  resourceEditor.rows = 8;
  resourceEditor.setAttribute("aria-label", t("policyUI.sharedLibraryResourceDocument"));
  resourceEditor.value = JSON.stringify(
    {
      kind: "template-set",
      document: {
        id: "frames.standard",
        revision: 1,
        name: "Standard frames",
        templates: ["portrait@1"],
        default: "portrait@1",
      },
    },
    null,
    2,
  );
  root.append(
    el("h3", t("policyUI.sharedTemplateSetsAndResources")),
    el(
      "p",
      t("policyUI.saveTemplatesMasksAndStylesFromTheEditor"),
    ),
    resourceEditor,
    button(t("policyUI.saveSharedResourceRevision"), async () => {
      await client.saveCardResource({
        key: crypto.randomUUID(),
        expectedRevision: registry.revision,
        resource: JSON.parse(resourceEditor.value),
      });
      invalidate();
      await refresh();
    }),
    libraryRows,
  );
  editor.value = JSON.stringify(draft(), null, 2);
  const ready = refresh().catch((e) => (status.textContent = e.message));
  return {
    ready,
    dispose() {
      disposed = true;
      version++;
      events.abort();
      root.replaceChildren();
      for(const [name,value] of [["lang",originalLang],["dir",originalDir]])if(value===null)root.removeAttribute(name);else root.setAttribute(name,value);
    },
  };
}
