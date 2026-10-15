import type {Localization, LocalizationMessages} from '../localization.js';
import type {CardPolicyContext} from '../card-policy.js';
import type {Operations} from '../wire-types.js';
import type {ValidatedPackage} from './package.js';
import type {Project, ProjectNode, ProjectPackage} from './project.js';
import type {AuthoringSide, LibraryEntry} from './authoring-tools.js';
import type {PerformancePolicy} from './performance.js';
import type {EditorContributionGrants} from './editor-contributions.js';
import type {EditorTransforms} from './editor-transforms.js';
import type {ProgramEditorPanels} from './program-editor-panel.js';

export type StudioPackageInput = Pick<ValidatedPackage, 'manifest' | 'scenes' | 'files'>;
export interface StudioLibrary {
  list(): LibraryEntry[] | PromiseLike<LibraryEntry[]>;
  get(key: string, sharedEntry?: boolean): LibraryEntry | undefined | PromiseLike<LibraryEntry | undefined>;
  put(entry: LibraryEntry): unknown;
  share?(entry: LibraryEntry): unknown;
}
export type StudioPolicy = Pick<Operations['effectiveCardPolicy']['response'], 'revision' | 'policy'> &
  Partial<Pick<Operations['effectiveCardPolicy']['response'], 'context' | 'resources'>>;
export interface StudioPanelContext {
  project: Project;
  selected: ProjectNode | undefined;
  side: AuthoringSide;
  edit(change: (project: Project) => void): Promise<void>;
  rebuild(): Promise<void>;
  localization: Localization;
}
export type StudioPanel = (context: StudioPanelContext) => HTMLElement | {element: HTMLElement; dispose?(): void} | null | undefined | void;
export interface StudioOptions {
  locale?: string;
  messages?: LocalizationMessages;
  localization?: Localization;
  initialPackage?: StudioPackageInput;
  /** Returning false keeps the publication marked as a draft. Other results mark it published. */
  onPublish?(pkg: ProjectPackage): unknown;
  performance?: Partial<PerformancePolicy>;
  /** Material documents are cloned into the project and validated when edited. */
  presets?: Readonly<Record<string, object>>;
  library?: StudioLibrary;
  policyProvider?(context: CardPolicyContext): StudioPolicy | PromiseLike<StudioPolicy>;
  context?: CardPolicyContext;
  panels?: readonly StudioPanel[];
  editorContributions?: readonly unknown[];
  editorContributionGrants?: EditorContributionGrants;
  editorTransforms?: EditorTransforms;
  editorProgramPanels?: ProgramEditorPanels;
}
export interface Studio {
  ready: Promise<void>;
  /** There may be no project even after ready resolves when no initial package was supplied. */
  getProject(): Project | undefined;
  open(pkg: StudioPackageInput): Promise<void>;
  /** Rejects without an active project or when both faces cannot be captured interactively. */
  capturePosters(): Promise<void>;
  refreshPolicy(): Promise<void>;
  setEditorContributionEnabled(id: string, enabled: boolean): void;
  setEditorProgramPanelEnabled(id: string, enabled: boolean): void;
  /** Disposes editor resources, clears the supplied root, and restores its language attributes. */
  dispose(): void;
}
export function mountStudio(root: HTMLElement, options?: StudioOptions): Studio;
