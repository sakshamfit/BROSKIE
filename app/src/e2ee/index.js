/**
 * E2EE public barrel
 */

export * from './crypto';
export * from './keyStore';
export * from './chatKeys';
export * from './messageCrypto';
export * from './mediaCrypto';

export async function initE2EE(userId) {
  const { initSodium } = await import('./crypto');
  const { getOrCreateIdentityKeyPair } = await import('./keyStore');
  await initSodium();
  const kp = await getOrCreateIdentityKeyPair(userId);
  return kp;
}
