export interface WalletNonce {nonce: string; expires: number}
export interface WalletChallenge {
  domain: string;
  uri: string;
  nonce: string;
  version: '1';
  issuedAt: string;
  expirationTime: string;
}
/** Message fields accepted by the SIWE constructor, or its serialized form. */
export interface WalletMessage {
  scheme?: string;
  domain?: string;
  address?: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: number;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}
export function walletSessions(options: {
  domain: string; uri: string; chainIds: readonly number[];
  clock?: () => number; ttlMs?: number; nonces?: Map<string, WalletNonce>;
}): {
  challenge(sessionId: string): WalletChallenge;
  verify(sessionId: string, proof: {message: string | WalletMessage; signature: string}): Promise<{
    address: string; chainId: number; verifiedAt: number;
  }>;
};
export interface TokenBinding {
  chainId: number;
  standard: 'erc721' | 'erc1155';
  contract: string;
  tokenId: string;
}
export interface TokenIdentity extends TokenBinding {id: string}
export function tokenIdentity(binding: TokenBinding): TokenIdentity;
export interface OwnershipProvider {
  getNetwork(): Promise<{chainId: number | bigint}>;
  getBlockNumber(): Promise<number>;
  getBlock(height: number): Promise<{hash: string | null} | null>;
  readToken(identity: TokenIdentity, account: string, blockTag: number): Promise<{
    owner?: string; balance?: string | number | bigint;
  }>;
}
export interface OwnershipSnapshotBase {
  identity: TokenIdentity;
  quantity: string;
  blockNumber: number;
  blockHash: string;
  checkedAt: number;
  authority: 'external';
}
export type ExternalOwnershipSnapshot = OwnershipSnapshotBase & (
  {state: 'reorg'; quantity: '0'} |
  {state: 'confirmed'; account: string; confirmations: number}
);
export function resolveExternalOwnership(binding: TokenBinding, options: {
  provider: OwnershipProvider; account: string; confirmations?: number; clock?: () => number;
}): Promise<ExternalOwnershipSnapshot>;
export type ExternalOwnershipState<T extends {checkedAt: number; state: string}> =
  T extends unknown ? Omit<T, 'state' | 'localTransferAllowed'> & {state: T['state'] | 'stale'; localTransferAllowed: false} : never;
export function externalOwnershipState<T extends {checkedAt: number; state: string}>(snapshot: T,
  options?: {maxAgeMs?: number; clock?: () => number},
): ExternalOwnershipState<T>;
export interface OwnershipContractCall {
  to: string;
  data: string;
  blockTag: number;
}
export interface OwnershipContractCaller {
  call(transaction: OwnershipContractCall): Promise<string>;
}
/** Read-only calls can be supplied by the runner itself or its attached provider. */
export type EthersOwnershipRunner = Pick<OwnershipProvider, 'getNetwork' | 'getBlockNumber' | 'getBlock'> & (
  (OwnershipContractCaller & {provider: OwnershipContractCaller | null}) |
  {provider: OwnershipContractCaller; call?: OwnershipContractCaller['call']}
);
/** Importing this module at runtime requires the optional ethers and siwe presentation dependencies. */
export function ethersOwnershipProvider(provider: EthersOwnershipRunner): OwnershipProvider;
export function marketplaceMetadata<A = unknown>(options: {
  title: string; description: string; posterURL: string; viewerURL: string; attributes?: A[];
}): {
  name: string; description: string; image: string; external_url: string; animation_url: string; attributes: A[];
};
