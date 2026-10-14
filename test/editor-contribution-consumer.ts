import {createEditorContributions, validateEditorContribution, type EditorContributionGrants} from '@digital-card/framework/presentation/editor-contributions';
const grants: EditorContributionGrants = {x: {minimum: -100, maximum: 100}};
const panel = validateEditorContribution(JSON.parse('{}'));
const contributions = createEditorContributions([panel], {grants});
contributions.setEnabled(panel.id, false);
// @ts-expect-error Only supported layer fields can be granted.
createEditorContributions([], {grants: {ownerId: {minimum: 0, maximum: 1}}});
// @ts-expect-error Validated manifests are immutable.
panel.controls.push({});
contributions.dispose();

import {createEditorTransforms, type EditorTransformProject} from '@digital-card/framework/presentation/editor-transforms';
declare const transformProject: EditorTransformProject;
const transformTools = createEditorTransforms({tools: [{id: 'example.layout', version: '1.0.0', title: 'Layout', parameters: {gap: {label: 'Gap', type: 'number', default: 12, minimum: 0, maximum: 100}}, grants: {faces: ['front'], newRasterAssets: true}}]});
async function transformRoundTrip(resultArchive: Uint8Array) {
  const request = await transformTools.prepare(transformProject, {toolId: 'example.layout', parameters: {gap: 20}});
  const review = await transformTools.review(transformProject, request.requestId, resultArchive);
  transformTools.apply(transformProject, review);
}
void transformRoundTrip;
transformTools.setEnabled('example.layout', false);
transformTools.dispose();
// @ts-expect-error Transform parameters are data, not callbacks.
void transformTools.prepare(transformProject, {toolId: 'example.layout', parameters: {gap: () => 20}});
// @ts-expect-error Only known faces may be granted.
createEditorTransforms({tools: [{id: 'example.layout', version: '1.0.0', title: 'Layout', parameters: {}, grants: {faces: ['private'], newRasterAssets: false}}]});
