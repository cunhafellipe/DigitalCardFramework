/** Known server permissions. Principal values must come from trusted authentication. */
export declare const PERMISSIONS: readonly ["admin.read","admin.manage","admin.cards","catalog.read","card-policies.read","card-policies.manage","card-stats.provide","catalog.preview","catalog.publish","accounts.register","currency.grant","currency.settle","audit.read","events.read","maintenance.run","trading.manage","actions.manage","actions.dispatch","commerce.manage","raffles.draw","codes.manage","bindings.manage","codes.import","codes.confirm","art.import","art.review","art.publish","art.moderate"];
export type Permission = typeof PERMISSIONS[number];
export interface PermissionActor {
  id?: string;
  userId?: string;
  role?: string;
  disabled?: boolean;
  permissions?: readonly string[];
  [key: string]: unknown;
}
/** Unknown permission names and absent or disabled actors return false. */
export function hasPermission(actor: PermissionActor | null | undefined, permission: string): boolean;
export function publicPermissions(actor: PermissionActor | null | undefined): Permission[];
/** Unknown actions return false. */
export function authorizePresentation(actor: PermissionActor | null | undefined, action: string, resource?: {actor?: string; [key: string]: unknown} | null): boolean;
