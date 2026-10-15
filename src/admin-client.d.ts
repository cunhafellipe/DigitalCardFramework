import type { Localization } from './localization.js';
import type { Client, CommandStorage } from './client.js';
import type { Schemas, Operations } from './wire-types.js';
type Draft<T> = T extends object ? Omit<T, 'key' | 'expectedRevision'> : never;
export interface AdminReviewChange {
    label: string;
    before: string;
    after: string;
}
export type AdminReview = {
    command?: 'configureAdmin';
    input: Draft<Operations['configureAdmin']['request']>;
    title: string;
    description?: string;
    changes: AdminReviewChange[];
} | {
    command: 'administerCards';
    input: Draft<Operations['administerCards']['request']>;
    title: string;
    description?: string;
    changes: AdminReviewChange[];
};
export interface AdminState {
    phase: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
    overview: Schemas['AdminOverview'] | null;
    users: Schemas['AdminUsersPage'];
    person: Schemas['AdminUserDetail'] | null;
    history: Schemas['AdminHistoryPage'];
    review: StoredReview | null;
    pending: boolean;
    error: {
        code: string;
        message: string;
        status?: number;
    } | null;
    message: string;
    loadingUsers: boolean;
    loadingPerson: boolean;
    loadingHistory: boolean;
}
export interface AdminController {
    getState(): AdminState;
    subscribe(listener: (state: AdminState) => void): () => void;
    load(options?: {
        keepReview?: boolean;
    }): Promise<void>;
    users(options?: {
        search?: string;
        after?: string;
        limit?: number;
    }): Promise<void>;
    person(userId: string, options?: {
        after?: string;
        limit?: number;
    }): Promise<void>;
    history(options?: {
        search?: string;
        after?: string;
        limit?: number;
    }): Promise<void>;
    stage(review: AdminReview): boolean;
    cancel(): boolean;
    confirm(): Promise<Schemas['AdminMutation'] | null>;
    dispose(): void;
}
type AdminCommand = 'configureAdmin' | 'administerCards';
type StoredReviewInput<T> = T extends object ? Omit<T, 'key'> & {
    key?: string;
} : never;
type StoredReview<C extends AdminCommand = AdminCommand> = C extends AdminCommand ? {
    command: C;
    input: StoredReviewInput<Operations[C]['request']>;
    title: string;
    description: string;
    changes: AdminReviewChange[];
} : never;
type Storage = CommandStorage & Required<Pick<CommandStorage, 'removeItem'>>;
/** A replaceable operator workflow. Namespace identifies the authenticated operator. */
export declare function createAdminController({ client, storage, namespace, localization }: {
    client: Client;
    /** Omitted storage permits construction; persistence reports unavailable storage. */
    storage?: Storage;
    namespace: string;
    localization?: Localization;
}): AdminController;
export {};
