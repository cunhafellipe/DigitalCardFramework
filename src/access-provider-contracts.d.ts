export type AccessRole = 'player' | 'admin';
export type AccessPermission = 'admin.read' | 'admin.manage' | 'admin.cards' | 'catalog.read' | 'card-policies.read' | 'card-policies.manage' | 'card-stats.provide' | 'catalog.preview' | 'catalog.publish' | 'accounts.register' | 'currency.grant' | 'currency.settle' | 'audit.read' | 'events.read' | 'maintenance.run' | 'trading.manage' | 'actions.manage' | 'actions.dispatch' | 'commerce.manage' | 'raffles.draw' | 'codes.manage' | 'bindings.manage' | 'codes.import' | 'codes.confirm' | 'art.import' | 'art.review' | 'art.publish' | 'art.moderate';
export interface AuthenticatedAccessIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly userId: string;
}
export interface AccessProviderRequest extends AuthenticatedAccessIdentity {
  readonly protocol: 'digital-card-access-provider@1';
  readonly operation: 'resolveAccess';
  readonly scope: 'access';
  readonly requestId: string;
  readonly providerId: string;
  readonly grantId: string;
  readonly generation: number;
  readonly deadline: number;
}
export type AccessProviderResponse = AccessProviderRequest & (
  {readonly status: 'allowed'; readonly role: AccessRole; readonly permissions: readonly AccessPermission[]} |
  {readonly status: 'denied' | 'disabled'} |
  {readonly status: 'error'; readonly errorCode: 'invalid-request' | 'unauthenticated' | 'rate-limited' | 'unavailable'}
);
export declare const accessProviderProtocol: 'digital-card-access-provider@1';
export declare const accessProviderSchema: Record<string, unknown>;
export declare function validateAccessProviderRequest(value: unknown): AccessProviderRequest;
export declare function validateAccessProviderResponse(value: unknown): AccessProviderResponse;
