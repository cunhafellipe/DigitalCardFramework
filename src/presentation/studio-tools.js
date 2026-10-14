import {createLocalization} from '../localization.js';
import {
  addText,
  configureAuthoring,
  setStat,
  addStatBlock,
  transformSelection,
  createLocalLibrary,
  saveTemplate,
  loadTemplate,
  saveMask,
  applyMask,
  saveTextStyle,
  applyTextStyle,
  previewTemplateMigration,
  applyTemplateMigration,
} from "./authoring-tools.js";
import { exportStatsCSV, importStatsCSV } from "./stats-csv.js";
import {
  flattenNodes,
  validateField,
  valueError,
  inspectCardPolicy,
} from "../card-policy.js";
import {
  textValue,
  inspectFont,
  fontMeasure,
  layoutText,
  fontDiagnostics,
} from "./text.js";
import { importPackage } from "./package.js";
import {createEditorContributions} from './editor-contributions.js';

const el = (tag, text) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
export function mountAuthoringTools({
  locale='en',messages={},localization=createLocalization({locale,messages}),
  toolbar,
  getProject,
  getSide,
  getSelected,
  select,
  rebuild,
  open,
  report,
  schedule,
  library = createLocalLibrary(),
  policyProvider,
  context = {},
  panels = [],
  editorContributions = [],
  editorContributionGrants,
  editorTransforms,
}) {
  const t=(key,values)=>localization.text(key,values),number=value=>localization.number(value);
  let portablePanels,portablePanelError=null;
  try{portablePanels=createEditorContributions(editorContributions,{grants:editorContributionGrants});}
  catch{portablePanels=createEditorContributions();portablePanelError=t('studioTools.anEditorContributionWasRejectedTheOrdinaryEditor');}
  let entries = [],
    effective = null,
    clipboard = null,
    disposed = false,
    selection = new Set(),
    generation = 0;
  const root = el("section"),
    status = el("p");
  root.className = "dcs-authoring";root.lang=localization.locale;root.dir=localization.dir;
  status.setAttribute("role", "status");
  const pending = new Set();
  let taskTail = Promise.resolve();
  let fontsExpanded = false;
  const fontSamples = new Map();
  const expandedSpans = new Set();
  const expandedMasks = new Set();
  let mountedPanels = [];
  const transformStates=new Map();let transformProject=null,transformGeneration=0,authoringRenderGeneration=0;
  function clearTransforms(){transformGeneration++;for(const state of transformStates.values())if(state.requestId)editorTransforms?.discard(state.requestId);transformStates.clear();}
  const disposePanels = () => {
    for (const panel of mountedPanels) panel.dispose?.();
    mountedPanels = [];
  };
  function run(fn) {
    const enqueue = schedule ?? (work => (taskTail = taskTail.catch(()=>{}).then(work)));
    const task = enqueue(() => disposed ? undefined : fn())
      .catch((e) => { if (!disposed) report(e.message); })
      .finally(() => pending.delete(task));
    pending.add(task);
    return task;
  }
  function button(parent, label, fn) {
    const b = el("button", label);
    b.type = "button";
    b.onclick = () => run(fn);
    parent.append(b);
    return b;
  }
  const optionKeys={"normal": "studioTools.optionNormal", "italic": "studioTools.optionItalic", "oblique": "studioTools.optionOblique", "left": "studioTools.optionLeft", "center": "studioTools.optionCenter", "right": "studioTools.optionRight", "start": "studioTools.optionStart", "end": "studioTools.optionEnd", "top": "studioTools.optionTop", "middle": "studioTools.optionMiddle", "bottom": "studioTools.optionBottom", "wrap": "studioTools.optionWrap", "shrink": "studioTools.optionShrink", "ellipsis": "studioTools.optionEllipsis", "clip": "studioTools.optionClip", "grow": "studioTools.optionGrow", "auto": "studioTools.optionAuto", "ltr": "studioTools.optionLtr", "rtl": "studioTools.optionRtl", "text": "studioTools.optionText", "badge": "studioTools.optionBadge", "bar": "studioTools.optionBar", "false": "studioTools.optionFalse", "true": "studioTools.optionTrue", "card": "studioTools.optionCard", "variant": "studioTools.optionVariant", "copy": "studioTools.optionCopy", "public": "studioTools.optionPublic", "owner": "studioTools.optionOwner", "operator": "studioTools.optionOperator", "author": "studioTools.optionAuthor", "integer": "studioTools.optionInteger", "number": "studioTools.optionNumber", "string": "studioTools.optionString", "boolean": "studioTools.optionBoolean", "array": "studioTools.optionArray", "object": "studioTools.optionObject", "optional": "studioTools.optionOptional", "required": "studioTools.optionRequired", "no": "studioTools.optionNo", "yes": "studioTools.optionYes", "template": "studioTools.optionTemplate", "template-set": "studioTools.optionTemplateSet", "mask": "studioTools.optionMask", "style": "studioTools.optionStyle", "updated": "studioTools.optionUpdated", "added": "studioTools.optionAdded", "removed": "studioTools.optionRemoved", "front": "studioTools.optionFront", "back": "studioTools.optionBack"};
  const propertyKeys={"x": "studioTools.propertyX", "y": "studioTools.propertyY", "width": "studioTools.propertyWidth", "height": "studioTools.propertyHeight", "rotation": "studioTools.propertyRotation", "scaleX": "studioTools.propertyScaleX", "scaleY": "studioTools.propertyScaleY", "pivotX": "studioTools.propertyPivotX", "pivotY": "studioTools.propertyPivotY"};
  const optionLabel=value=>optionKeys[value]?t(optionKeys[value]):value;
  const propertyLabel=value=>propertyKeys[value]?t(propertyKeys[value]):value;
  function input(
    parent,
    label,
    value,
    fn,
    { type = "text", choices, disabled = false } = {},
  ) {
    const wrap = el("label", label),
      e = el(choices ? "select" : type === "textarea" ? "textarea" : "input");
    e.setAttribute("aria-label", label);
    if (choices)
      for (const choice of choices) {
        const o = el("option", choice.name ?? optionLabel(String(choice)));
        o.value = choice.id ?? String(choice);
        e.append(o);
      }
    else if (type !== "textarea") e.type = type;
    e.value = String(value ?? "");
    e.disabled = disabled;
    e.onchange = () =>
      run(async () => {
        await fn(e.value);
      });
    wrap.append(e);
    parent.append(wrap);
    return e;
  }
  async function edit(fn) {
    if (disposed) return;
    const p = getProject();
    if (!p) throw new Error(t('studioTools.openACardFirst'));
    try {
      p.edit(fn);
    } catch (error) {
      await rebuild();
      throw error;
    }
    return rebuild();
  }
  function chosen() {
    return selection.size ? [...selection] : [getSelected()].filter(Boolean);
  }
  function renderTransforms(project){
    if(!editorTransforms)return;
    if(transformProject!==project){clearTransforms();transformProject=project;}
    const section=el('section');section.className='dcs-editor-transforms';section.append(el('h3',t('studioTools.externalEditorTransforms')),el('p',t('studioTools.exportARequestRunTheInstalledToolOutside')));root.append(section);
    for(const tool of editorTransforms.tools){
      const state=transformStates.get(tool.id)??{parameters:Object.fromEntries(Object.entries(tool.parameters).map(([key,rule])=>[key,rule.default]))};transformStates.set(tool.id,state);
      const fieldset=el('fieldset');fieldset.append(el('legend',tool.title));section.append(fieldset);const cycle=authoringRenderGeneration,sameJob=()=>!disposed&&getProject()===project&&transformProject===project&&transformStates.get(tool.id)===state,current=()=>sameJob()&&cycle===authoringRenderGeneration;
      for(const [key,rule]of Object.entries(tool.parameters)){
        const wrap=el('label',rule.label),control=el('input');control.setAttribute('aria-label',rule.label);
        if(rule.type==='boolean'){control.type='checkbox';control.checked=state.parameters[key];}else{control.type=rule.type==='number'?'number':'text';control.value=String(state.parameters[key]);if(rule.type==='number'){control.min=String(rule.minimum);control.max=String(rule.maximum);control.step=String(rule.step);}else control.maxLength=rule.maxLength;}
        control.disabled=!!state.busy;control.onchange=()=>{if(!current()||state.busy)return;state.parameters[key]=rule.type==='boolean'?control.checked:rule.type==='number'?control.valueAsNumber:control.value;if(state.requestId){editorTransforms.discard(state.requestId);delete state.requestId;delete state.review;render();}};wrap.append(control);fieldset.append(wrap);
      }
      const exportButton=button(fieldset,t('studioTools.exportTransformRequest'),async()=>{
        if(!sameJob()){state.busy=false;return;}const generation=transformGeneration;if(state.requestId)editorTransforms.discard(state.requestId);delete state.requestId;delete state.review;
        try{const prepared=await editorTransforms.prepare(project,{toolId:tool.id,parameters:{...state.parameters}});if(!sameJob()||generation!==transformGeneration){editorTransforms.discard(prepared.requestId);return;}state.requestId=prepared.requestId;const url=URL.createObjectURL(new Blob([prepared.archive],{type:'application/zip'})),link=el('a');link.href=url;link.download=tool.id+'.job';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);report(t('studioTools.transformRequestExportedRunTheExternalToolThen'));}
        finally{state.busy=false;if(sameJob())render();}
      });
      exportButton.disabled=!!state.busy;const queuedExport=exportButton.onclick;exportButton.onclick=()=>{if(!current()||state.busy)return;state.busy=true;exportButton.disabled=true;queuedExport();};
      const upload=button(fieldset,t('studioTools.importTransformResult'),()=>{
        if(!current()||!state.requestId||state.busy)return;const requestId=state.requestId,generation=transformGeneration,file=el('input');file.type='file';file.accept='.result,.zip';
        file.onchange=()=>{if(!current()||state.busy)return;const selected=file.files?.[0];if(!selected)return;state.busy=true;delete state.review;render();run(async()=>{
          if(!sameJob()||generation!==transformGeneration||state.requestId!==requestId){state.busy=false;return;}
          try{if(selected.size>80*1024*1024+65536+4096)throw new Error(t('studioTools.transformResultExceedsItsBudget'));const archive=new Uint8Array(await selected.arrayBuffer());if(!sameJob()||generation!==transformGeneration||state.requestId!==requestId)return;const review=await editorTransforms.review(project,requestId,archive);if(!sameJob()||generation!==transformGeneration||state.requestId!==requestId)return;state.review=review;report(t('studioTools.transformResultReviewedInspectTheChangesBeforeApplying'));}
          finally{state.busy=false;if(sameJob())render();}
        });};file.click();
      });upload.disabled=!state.requestId||!!state.busy;
      if(state.review){fieldset.append(el('p',t('studioTools.reviewedChanges',{scenes:t('studioTools.changedScenes',{count:state.review.changes.scenes.length}),assets:t('studioTools.newRasters',{count:state.review.changes.addedAssets.length})})));const details=el('ul');for(const path of state.review.changes.scenes)details.append(el('li',t('studioTools.sceneReference',{path})));for(const id of state.review.changes.addedAssets)details.append(el('li',t('studioTools.assetReference',{id})));fieldset.append(details);const reviewed=state.review,previewRoot=el('div');previewRoot.className='dcs-transform-preview';Object.assign(previewRoot.style,{width:'240px',height:'360px',position:'relative'});fieldset.append(previewRoot);const apply=button(fieldset,t('studioTools.applyReviewedTransform'),async()=>{if(!current()||state.review!==reviewed)return;editorTransforms.apply(project,reviewed);delete state.requestId;delete state.review;await rebuild();if(sameJob())report(t('studioTools.reviewedTransformAppliedUseUndoToRestoreThe'));});apply.disabled=true;
        try{const preview=editorTransforms.mountReview(project,reviewed,{root:previewRoot,side:tool.grants.faces[0]});mountedPanels.push(preview);preview.ready.then(result=>{if(!current()||state.review!==reviewed)return;if(result.mode==='interactive')apply.disabled=false;else report(t('studioTools.theTransformedSceneCouldNotBePreviewedNothing'));}).catch(()=>{if(current())report(t('studioTools.theTransformPreviewIsStaleOrUnavailableNothing'));});}catch{report(t('studioTools.theTransformPreviewIsStaleOrUnavailableNothing'));}
      }
      if(state.requestId)button(fieldset,t('studioTools.discardTransformRequest'),()=>{if(!current())return;editorTransforms.discard(state.requestId);delete state.requestId;delete state.review;render();});
    }
  }
  async function loadEntries() {
    const n = ++generation;
    const list = await library.list();
    if (!disposed && n === generation) entries = list;
  }
  async function refreshPolicy() {
    const p = getProject();
    if (!p) return;
    if (policyProvider) {
      effective = await policyProvider({
        ...context,
        ...p.manifest.authoring?.context,
      });
      configureAuthoring(p, {
        policy: effective.policy,
        policyRevision: effective.revision,
        context: effective.context ?? {
          ...context,
          ...p.manifest.authoring?.context,
        },
      });
    }
    await rebuild();
  }
  button(toolbar, t('studioTools.addText'), async () => {
    select(
      addText(
        getProject(),
        getSide(),
        effective?.policy.defaults.typography
          ? { typography: effective.policy.defaults.typography }
          : {},
      ),
    );
    await rebuild();
  });
  button(toolbar, t('studioTools.addCustomFont'), async () => {
    const f = el("input");
    f.type = "file";
    f.accept = ".woff2,.woff,.ttf,.otf";
    f.onchange = () =>
      run(async () => {
        const file = f.files[0];
        if (!file) return;
        const project = getProject(), face = getSide(), selected = getSelected(), dialog = el("dialog");
        dialog.append(el("h3", t('studioTools.embedCustomFont')), el("p", t('studioTools.fileBytes',{name:file.name,size:file.size})),
          el("p", t('studioTools.recordThePermittedUsageTermsOrLicenseIdentifier')));
        let license = "";
        const terms = input(dialog, t('studioTools.fontUsageTerms'), "", (v)=>{
          license = v.trim();
          save.disabled = !license;
        }, {type:"textarea"});
        terms.maxLength = 2000;
        const save = button(dialog, t('studioTools.embedFontWithDeclaredTerms'), async()=>{
          if (!license || license.length > 2000) throw new Error(t('studioTools.enterFontUsageTermsWithin2000Characters'));
          if (getProject() !== project) throw new Error(t('studioTools.theCardChangedDuringFontUpload'));
          const asset = await project.addFont(file,{license});
          if (disposed || getProject() !== project) return;
          const node = flattenNodes(project.scenes.get(project.manifest.faces[face].scene).nodes).find(n=>n.id===selected);
          if (node?.type === "text" && !node.locked) project.edit(()=>{
            node.typography ??= {};
            node.typography.fontAsset = asset.id;
          });
          dialog.close(); dialog.remove();
          await rebuild();
          report(t('studioTools.fontAdded',{family:asset.font.family,notice:node?.locked?t('studioTools.lockedFontNotice'):''}));
        });
        save.disabled = true;
        button(dialog, t('studioTools.cancelFontUpload'), ()=>{dialog.close();dialog.remove();});
        root.append(dialog);
        dialog.showModal();
        terms.focus();
      });
    f.click();
  });
  button(toolbar, t('studioTools.textStatsTemplates'), async () => {
    root.hidden = !root.hidden;
    if (!root.hidden) {
      await loadEntries();
      render();
    }
  });
  root.hidden = false;
  function render() {
    if (disposed) return;
    authoringRenderGeneration++;
    disposePanels();
    const p = getProject();
    root.replaceChildren(el("h2", t('studioTools.textStatsTemplates')));
    if(portablePanelError)root.append(el('p',portablePanelError));
    if (!p) {
      if(transformProject){clearTransforms();transformProject=null;}
      root.append(el("p", t('studioTools.openACardToEdit')));
      return;
    }
    renderTransforms(p);
    const fontCache = new Map();
    const nodes = flattenNodes(
        p.scenes.get(p.manifest.faces[getSide()].scene).nodes,
      ),
      n = nodes.find((x) => x.id === getSelected());
    const layout = el("details");
    layout.append(el("summary", t('studioTools.arrangeLayers')));
    root.append(layout);
    for (const node of nodes) {
      const label = el("label"),
        check = el("input");
      check.type = "checkbox";
      check.setAttribute(
        "aria-label",
        t('studioTools.selectLayer',{name:node.name??node.id}),
      );
      check.checked = selection.has(node.id);
      check.onchange = () =>
        check.checked ? selection.add(node.id) : selection.delete(node.id);
      label.append(check, el("span", node.name ?? node.id));
      layout.append(label);
    }
    for (const [label, cmd] of [
      [t('studioTools.duplicateSelected'), "duplicate"],
      [t('studioTools.moveForward'), "forward"],
      [t('studioTools.moveBackward'), "backward"],
      [t('studioTools.groupSelected'), "group"],
      [t('studioTools.ungroupSelected'), "ungroup"],
      [t('studioTools.alignLeft'), "left"],
      [t('studioTools.alignRight'), "right"],
      [t('studioTools.alignTop'), "top"],
      [t('studioTools.alignBottom'), "bottom"],
      [t('studioTools.centerOnCard'), "center"],
      [t('studioTools.snapTo10UnitGrid'), "snap"],
      [t('studioTools.lockSelected'), "lock"],
      [t('studioTools.unlockSelected'), "unlock"],
      [t('studioTools.deleteSelected'), "delete"],
    ])
      button(layout, label, async () => {
        transformSelection(p, getSide(), chosen(), cmd);
        selection.clear();
        await rebuild();
      });
    if (n?.type === "text") {
      const box = el("fieldset");
      box.append(el("legend", t('studioTools.typography')));
      root.append(box);
      const disabled = !!n.locked;
      const editText = (fn) => edit(() => {
        if (n.locked) throw new Error(t('studioTools.unlockThisLayerToEditIt'));
        fn();
      });
      const change = (key, value) =>
        editText(() => {
          n.typography ??= {};
          n.typography[key] = value;
        });
      input(
        box,
        t('studioTools.textContent'),
        n.runs?.map(span=>span.text).join("") ?? n.text,
        (v) =>
          editText(() => {
            n.text = v;
            delete n.runs;
          }),
        { type: "textarea", disabled: disabled || !!n.stat },
      );
      input(
        box,
        t('studioTools.fontFace'),
        n.typography?.fontAsset ?? "",
        (v) =>
          editText(() => {
            n.typography ??= {};
            if (v) n.typography.fontAsset = v;
            else delete n.typography.fontAsset;
          }),
        {
          choices: [
            { id: "", name: t('studioTools.systemFont') },
            ...p.manifest.assets
              .filter((a) => a.role === "font")
              .map((a) => ({
                id: a.id,
                name: a.font?.family + " · " + (a.font?.face ?? a.id),
              })),
          ],
          disabled,
        },
      );
      input(
        box,
        t('studioTools.systemFontFamily'),
        n.font ?? "Georgia",
        (v) => editText(() => (n.font = v)),
        { disabled },
      );
      for (const [key, label, defaultValue] of [
        ["size", t('studioTools.fontSize'), 48],
        ["minSize", t('studioTools.minimumFontSize'), 8],
        ["weight", t('studioTools.fontWeight'), 400],
        ["lineHeight", t('studioTools.lineHeight'), 1.2],
        ["letterSpacing", t('studioTools.letterSpacing'), 0],
        ["paragraphSpacing", t('studioTools.paragraphSpacing'), 0],
        ["outlineWidth", t('studioTools.outlineWidth'), 0],
        ["shadowBlur", t('studioTools.shadowBlur'), 0],
        ["shadowX", t('studioTools.shadowHorizontalOffset'), 0],
        ["shadowY", t('studioTools.shadowVerticalOffset'), 0],
      ])
        input(
          box,
          label,
          n.typography?.[key] ?? defaultValue,
          (v) => change(key, Number(v)),
          { type: "number", disabled },
        );
      for (const [key, label, choices] of [
        ["style", t('studioTools.fontStyle'), ["normal", "italic", "oblique"]],
        [
          "align",
          t('studioTools.textAlignment'),
          ["left", "center", "right", "start", "end"],
        ],
        ["verticalAlign", t('studioTools.verticalAlignment'), ["top", "middle", "bottom"]],
        [
          "overflow",
          t('studioTools.textOverflow'),
          ["wrap", "shrink", "ellipsis", "clip", "grow"],
        ],
        ["direction", t('studioTools.textDirection'), ["auto", "ltr", "rtl"]],
      ])
        input(
          box,
          label,
          n.typography?.[key] ?? choices[0],
          (v) => change(key, v),
          { choices, disabled },
        );
      for (const [key, label, defaultValue] of [
        ["color", t('studioTools.textColor'), "#ffffff"],
        ["outlineColor", t('studioTools.outlineColor'), "#000000"],
        ["shadowColor", t('studioTools.shadowColor'), "#000000"],
      ])
        input(
          box,
          label,
          n.typography?.[key] ?? defaultValue,
          (v) => change(key, v),
          { type: "color", disabled },
        );
      input(
        box,
        t('studioTools.textLanguage'),
        n.typography?.language ?? "en",
        (v) => change("language", v),
        { disabled },
      );
      input(
        box,
        t('studioTools.accessibleReadingOrder'),
        n.readingOrder ?? 0,
        (v) => editText(() => (n.readingOrder = Number(v))),
        { type: "number", disabled },
      );
      const asset = p.manifest.assets.find(
        (a) => a.id === n.typography?.fontAsset,
      );
      for (const [axis, range] of Object.entries(asset?.font?.axes ?? {}))
        input(
          box,
          range.name + " (" + axis + ")",
          n.typography?.axes?.[axis] ?? range.default,
          (v) => change("axes", { ...n.typography?.axes, [axis]: Number(v) }),
          { type: "number", disabled },
        );
      button(box, t('studioTools.copyTextStyle'), () => {
        clipboard = structuredClone(n.typography ?? {});
        report(t('studioTools.styleCopied'));
      });
      button(box, t('studioTools.pasteTextStyle'), () => {
        if (!clipboard) throw new Error(t('studioTools.copyAStyleFirst'));
        return editText(() => (n.typography = structuredClone(clipboard)));
      });
      button(box, t('studioTools.saveReusableTextStyle'), async () => {
        await saveTextStyle(p, n, library, { name: n.name ?? "Text style" });
        await loadEntries();
        render();
      });
      const rich = el("details");
      rich.append(el("summary", t('studioTools.styledTextSpans')));
      const spanPanelKey = getSide() + ":" + n.id;
      rich.open = expandedSpans.has(spanPanelKey);
      rich.ontoggle = () => rich.open ? expandedSpans.add(spanPanelKey) : expandedSpans.delete(spanPanelKey);
      box.append(rich);
      if (n.stat) {
        rich.append(el("p", t('studioTools.boundTextComesFromItsStatFieldUse')));
      } else {
        const spans = n.runs ?? [{ text: n.text ?? "" }],
          changeSpan = (index, key, value) => editText(() => {
            n.runs ??= [{ text: n.text ?? "" }];
            if (value === undefined) delete n.runs[index][key];
            else n.runs[index][key] = value;
          });
        rich.append(el("p", t('studioTools.spansContainPlainTextAndOptionalOverridesInherited')));
        for (const [index, span] of spans.entries()) {
          const row = el("fieldset"), number = index + 1;
          row.append(el("legend", t('studioTools.span',{number})));
          rich.append(row);
          input(row, t('studioTools.spanText',{number}), span.text, v=>changeSpan(index, "text", v), { type: "textarea", disabled });
          input(row, t('studioTools.spanWeight',{number}), span.weight ?? "", v=>changeSpan(index, "weight", v === "" ? undefined : Number(v)), { type: "number", disabled });
          input(row, t('studioTools.spanStyle',{number}), span.style ?? "", v=>changeSpan(index, "style", v || undefined), {
            choices: [{id:"",name:t('studioTools.inheritStyle')}, "normal", "italic", "oblique"], disabled,
          });
          input(row, t('studioTools.spanColor',{number}), span.color ?? n.typography?.color ?? n.color ?? "#ffffff",
            v=>changeSpan(index, "color", v), { type: "color", disabled });
          input(row, t('studioTools.spanIcon',{number}), span.icon ?? "", v=>changeSpan(index, "icon", v || undefined), {
            choices: [{id:"",name:t('studioTools.noIcon')}, ...p.manifest.assets.filter(a=>a.mediaType.startsWith("image/")).map(a=>({id:a.id,name:a.id}))], disabled,
          });
          button(row, t('studioTools.resetSpan',{number}), () => editText(() => {
            n.runs ??= [{ text: n.text ?? "" }];
            for (const key of ["weight", "style", "color"]) delete n.runs[index][key];
          })).disabled = disabled;
          for (const [label, offset] of [[t('studioTools.earlierSpan',{number}), -1], [t('studioTools.laterSpan',{number}), 1]]) {
            button(row, label, () => editText(() => {
              n.runs ??= [{ text: n.text ?? "" }];
              const other = index + offset;
              [n.runs[index], n.runs[other]] = [n.runs[other], n.runs[index]];
            })).disabled = disabled || index + offset < 0 || index + offset >= spans.length;
          }
          button(row, t('studioTools.removeSpan',{number}), () => editText(() => {
            n.runs ??= [{ text: n.text ?? "" }];
            n.runs.splice(index, 1);
            if (!n.runs.length) { n.text = ""; delete n.runs; }
          })).disabled = disabled;
        }
        button(rich, t('studioTools.addTextSpan'), () => editText(() => {
          n.runs ??= [{ text: n.text ?? "" }];
          if (n.runs.length >= 128) throw new Error(t('studioTools.aTextLayerSupportsAtMost128Spans'));
          n.runs.push({ text: "" });
        })).disabled = disabled || spans.length >= 128;
        button(rich, t('studioTools.convertSpansToPlainText'), () => editText(() => {
          n.text = (n.runs ?? [{text:n.text ?? ""}]).map(span=>span.text).join("");
          delete n.runs;
        })).disabled = disabled || !n.runs;
        const advanced = el("details");
        advanced.append(el("summary", t('studioTools.advancedSpanJSON')));
        rich.append(advanced);
        input(
        advanced,
        t('studioTools.textSpansJSON'),
        JSON.stringify(n.runs ?? [{ text: n.text }], null, 2),
        (v) => editText(() => (n.runs = JSON.parse(v))),
        { type: "textarea", disabled },
      );
      rich.append(
        el(
          "p",
          t('studioTools.eachSpanCanIncludeTextColorWeightStyle'),
        ),
      );
      }
      if (n.stat) {
        input(
          box,
          t('studioTools.statAppearance'),
          n.stat.view ?? "text",
          (v) => editText(() => (n.stat.view = v)),
          { choices: ["text", "badge", "bar"], disabled },
        );
        const publicFields = (p.manifest.authoring?.fields ?? []).filter(
          (f) => (f.visibility ?? "public") === "public" && (f.scope ?? "card") !== "copy",
        );
        input(box, t('studioTools.boundField'), JSON.stringify([n.stat.scope ?? "card", n.stat.key]), (v) => {
          const [scope, key] = JSON.parse(v),
            field = publicFields.find((f) => f.key === key && (f.scope ?? "card") === scope);
          if (!field) throw new Error(t('studioTools.chooseAPublicSnapshotField'));
          return editText(() => {
            n.stat.key = key;
            n.stat.scope = scope;
          });
        }, {
          choices: publicFields.map((f) => ({ id: JSON.stringify([f.scope ?? "card", f.key]), name: f.label + " · " + optionLabel(f.scope ?? "card") + " / " + f.key })),
          disabled,
        });
        for (const [key, label, fallback] of [
          ["label", t('studioTools.statLabel'), ""],
          ["unit", t('studioTools.statUnit'), ""],
          ["missing", t('studioTools.missingStatText'), "—"],
          ["locale", t('studioTools.statNumberLocale'), "en"],
          ["precision", t('studioTools.statDecimalPlaces'), 8],
          ...(n.stat.view === "bar" ? [["minimum", t('studioTools.barMinimum'), 0], ["maximum", t('studioTools.barMaximum'), 100]] : []),
        ]) input(box, label, n.stat[key] ?? fallback, (v) => editText(() => {
          n.stat[key] = typeof fallback === "number" ? Number(v) : v;
        }), { type: typeof fallback === "number" ? "number" : "text", disabled });
      }
    }
    const fonts = el("details");
    fonts.append(el("summary", t('studioTools.embeddedFontAssets')));
    fonts.open = fontsExpanded;
    fonts.ontoggle = ()=>{fontsExpanded=fonts.open;};
    root.append(fonts);
    const fontAssets = p.manifest.assets.filter(asset=>asset.role === "font");
    if (!fontAssets.length) fonts.append(el("p", t('studioTools.addCustomFontToEmbedAReproducibleFace')));
    for (const asset of fontAssets) {
      const row = el("fieldset");
      row.append(el("legend", asset.font.family + " · " + asset.font.face));
      fonts.append(row);
      row.append(el("p", t('studioTools.fontAssetIdentity',{id:asset.id,digest:asset.sha256})));
      input(row, t('studioTools.fontTerms',{id:asset.id}), asset.font.license, (v)=>edit(()=>{
        const current = getProject().manifest.assets.find(a=>a.id===asset.id);
        if (!v.trim() || v.length > 2000) throw new Error(t('studioTools.enterFontUsageTermsWithin2000Characters'));
        current.font.license = v.trim();
      }), {type:"textarea"}).maxLength = 2000;
      try {
        const {font,info} = inspectFont(p.assets.get(asset.path),asset.mediaType);
        fontCache.set(asset.id,font);
        row.append(el("p", t('studioTools.fontDecoded',{family:info.family,face:info.face,style:info.style,weight:info.weight??t('studioTools.unavailable'),angle:info.italicAngle})));
        row.append(el("p", t('studioTools.fontGlyphs',{glyphs:info.glyphs,entries:info.codepoints.length,units:info.unitsPerEm})));
        const axes = Object.entries(info.axes);
        row.append(el("p", axes.length ? t('studioTools.fontAxes',{axes:axes.map(([key,range])=>t('studioTools.fontAxis',{key,name:range.name,minimum:range.min,maximum:range.max,default:range.default})).join('; ')}) : t('studioTools.variableAxesNone')));
        let sample = fontSamples.get(asset.sha256) ?? (n?.type === "text" ? textValue(n,p.manifest) : p.manifest.title);
        const updateCoverage = (v)=>{
          sample = v;
          fontSamples.set(asset.sha256,sample);
          const missing = [...new Set(Array.from(sample).filter(character=>!/[\r\n]/.test(character) && !font.hasGlyphForCodePoint(character.codePointAt(0))))];
          coverage.textContent = missing.length ? t('studioTools.missingCodepoints',{points:missing.slice(0,32).map(character=>'U+'+character.codePointAt(0).toString(16).toUpperCase()).join(', ')+(missing.length>32?' …':'')}) : t('studioTools.allSampleCodePointsAreMappedThisDoes');
        };
        input(row, t('studioTools.fontSample',{id:asset.id}), sample, updateCoverage).maxLength = 10000;
        const coverage = el("p");
        coverage.setAttribute("role","status");
        row.append(coverage);
        updateCoverage(sample);
      } catch (error) {
        row.append(el("p", t('studioTools.fontDiagnostic',{message:error.message})));
      }
    }
    const stats = el("details");
    stats.open = true;
    stats.append(el("summary", t('studioTools.cardStats')));
    root.append(stats);
    const fields = p.manifest.authoring?.fields ?? [];
    const fieldControls = new Map();
    if (!fields.length)
      stats.append(
        el("p", t('studioTools.addAFieldOrLoadTheDestinationPolicy')),
      );
    for (const f of fields.filter((f) => (f.scope ?? "card") !== "copy")) {
      const scope = f.scope ?? "card",
        value = p.manifest.authoring?.values?.[scope]?.[f.key],
        disabled =
          (f.source ?? "author") !== "author" || Object.hasOwn(f, "fixed");
      const error =
        value === undefined
          ? f.required
            ? t('studioTools.requiredValueIsMissing')
            : null
          : valueError(f, value);
      const choices = f.enum?.map((v) => ({
        id: JSON.stringify(v),
        name: String(v),
      }));
      const control = input(
        stats,
        f.label + (f.required ? " *" : ""),
        choices
          ? JSON.stringify(value)
          : typeof value === "object"
            ? JSON.stringify(value)
            : value,
        (v) => {
          let parsed;
          if ((choices || f.type === "boolean") && v === "") parsed = undefined;
          else if (choices || f.type === "boolean") parsed = JSON.parse(v);
          else if (["number", "integer"].includes(f.type))
            parsed = v === "" ? undefined : Number(v);
          else if (["object", "array"].includes(f.type)) parsed = JSON.parse(v);
          else parsed = v;
          setStat(p, f.key, parsed, scope);
          return rebuild();
        },
        {
          type: ["integer", "number"].includes(f.type)
            ? "number"
            : ["object", "array"].includes(f.type)
              ? "textarea"
              : "text",
          choices:
            choices || f.type === "boolean"
              ? [{ id: "", name: t('studioTools.noValue') },
                  ...(f.nullable && !f.enum?.includes(null) ? [{ id: "null", name: t('studioTools.null') }] : []),
                  ...(choices ?? ["false", "true"])]
              : undefined,
          disabled,
        },
      );
      fieldControls.set(scope + ".stats." + f.key, control);
      const help = el("p", t('studioTools.fieldMetadata',{scope:optionLabel(scope),source:optionLabel(f.source??'author'),visibility:optionLabel(f.visibility??'public')})+(f.unit?t('studioTools.unitMetadata',{unit:f.unit}):'')+(f.description?' · '+f.description:'')+(['integer','number'].includes(f.type)?t('studioTools.rangeMetadata',{minimum:f.minimum??-1e12,maximum:f.maximum??1e12}):'')+(f.precision!==undefined?t('studioTools.precisionMetadata',{precision:f.precision}):'')+(f.type==='string'?t('studioTools.lengthMetadata',{minimum:f.minLength??0,maximum:f.maxLength??10000}):'')+(f.type==='array'?t('studioTools.itemsMetadata',{minimum:f.minItems??0,maximum:f.maxItems??256}):''));
      help.id = "dcs-field-help-" + crypto.randomUUID();
      control.setAttribute("aria-describedby", help.id);
      stats.append(help);
      if (["integer", "number"].includes(f.type)) {
        control.step = f.type === "integer" ? "1" : f.precision === undefined ? "any" : String(10 ** -f.precision);
        if (f.minimum !== undefined) control.min = String(f.minimum);
        if (f.maximum !== undefined) control.max = String(f.maximum);
      }
      if (error) {
        const message = el("p", f.label + ": " + error);
        message.id = "dcs-field-error-" + crypto.randomUUID();
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", help.id + " " + message.id);
        stats.append(message);
      }
      if (value === null) stats.append(el("p", f.label + ": null"));
      if (!disabled && f.nullable)
        button(stats, t('studioTools.nullField',{label:f.label}), async () => {
          setStat(p, f.key, null, scope);
          await rebuild();
        });
      if (!disabled)
        button(stats, t('studioTools.clearField',{label:f.label}), async () => {
          setStat(p, f.key, undefined, scope);
          await rebuild();
        });
      if ((f.visibility ?? "public") === "public")
        button(stats, t('studioTools.addField',{label:f.label}), async () => {
          const ids = addStatBlock(p, getSide(), [{ key: f.key, scope }]);
          select(ids[0]);
          await rebuild();
        });
      else
        stats.append(
          el(
            "p",
            t('studioTools.thisFieldIsPrivateAndCannotBeIncluded'),
          ),
        );
    }
    button(stats, t('studioTools.addAllPublicStatsAsATable'), async () => {
      addStatBlock(
        p,
        getSide(),
        fields
          .filter(
            (f) =>
              (f.visibility ?? "public") === "public" &&
              (f.scope ?? "card") !== "copy",
          )
          .map((f) => ({ key: f.key, scope: f.scope ?? "card" })),
        { columns: 2 },
      );
      await rebuild();
    });
    button(stats, t('studioTools.exportStatsCSV'), () => {
      const url = URL.createObjectURL(
          new Blob([exportStatsCSV(p)], { type: "text/csv" }),
        ),
        a = el("a");
      a.href = url;
      a.download = "card-stats.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    button(stats, t('studioTools.importStatsCSV'), () => {
      const file = el("input");
      file.type = "file";
      file.accept = ".csv";
      file.onchange = () =>
        run(async () => {
          const f = file.files[0];
          if (!f || f.size > 262144)
            throw new Error(t('studioTools.csvMustBeBelow256KiB'));
          importStatsCSV(p, await f.text());
          await rebuild();
        });
      file.click();
    });
    const fieldForm = el("details");
    fieldForm.append(el("summary", t('studioTools.defineACustomField')));
    stats.append(fieldForm);
    const draft = {
      key: "custom.value",
      label: "Value",
      type: "integer",
      required: false,
      scope: "card",
      visibility: "public",
      source: "author",
    };
    input(fieldForm, t('studioTools.fieldKey'), draft.key, (v) => (draft.key = v));
    input(fieldForm, t('studioTools.fieldLabel'), draft.label, (v) => (draft.label = v));
    input(fieldForm, t('studioTools.fieldHelp'), "", (v) => {
      if (v) draft.description = v;
      else delete draft.description;
    }, { type: "textarea" });
    input(fieldForm, t('studioTools.fieldUnit'), "", (v) => {
      if (v) draft.unit = v;
      else delete draft.unit;
    });
    input(fieldForm, t('studioTools.fieldScope'), draft.scope, (v) => (draft.scope = v), { choices: ["card", "variant"] });
    input(fieldForm, t('studioTools.fieldVisibility'), draft.visibility, (v) => (draft.visibility = v), { choices: ["public", "owner", "operator"] });
    input(fieldForm, t('studioTools.fieldType'), draft.type, (v) => {
      draft.type = v;
      for (const key of ["minimum", "maximum", "precision", "minLength", "maxLength", "minItems", "maxItems", "enum"]) delete draft[key];
      paintConstraints();
      paintChoices();
    }, {
      choices: ["integer", "number", "string", "boolean", "array", "object"],
    });
    input(
      fieldForm,
      t('studioTools.fieldRequirement'),
      "optional",
      (v) => (draft.required = v === "required"),
      { choices: ["optional", "required"] },
    );
    input(fieldForm, t('studioTools.allowNull'), "no", (v) => (draft.nullable = v === "yes"), { choices: ["no", "yes"] });
    const constraints = el("fieldset"), enumForm = el("fieldset");
    fieldForm.append(constraints, enumForm);
    function paintConstraints() {
      constraints.replaceChildren(el("legend", t('studioTools.valueBounds')));
      const bounds = ["integer", "number"].includes(draft.type)
        ? [["minimum", t('studioTools.fieldMinimum')], ["maximum", t('studioTools.fieldMaximum')], ...(draft.type === "number" ? [["precision", t('studioTools.fieldDecimalPlaces')]] : [])]
        : draft.type === "string" ? [["minLength", t('studioTools.minimumTextLength')], ["maxLength", t('studioTools.maximumTextLength')]]
        : draft.type === "array" ? [["minItems", t('studioTools.minimumListItems')], ["maxItems", t('studioTools.maximumListItems')]] : [];
      if (!bounds.length) constraints.append(el("p", t('studioTools.thisTypeHasNoSizeOrNumericBounds')));
      for (const [key, label] of bounds) input(constraints, label, draft[key] ?? "", (v) => {
        if (v === "") delete draft[key];
        else draft[key] = Number(v);
      }, { type: "number" });
      constraints.append(el("p", t('studioTools.blankBoundsUseTheFieldContractDefaultsList')));
    }
    function paintChoices() {
      enumForm.replaceChildren(el("legend", t('studioTools.allowedChoices')));
      if (["array", "object"].includes(draft.type)) {
        enumForm.append(el("p", t('studioTools.structuredEnumerationValuesRequireAPolicyOrAPI')));
        return;
      }
      enumForm.append(el("p", t('studioTools.noChoicesMeansAnyValueAllowedByThe')));
      for (const [index, value] of (draft.enum ?? []).entries()) {
        input(enumForm, t('studioTools.allowedChoice',{number:index+1}), value, (v) => {
          draft.enum[index] = draft.type === "boolean" ? v === "true" : ["integer", "number"].includes(draft.type) ? Number(v) : v;
        }, { type: ["integer", "number"].includes(draft.type) ? "number" : "text", choices: draft.type === "boolean" ? ["false", "true"] : undefined });
        button(enumForm, t('studioTools.removeChoice',{number:index+1}), () => {
          draft.enum.splice(index, 1);
          if (!draft.enum.length) delete draft.enum;
          paintChoices();
        });
      }
      button(enumForm, t('studioTools.addAllowedChoice'), () => {
        draft.enum ??= [];
        if (draft.enum.length >= 128) throw new Error(t('studioTools.aFieldSupportsAtMost128Choices'));
        draft.enum.push(draft.type === "boolean" ? false : ["integer", "number"].includes(draft.type) ? 0 : "");
        paintChoices();
      }).disabled = (draft.enum?.length ?? 0) >= 128;
    }
    paintConstraints();
    paintChoices();
    button(fieldForm, t('studioTools.createField'), async () => {
      validateField(draft);
      await edit(() => {
        p.manifest.authoring ??= { values: { card: {}, variant: {} } };
        p.manifest.authoring.fields ??= [];
        if (p.manifest.authoring.fields.some((f) => f.key === draft.key && (f.scope ?? "card") === draft.scope))
          throw new Error(t('studioTools.fieldKeyAlreadyExistsInThisScope'));
        p.manifest.authoring.fields.push(structuredClone(draft));
      });
    });
    if (n?.type === "group") {
      const group = el("fieldset");group.append(el("legend",t('studioTools.groupCompositing')));root.append(group);
      group.append(el("p",t('studioTools.isolateRendersChildrenIntoTheGroupSExplicit')));
      input(group,t('studioTools.isolateGroup'),n.isolate?"yes":"no",value=>edit(()=>{
        const target=flattenNodes(p.scenes.get(p.manifest.faces[getSide()].scene).nodes).find(node=>node.id===n.id);
        if(target.locked)throw new Error(t('studioTools.chooseAnUnlockedGroup'));
        if(value==="yes"){
          target.isolate=true;target.width??=p.manifest.canvas.width;target.height??=p.manifest.canvas.height;
          if(!p.manifest.capabilities.required.includes("dc.group-isolation@0.2"))p.manifest.capabilities.required.push("dc.group-isolation@0.2");
        }else delete target.isolate;
      }),{choices:["no","yes"],disabled:!!n.locked});
    }
    if (n && (n.type !== "group" || n.isolate)) {
      const maskSide = getSide(), panelKey = maskSide + ":" + n.id,
        masks = el("details"), disabled = !!n.locked,
        editMask = (fn) => edit(() => {
          const project = getProject(), target = flattenNodes(project.scenes.get(project.manifest.faces[maskSide].scene).nodes).find(node=>node.id===n.id);
          if (!target || target.locked) throw new Error(t('studioTools.chooseAnUnlockedLayerToEditItsMask'));
          fn(target);
          if (target.mask?.rect || target.mask?.transform || target.material?.mask) {
            if (!project.manifest.capabilities.required.includes("dc.mask-layout@0.2")) project.manifest.capabilities.required.push("dc.mask-layout@0.2");
          }
          if (project.manifest.authoring?.masks) delete project.manifest.authoring.masks[panelKey];
        });
      masks.append(el("summary", t('studioTools.clippingMaskProperties')));
      masks.open = expandedMasks.has(panelKey);
      masks.ontoggle = () => masks.open ? expandedMasks.add(panelKey) : expandedMasks.delete(panelKey);
      root.append(masks);
      masks.append(el("p", t('studioTools.clippingMasksLimitArtworkAndTextPolygonCoordinates')));
      input(masks, t('studioTools.clippingMaskSource'), n.mask?.asset ? "image:" + n.mask.asset : n.mask?.polygon ? "polygon" : "none", (v)=>editMask(target=>{
        if (v === "none") delete target.mask;
        else target.mask = v === "polygon" ? {polygon:[[0,0],[1,0],[1,1],[0,1]]} : {asset:v.slice(6)};
      }), { choices: [{id:"none",name:t('studioTools.noClippingMask')}, {id:"polygon",name:t('studioTools.polygon')},
        ...p.manifest.assets.filter(asset=>asset.mediaType.startsWith("image/")).map(asset=>({id:"image:"+asset.id,name:t('studioTools.imageAlpha',{id:asset.id})}))], disabled });
      if (n.mask) {
        input(masks, t('studioTools.invertClippingMask'), n.mask.invert ? "yes" : "no", (v)=>editMask(target=>{target.mask.invert = v === "yes";}), {choices:["no","yes"],disabled});
        button(masks, t('studioTools.removeClippingMask'), ()=>editMask(target=>{delete target.mask;})).disabled = disabled;
      }
      const layoutControls = (container, mask, use) => {
        if (!mask) return;
        const label = use === "clip" ? t('studioTools.clipping') : t('studioTools.effect'),
          update = fn => editMask(target => {
            if (use === "effect" && !target.material.mask) {
              target.material.mask = {asset:target.material.maskAsset};
              delete target.material.maskAsset;
            }
            fn(use === "clip" ? target.mask : target.material.mask);
          });
        container.append(el("p", t('studioTools.maskTranslationsAndPivotsUseLayerFractionsRotation')));
        for (const [key, fallback] of [["x",0],["y",0],["scaleX",1],["scaleY",1],["rotation",0],["pivotX",0.5],["pivotY",0.5]]) {
          const control = input(container,t('studioTools.maskTransform',{mask:label,property:propertyLabel(key)}),mask.transform?.[key] ?? fallback,v=>update(current=>{
            current.transform ??= {}; current.transform[key] = Number(v);
          }),{type:"number",disabled});
          control.min = key === "rotation" ? "-360000" : "-100";
          control.max = key === "rotation" ? "360000" : "100"; control.step = "any";
        }
        button(container,t('studioTools.resetMaskTransform',{mask:label.toLowerCase()}),()=>update(current=>{delete current.transform;})).disabled = disabled;
        if (mask.asset) {
          const asset = p.manifest.assets.find(a=>a.id===mask.asset), crop = mask.rect ?? [0,0,asset.width,asset.height];
          for (const [index,key] of ["x","y","width","height"].entries()) {
            const control = input(container,t('studioTools.maskCrop',{mask:label,property:propertyLabel(key)}),crop[index],v=>update(current=>{
              current.rect ??= [...crop]; current.rect[index] = Number(v);
            }),{type:"number",disabled});
            control.min = index < 2 ? "0" : "0.001"; control.max = String(index%2 ? asset.height : asset.width); control.step = "any";
          }
          button(container,t('studioTools.resetMaskCrop',{mask:label.toLowerCase()}),()=>update(current=>{delete current.rect;})).disabled = disabled;
        }
      };
      layoutControls(masks,n.mask,"clip");
      if (n.material) {
        const effects = el("fieldset"), effectMask = n.material.mask ?? (n.material.maskAsset ? {asset:n.material.maskAsset} : undefined);
        effects.append(el("legend",t('studioTools.effectMaskProperties'))); masks.append(effects);
        input(effects,t('studioTools.effectMaskSource'),effectMask?.asset ? "image:"+effectMask.asset : effectMask?.polygon ? "polygon" : "none",v=>editMask(target=>{
          delete target.material.maskAsset;
          if (v === "none") delete target.material.mask;
          else target.material.mask = v === "polygon" ? {polygon:[[0,0],[1,0],[1,1],[0,1]]} : {asset:v.slice(6)};
        }),{choices:[{id:"none",name:t('studioTools.noEffectMask')},{id:"polygon",name:t('studioTools.polygon')},...p.manifest.assets.filter(a=>a.mediaType.startsWith("image/")).map(a=>({id:"image:"+a.id,name:t('studioTools.imageAlpha',{id:a.id})}))],disabled});
        if (effectMask) {
          input(effects,t('studioTools.invertEffectMask'),effectMask.invert ? "yes" : "no",v=>editMask(target=>{
            target.material.mask ??= {asset:target.material.maskAsset}; delete target.material.maskAsset;
            target.material.mask.invert = v === "yes";
          }),{choices:["no","yes"],disabled});
          layoutControls(effects,effectMask,"effect");
          for (const [index,point] of (effectMask.polygon ?? []).entries()) {
            const row=el("fieldset");row.append(el("legend",t('studioTools.effectVertex',{number:index+1})));effects.append(row);
            for (const [component,axis] of ["x","y"].entries()) {
              const control=input(row,t('studioTools.effectVertexAxis',{number:index+1,axis:propertyLabel(axis)}),point[component],v=>editMask(target=>{target.material.mask.polygon[index][component]=Number(v);}),{type:"number",disabled});
              control.min="0";control.max="1";control.step="any";
            }
            button(row,t('studioTools.insertEffectVertex',{number:index+1}),()=>editMask(target=>{
              const points=target.material.mask.polygon;
              if(points.length>=64)throw new Error(t('studioTools.aMaskSupportsAtMost64Vertices'));
              const next=points[(index+1)%points.length];points.splice(index+1,0,[(point[0]+next[0])/2,(point[1]+next[1])/2]);
            })).disabled=disabled || effectMask.polygon.length>=64;
            button(row,t('studioTools.removeEffectVertex',{number:index+1}),()=>editMask(target=>{
              if(target.material.mask.polygon.length<=3)throw new Error(t('studioTools.aMaskNeedsAtLeast3Vertices'));
              target.material.mask.polygon.splice(index,1);
            })).disabled=disabled || effectMask.polygon.length<=3;
          }
        }
      }
      if (n.mask?.polygon) {
        masks.append(el("p", t('studioTools.aPolygonHas3To64VerticesAdd')));
        for (const [index, point] of n.mask.polygon.entries()) {
          const row = el("fieldset");
          row.append(el("legend", t('studioTools.maskVertex',{number:index+1})));
          masks.append(row);
          for (const [axis, component] of [["x",0],["y",1]]) {
            const control = input(row, t('studioTools.maskVertexAxis',{number:index+1,axis:propertyLabel(axis)}), point[component], v=>editMask(target=>{
              target.mask.polygon[index][component] = Number(v);
            }), {type:"number",disabled});
            control.min = "0"; control.max = "1"; control.step = "any";
          }
          button(row, t('studioTools.insertMaskVertex',{number:index+1}), ()=>editMask(target=>{
            const points = target.mask.polygon;
            if (points.length >= 64) throw new Error(t('studioTools.aMaskSupportsAtMost64Vertices'));
            const current = points[index], next = points[(index+1)%points.length];
            points.splice(index+1,0,[(current[0]+next[0])/2,(current[1]+next[1])/2]);
          })).disabled = disabled || n.mask.polygon.length >= 64;
          button(row, t('studioTools.removeMaskVertex',{number:index+1}), ()=>editMask(target=>{
            if (target.mask.polygon.length <= 3) throw new Error(t('studioTools.aMaskNeedsAtLeast3Vertices'));
            target.mask.polygon.splice(index,1);
          })).disabled = disabled || n.mask.polygon.length <= 3;
        }
      }
      button(masks, t('studioTools.uploadClippingMaskImage'), ()=>{
        const file = el("input");
        file.type = "file"; file.accept = ".png,.jpg,.jpeg,.webp";
        file.onchange = ()=>run(async()=>{
          const source = file.files[0];
          if (!source) return;
          if (n.locked) throw new Error(t('studioTools.chooseAnUnlockedLayerToEditItsMask'));
          const project = getProject(), asset = await project.addImage(source,{role:"mask"});
          if (getProject() !== project) throw new Error(t('studioTools.theCardChangedDuringMaskUpload'));
          await editMask(target=>{target.mask={asset:asset.id};});
        });
        file.click();
      }).disabled = disabled;
    }
    const libraries = el("details");
    libraries.open = true;
    libraries.append(el("summary", t('studioTools.reusableLibrary')));
    root.append(libraries);
    let libraryName = n?.name ?? p.manifest.title;
    input(
      libraries,
      t('studioTools.libraryItemName'),
      libraryName,
      (v) => (libraryName = v),
    );
    button(libraries, t('studioTools.saveCardAsTemplate'), async () => {
      await saveTemplate(p, library, { name: libraryName });
      await loadEntries();
      render();
    });
    button(libraries, t('studioTools.saveClippingMask'), async () => {
      await saveMask(p, getSide(), getSelected(), library, {
        name: libraryName,
        use: "clip",
      });
      await loadEntries();
      render();
    });
    button(libraries, t('studioTools.saveEffectMask'), async () => {
      await saveMask(p, getSide(), getSelected(), library, {
        name: libraryName,
        use: "effect",
      });
      await loadEntries();
      render();
    });
    if (n)
      button(libraries, t('studioTools.useRectangleClippingMask'), () =>
        edit(() => {
          if (n.locked) throw new Error(t('studioTools.chooseAnUnlockedLayerToEditItsMask'));
          n.mask = {
              polygon: [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
            };
          if (p.manifest.authoring?.masks) delete p.manifest.authoring.masks[getSide()+":"+n.id];
        }),
      ).disabled = !!n.locked || n.type === "group";
    let filter = "";
    const list = el("div");
    const paintList = () => {
      list.replaceChildren();
      for (const entry of entries.filter((e) =>
        (e.document.name + " " + (e.document.tags ?? []).join(" "))
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )) {
        const row = el("div");
        row.append(el("strong", entry.document.name + " · " + optionLabel(entry.kind)));
        if (entry.kind !== "template-set")
          button(row, t('studioTools.applyLibrary',{name:entry.document.name}), async () => {
            const item = entry.shared
              ? await library.get(entry.key, true)
              : entry;
            if (item.kind === "template") {
              const preview = await previewTemplateMigration(p, item),
                dialog = el("dialog"),
                summary = el(
                  "p",
                  t('studioTools.migrationLayers',{count:preview.changes.length}),
                ),
                details = el(
                  "pre",
                  preview.changes
                    .map((c) => c.face + " / " + c.nodeId + ": " + optionLabel(c.change))
                    .join("\n"),
                );
              dialog.append(summary, details);
              button(dialog, t('studioTools.applyReviewedTemplate'), async () => {
                await applyTemplateMigration(p, preview);
                dialog.close();
                dialog.remove();
                await refreshPolicy();
              });
              button(dialog, t('studioTools.cancelTemplateUpdate'), () => {
                dialog.close();
                dialog.remove();
              });
              root.append(dialog);
              dialog.showModal();
              return;
            }
            if (item.kind === "mask")
              await applyMask(p, getSide(), getSelected(), item);
            if (item.kind === "style")
              await applyTextStyle(p, getSide(), getSelected(), item);
            await rebuild();
          });
        if (!entry.shared && library.share)
          button(row, t('studioTools.shareLibrary',{name:entry.document.name}), async () => {
            await library.share(entry);
            await loadEntries();
            render();
            report(t('studioTools.sharedLibraryRevisionSaved'));
          });
        button(row, t('studioTools.exportLibrary',{name:entry.document.name}), async () => {
          const item = entry.shared
            ? await library.get(entry.key, true)
            : entry;
          const raw = {
            ...item,
            archive: item.archive ? Array.from(item.archive) : undefined,
          };
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(raw)], { type: "application/json" }),
          );
          const a = el("a");
          a.href = url;
          a.download = entry.key + ".dclibrary.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        list.append(row);
      }
    };
    input(libraries, t('studioTools.searchLibrary'), "", (v) => {
      filter = v;
      paintList();
    });
    libraries.append(list);
    paintList();
    button(libraries, t('studioTools.importLibraryItem'), () => {
      const file = el("input");
      file.type = "file";
      file.accept = ".json";
      file.onchange = () =>
        run(async () => {
          const f = file.files[0];
          if (!f || f.size > 32 * 1024 * 1024)
            throw new Error(t('studioTools.libraryImportMustBeBelow32MiB'));
          const value = JSON.parse(await f.text());
          if (value.archive) {
            value.archive = new Uint8Array(value.archive);
            await importPackage(value.archive);
          }
          if (
            !["mask", "template", "style"].includes(value.kind) ||
            typeof value.key !== "string" ||
            !value.document?.name
          )
            throw new Error(t('studioTools.invalidLibraryItem'));
          await library.put(value);
          await loadEntries();
          render();
        });
      file.click();
    });
    const layouts = {}, textDiagnostics = [];
    for (const [face, definition] of Object.entries(p.manifest.faces)) {
      for (const node of flattenNodes(p.scenes.get(definition.scene).nodes).filter(n=>n.type === "text")) {
        const asset = p.manifest.assets.find(a=>a.id === node.typography?.fontAsset);
        if (!asset) continue;
        try {
          if (!fontCache.has(asset.id)) fontCache.set(asset.id, inspectFont(p.assets.get(asset.path), asset.mediaType).font);
          const font = fontCache.get(asset.id), text = textValue(node, p.manifest),
            layout = layoutText(node, text, fontMeasure(font, node));
          layouts[face + ":" + node.id] = { ...layout, nodeId: node.id, face };
          for (const issue of fontDiagnostics(font, node, text)) textDiagnostics.push({ face, node, message: issue.message });
          if (layout.overflow) textDiagnostics.push({ face, node, message: t('studioTools.textOverflowsItsBox') });
        } catch (error) {
          textDiagnostics.push({ face, node, message: error.message });
        }
      }
    }
    const focusField = (control) => {
      stats.open = true;
      const target = control.disabled ? control.parentElement : control;
      if (control.disabled) target.tabIndex = -1;
      target.focus();
      target.scrollIntoView({ block: "nearest" });
    };
    const navigateIssue = async (issue) => {
      const control = fieldControls.get(issue.path);
      if (control) return focusField(control);
      const faces = [...new Set([issue.face, getSide(), ...Object.keys(p.manifest.faces)].filter(Boolean))];
      const candidates = faces.flatMap(face => flattenNodes(p.scenes.get(p.manifest.faces[face].scene).nodes).map(node=>({ face, node })));
      const exact = candidates.filter(({node})=>issue.path === node.id);
      const matches = exact.length ? exact : candidates.filter(({node})=>issue.path.startsWith(node.id + "."))
        .sort((a,b)=>b.node.id.length-a.node.id.length);
      const chosen = issue.face ? matches.find(candidate=>candidate.face===issue.face) : matches[0];
      const navigate = async ({ node, face }) => {
        select(node.id, face);
        await rebuild();
        root.querySelector("fieldset input:not(:disabled), fieldset textarea:not(:disabled), fieldset select:not(:disabled)")?.focus();
      };
      if (!issue.face && chosen && matches.filter(candidate=>candidate.node.id===chosen.node.id).length > 1) {
        const dialog = el("dialog");
        dialog.append(el("p", t('studioTools.thisLayerIDIsUsedOnMultipleFaces')));
        for (const candidate of matches.filter(candidate=>candidate.node.id===chosen.node.id))
          button(dialog, t('studioTools.inspectLayer',{face:optionLabel(candidate.face),name:candidate.node.name??candidate.node.id}), async () => {
            dialog.close();
            dialog.remove();
            await navigate(candidate);
          });
        button(dialog, t('studioTools.cancelLayerSelection'), () => { dialog.close(); dialog.remove(); });
        root.append(dialog);
        dialog.showModal();
        return;
      }
      if (chosen) return navigate(chosen);
      report(t('studioTools.issueRule',{message:issue.message,rule:issue.rule??issue.code}));
    };
    const rules = el("details");
    rules.append(el("summary", t('studioTools.cardPolicy')));
    root.append(rules);
    if (policyProvider)
      button(rules, t('studioTools.refreshDestinationPolicy'), refreshPolicy);
    if (effective) {
      if (effective.policy.defaults.template)
        rules.append(
          el("p", t('studioTools.defaultTemplate',{id:effective.policy.defaults.template})),
        );
      rules.append(
        el(
          "p",
          t('studioTools.policyRevision',{revision:effective.revision,references:effective.policy.references.join(', ')}),
        ),
      );
      const issues = inspectCardPolicy(effective.policy, {
        card: { ...context, stats: p.manifest.authoring?.values?.card ?? {} },
        variant: { stats: p.manifest.authoring?.values?.variant ?? {} },
        presentation: { manifest: p.manifest, scenes: p.scenes, layouts },
        templates:
          effective.resources
            ?.filter((r) => r.kind === "template")
            .map((r) => r.document) ?? [],
      });
      const projected = issues.flatMap(issue => issue.code === "TEXT_OVERFLOW"
        ? Object.values(layouts).filter(layout=>layout.nodeId===issue.path && layout.overflow).map(layout=>({ ...issue, face: layout.face }))
        : [issue]);
      const shown = new Set();
      for (const issue of projected) {
        const key = JSON.stringify([issue.code, issue.path, issue.rule, issue.face]);
        if (shown.has(key)) continue;
        shown.add(key);
        const b = button(rules, (issue.face ? issue.face + " / " : "") + issue.path + ": " + issue.message, () => navigateIssue(issue));
        b.className = "dcs-issue";
        rules.append(el("p", t('studioTools.rulePolicies',{rule:issue.rule,policies:issue.policies.join(', ')})));
      }
    } else
      rules.append(
        el(
          "p",
          t('studioTools.noDestinationPolicyLoadedServerValidationIsRequired'),
        ),
      );
    const diagnostics = el("div");
    root.append(diagnostics, status);
    for (const diagnostic of textDiagnostics)
      button(diagnostics, diagnostic.face + " / " + (diagnostic.node.name ?? diagnostic.node.id) + ": " + diagnostic.message,
        () => navigateIssue({ path: diagnostic.node.id, ...diagnostic }));
    const selectedLayer=()=>{
      const project=getProject(),side=getSide();if(!project)return null;
      const selected=getSelected();
      function find(nodes,locked=false){for(const node of nodes){const inherited=locked||!!node.locked;if(node.id===selected)return {project,side,node,locked:inherited};const child=find(node.children??[],inherited);if(child)return child;}return null;}
      return find(project.scenes.get(project.manifest.faces[side].scene).nodes);
    };
    mountedPanels.push(portablePanels.mount({root,getSelection:selectedLayer,edit,run,report}));
    for (const panel of panels) {
      const contribution = panel({
        project: p,
        selected: n,
        side: getSide(),
        edit,
        rebuild,
        localization,
      });
      if (contribution instanceof HTMLElement) root.append(contribution);
      else if (contribution?.element instanceof HTMLElement) {
        mountedPanels.push(contribution);
        root.append(contribution.element);
      }
    }
  }
  const ready = loadEntries()
    .then(() => render())
    .catch((e) => report(t('studioTools.libraryError',{message:e.message})));
  return {
    root,
    ready,
    render,
    refreshPolicy,
    setEditorContributionEnabled:portablePanels.setEnabled,
    async validate() {
      await Promise.all(pending);
      return effective;
    },
    dispose() {
      disposed = true;
      clearTransforms();
      generation++;
      disposePanels();
      portablePanels.dispose();
      root.remove();
    },
  };
}
