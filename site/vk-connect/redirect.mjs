import { APP_ID, REDIRECT_URL, LoginError } from './session.mjs';
const KEY = 'content-planner:vkid:pending-v1';
const bad = () => { throw new LoginError('REDIRECT', 'Попытка входа истекла или не подтверждена. Начните вход заново.'); };
export function validateProof(value, now = Date.now()) {
  if (!value || value.app !== APP_ID || value.redirectUrl !== REDIRECT_URL ||
      !['', 'groups', 'groups wall'].includes(value.scope) || !/^[A-Za-z0-9_-]{43}$/.test(value.state) ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.codeVerifier) || !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= now || value.expiresAt > now + 600000) bad();
  return { app: APP_ID, redirectUrl: REDIRECT_URL, state: value.state, codeVerifier: value.codeVerifier, scope: value.scope, expiresAt: value.expiresAt };
}
export function createProofStore(storage = window.sessionStorage, now = Date.now) {
  return {
    save(config) {
      const proof = validateProof({ ...config, expiresAt: now() + 600000 }, now());
      try { storage.setItem(KEY, JSON.stringify(proof)); }
      catch { throw new LoginError('STORAGE', 'Браузер не разрешил сохранить одноразовую проверку входа. Разрешите хранилище этой вкладки или используйте кнопку VK с новым окном.'); }
      return proof;
    },
    take() {
      let raw;
      try { raw = storage.getItem(KEY); storage.removeItem(KEY); } catch { bad(); }
      try { return validateProof(JSON.parse(raw), now()); } catch { bad(); }
    },
    clear() { try { storage.removeItem(KEY); } catch { /* already unavailable */ } }
  };
}
export async function buildRedirectUrl(config, cryptoImpl = globalThis.crypto) {
  validateProof({ ...config, expiresAt: Date.now() + 600000 });
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(config.codeVerifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const url = new URL('https://id.vk.ru/authorize');
  for (const [key, value] of Object.entries({ client_id: String(APP_ID), response_type: 'code', redirect_uri: REDIRECT_URL,
    state: config.state, code_challenge: challenge, code_challenge_method: 'S256',
    scope: 'vkid.personal_info' + (config.scope ? ' ' + config.scope : '') })) url.searchParams.set(key, value);
  return url.href;
}
export function parseRedirectPayload(href) {
  const url = new URL(href), query = url.searchParams, keys = ['code', 'state', 'device_id', 'payload', 'error'];
  if (!keys.some(key => query.has(key))) return null;
  if (url.origin + url.pathname !== REDIRECT_URL || url.search.length > 14000) bad();
  for (const key of query.keys()) if (query.getAll(key).length !== 1) bad();
  let value;
  if (query.has('payload')) {
    if (['code', 'state', 'device_id', 'error'].some(key => query.has(key))) bad();
    try { value = JSON.parse(query.get('payload')); } catch { bad(); }
  } else value = Object.fromEntries(keys.map(key => [key, query.get(key)]));
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.state !== 'string') bad();
  if (value.error) throw new LoginError('DENIED', 'Вход отменён или отклонён на стороне VK. Начните заново, когда будете готовы.');
  if (typeof value.code !== 'string' || !value.code || value.code.length > 4096 || typeof value.device_id !== 'string' || !value.device_id || value.device_id.length > 4096) bad();
  return { code: value.code, state: value.state, device_id: value.device_id };
}
