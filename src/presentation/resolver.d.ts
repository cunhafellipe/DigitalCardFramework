import type {PackageBrowserResolver} from './package.js';
import type {PublicInputManifest} from './integration.js';
import type {ProjectManifest} from './project.js';

export interface DirectoryResolver extends PackageBrowserResolver {
  manifest: ProjectManifest & PublicInputManifest;
  asset(id: string): Promise<ProjectManifest['assets'][number] & {url: string}>;
}
/** Loads a compiled directory and verifies fetched content; dispose aborts requests and releases object URLs. */
export function directoryResolver(base: string | URL, options?: {digest?: string; signal?: AbortSignal}): Promise<DirectoryResolver>;
