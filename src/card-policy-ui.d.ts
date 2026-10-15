import type {Client} from './client.js';
import type {Localization, LocalizationMessages} from './localization.js';

export interface CardPolicyAdminOptions {
  client: Pick<Client, 'cardPolicies' | 'saveCardPolicy' | 'previewCardPolicy' |
    'retireCardPolicy' | 'restoreCardPolicy' | 'activateCardPolicy' | 'saveCardResource'>;
  locale?: string;
  messages?: LocalizationMessages;
  localization?: Localization;
}
export interface CardPolicyAdmin {
  /** Initial refresh resolves void, or the message displayed after a handled loading error. */
  ready: Promise<void | string>;
  /** Aborts handlers, clears the root and restores its previous language and direction. */
  dispose(): void;
}
export function mountCardPolicyAdmin(root: HTMLElement, options: CardPolicyAdminOptions): CardPolicyAdmin;
