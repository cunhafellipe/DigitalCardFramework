/** Default visibility and permitted card uses. */
export interface CardBehavior {
  collectionDefault: boolean;
  albumDefault: boolean;
  albumEligible: boolean;
  tradable: boolean;
  tradeUp: boolean;
}
export type BuiltinCardType = 'collectible' | 'playable' | 'art' | 'token' | 'checklist' | 'code' | 'voucher' | 'reward';
export const cardTypeDefaults: Readonly<Record<BuiltinCardType, Readonly<CardBehavior>>>;
/** Unknown authored types inherit collectible defaults before explicit overrides. */
export function cardBehavior(definition: {type?: string; behavior?: Partial<CardBehavior>; [key: string]: unknown}): CardBehavior;
