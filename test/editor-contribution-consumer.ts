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
