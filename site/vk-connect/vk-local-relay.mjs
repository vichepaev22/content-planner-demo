import { APP_ID, REDIRECT_URL, LoginError } from './session.mjs';
import { parseRedirectPayload } from './redirect.mjs';
export const LOCAL_ORIGIN = 'http://localhost:4319';
const KEY = 'content-planner:vkid:local-v1';
const valid = v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const fail = () => { throw new LoginError('LOCAL_RELAY', 'Локальный вход устарел или не подтверждён. Начните его заново в Content Planner на вашем компьютере.'); };
// Only a fixed loopback destination. Never accept a URL, token or verifier from the page.
export function localRelay(href, storage = window.sessionStorage, now = Date.now()) {
  const u = new URL(href), q = u.searchParams;
  if (u.origin + u.pathname !== REDIRECT_URL) fail();
  if (q.has('local_connect')) {
    if (q.get('local_connect') !== '1' || u.hash || [...q.keys()].some(k => !['local_connect', 'state', 'code_challenge', 'scope'].includes(k)) ||
        [...q.keys()].some(k => q.getAll(k).length !== 1) || !valid(q.get('state')) || !valid(q.get('code_challenge')) || !['groups', 'groups wall'].includes(q.get('scope'))) fail();
    storage.setItem(KEY, JSON.stringify({ state: q.get('state'), expiresAt: now + 600000 }));
    const target = new URL('https://id.vk.ru/authorize');
    for (const [k, v] of Object.entries({ client_id: String(APP_ID), response_type: 'code', redirect_uri: REDIRECT_URL,
      state: q.get('state'), code_challenge: q.get('code_challenge'), code_challenge_method: 'S256', scope: 'vkid.personal_info ' + q.get('scope') })) target.searchParams.set(k, v);
    return { kind: 'start', url: target.href };
  }
  if (!['code', 'payload', 'error'].some(k => q.has(k))) return null;
  const saved = storage.getItem(KEY);
  if (!saved) return null;
  storage.removeItem(KEY); // one-shot, including denial or a bad callback
  let pending;
  try { pending = JSON.parse(saved); } catch { fail(); }
  if (!valid(pending?.state) || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= now || pending.expiresAt > now + 600000) fail();
  const payload = parseRedirectPayload(href);
  if (!payload || payload.state !== pending.state) fail();
  const target = new URL('/callback', LOCAL_ORIGIN);
  for (const [k, v] of Object.entries(payload)) target.searchParams.set(k, v);
  return { kind: 'callback', url: target.href };
}
