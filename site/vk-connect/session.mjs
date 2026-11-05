import { createTextPublisher } from './vk-publisher.mjs';
export const APP_ID = 54867924;
export const REDIRECT_URL = 'https://vichepaev22.github.io/content-planner-demo/vk-connect/';
export class LoginError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const problem = (code, message) => { throw new LoginError(code, message); };
const random = cryptoImpl => {
  const values = cryptoImpl.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...values)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
function scopes(value) {
  if (typeof value !== 'string') return [];
  if (/^\d+$/.test(value)) return [['groups', 262144], ['wall', 8192]].filter(([, bit]) => (Number(value) & bit) !== 0).map(([name]) => name);
  return [...new Set(value.split(/[\s,]+/).filter(s => /^[a-z_][a-z_.]{0,60}$/.test(s)))];
}
function community(value) {
  const id = Number(value?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof value.name !== 'string' || !['group', 'page', 'event'].includes(value.type)) problem('FORMAT', 'VK вернул неполные сведения о сообществе.');
  return { id, name: value.name.slice(0, 512), type: value.type,
    managed: value.is_admin === 1 || value.is_admin === true,
    adminLevel: [1, 2, 3].includes(Number(value.admin_level)) ? Number(value.admin_level) : 0,
    members: Number.isSafeInteger(value.members_count) && value.members_count >= 0 ? value.members_count : null,
    url: `https://vk.com/club${id}` };
}
async function boundedJson(response) {
  if (!response.ok) problem('VK_HTTP', 'VK отклонил запрос или временно недоступен.');
  const reader = response.body?.getReader();
  if (!reader) problem('FORMAT', 'VK вернул пустой ответ.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); problem('SIZE', 'Ответ VK слишком большой.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof LoginError) throw error;
    problem('FORMAT', 'VK вернул неожиданный формат ответа.');
  } finally { reader.releaseLock(); }
}
export function createBrowserSession({ sdk, cryptoImpl = globalThis.crypto, fetchImpl = globalThis.fetch,
  now = Date.now, onChange = () => {}, pageBudget = 5, delayMs = 350, exchangeTimeoutMs = 15000 } = {}) {
  let attempt = null, auth = null, groups = [], total = null, complete = false, selected = null;
  let revision = 0, loading = false, note = '';
  const snapshot = () => ({ authenticated: Boolean(auth), userId: auth?.userId ?? null,
    expiresAt: auth?.expiresAt ?? null, scopes: [...(auth?.scopes ?? [])], hasGroups: auth?.scopes.includes('groups') ?? false, hasWall: auth?.scopes.includes('wall') ?? false, catalogReadable: total !== null, publication: publisher.snapshot(),
    groups: groups.map(g => ({ ...g })), total, complete, selected: selected ? { ...selected } : null, loading, note });
  const emit = () => onChange(snapshot());
  const publisher = createTextPublisher({ connection: () => { const c = requireAuth(); return { token: c.token, userId: c.userId, scopes: c.scopes, selected }; }, fetchImpl, cryptoImpl, now, onChange: emit });
  function clear(message = '') { revision++; attempt = null; auth = null; groups = []; total = null; complete = false; selected = null; loading = false; note = message; publisher.reset(); }
  function expire() {
    if (auth && auth.expiresAt <= now()) { clear('Срок сеанса истёк. Войдите через VK заново.'); emit(); }
  }
  function requireAuth() { expire(); if (!auth) problem('LOGIN', 'Сначала войдите через VK.'); return auth; }
  function check(epoch) { if (epoch !== revision || !auth || auth.expiresAt <= now()) problem('SESSION_CHANGED', 'Сеанс изменился. Войдите заново.'); }
  return {
    snapshot, expire,
    prepare(scope = '') {
      if (!['', 'groups', 'groups wall'].includes(scope)) problem('SCOPE', 'Неизвестный набор разрешений.');
      clear();
      attempt = { state: random(cryptoImpl), verifier: random(cryptoImpl), expiresAt: now() + 600000, epoch: revision };
      note = scope ? 'Вход запросит доступ groups. VK покажет разрешения перед подтверждением.' : 'Готов базовый вход VK ID. Доступ к сообществам запрашивается отдельно.';
      emit();
      return { app: APP_ID, redirectUrl: REDIRECT_URL, state: attempt.state, codeVerifier: attempt.verifier, scope };
    },
    restore(proof) {
      if (proof?.app !== APP_ID || proof.redirectUrl !== REDIRECT_URL || !['', 'groups', 'groups wall'].includes(proof.scope) ||
          !/^[A-Za-z0-9_-]{43}$/.test(proof.state) || !/^[A-Za-z0-9_-]{43}$/.test(proof.codeVerifier) ||
          !Number.isFinite(proof.expiresAt) || proof.expiresAt <= now() || proof.expiresAt > now() + 600000) problem('STATE', 'Попытка входа истекла. Начните заново.');
      clear(); attempt = { state: proof.state, verifier: proof.codeVerifier, expiresAt: proof.expiresAt, epoch: revision };
      emit(); return { app: APP_ID, redirectUrl: REDIRECT_URL, state: attempt.state, codeVerifier: attempt.verifier, scope: proof.scope };
    },
    async authorize(payload) {
      const pending = attempt; attempt = null;
      if (!pending || pending.expiresAt <= now() || payload?.state !== pending.state ||
          typeof payload?.code !== 'string' || !payload.code || payload.code.length > 4096 ||
          typeof payload?.device_id !== 'string' || !payload.device_id || payload.device_id.length > 4096) {
        problem('STATE', 'Попытка входа устарела или не подтверждена. Подготовьте вход заново.');
      }
      loading = true; note = 'VK подтвердил код. Завершаем вход…'; emit();
      try {
        let timer;
        const data = await Promise.race([
          sdk.Auth.exchangeCode(payload.code, payload.device_id, pending.verifier),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new LoginError('TIMEOUT', 'VK не ответил вовремя. Подготовьте вход заново.')), exchangeTimeoutMs); })
        ]).finally(() => clearTimeout(timer));
        if (pending.epoch !== revision) problem('SESSION_CHANGED', 'Сеанс изменился. Начните вход заново.');
        if (data?.state !== pending.state || typeof data.access_token !== 'string' || !data.access_token || !/^\d+$/.test(String(data.user_id))) problem('TOKEN', 'VK не подтвердил результат входа. Попробуйте заново.');
        const seconds = Number(data.expires_in);
        auth = { token: data.access_token, userId: String(data.user_id), scopes: scopes(data.scope),
          expiresAt: now() + Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds : 900, 3600) * 1000 };
        // Refresh/id tokens and the complete provider response are never retained or rendered.
        note = auth.scopes.includes('groups') ? 'Вход VK выполнен. Теперь можно проверить список сообществ.' : 'Вход VK выполнен. Разрешение groups пока не подтверждено.';
      } catch (error) {
        if (pending.epoch === revision) { clear(error instanceof LoginError ? error.message : 'VK не завершил вход. Проверьте адрес возврата, публичный тип приложения и сохранение настроек в кабинете VK.'); }
        if (error instanceof LoginError) throw error;
        problem('EXCHANGE', 'VK не завершил вход. Проверьте настройки приложения и начните заново.');
      } finally { if (pending.epoch === revision || !auth) { loading = false; emit(); } }
      loading = false; emit(); return snapshot();
    },
    async loadGroups(reset = false, explicitProbe = false) {
      const current = requireAuth(), epoch = revision;
      if (!current.scopes.includes('groups') && !explicitProbe) problem('GROUPS_SCOPE', 'Вход выполнен, но VK не предоставил разрешение groups. Подключите доступ к сообществам отдельно.');
      if (loading) problem('BUSY', 'Дождитесь текущего запроса.');
      if (reset) { groups = []; total = null; complete = false; selected = null; }
      loading = true; emit();
      try {
        for (let page = 0; page < pageBudget && !complete; page++) {
          let response;
          try {
            response = await fetchImpl('https://api.vk.ru/method/groups.get', {
              method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${current.token}` },
              body: new URLSearchParams({ v: '5.199', extended: '1', fields: 'members_count', count: '1000', offset: String(groups.length) }), signal: AbortSignal.timeout(15000)
            });
          } catch { problem('NETWORK', 'Браузер не получил данные VK: возможны ограничение CORS, сеть или недоступность API. Токен не передаётся сторонним прокси. Для этого случая понадобится серверный коннектор.'); }
          const data = await boundedJson(response); check(epoch);
          if (data?.error) {
            const vkCode = Number(data.error.error_code);
            const suffix = Number.isSafeInteger(vkCode) && vkCode > 0 && vkCode <= 1000000 ? ` (код VK ${vkCode})` : '';
            if (vkCode === 260) problem('VK_PRIVACY', 'VK отказал в чтении списка из-за настроек приватности пользователя.' + suffix);
            if (vkCode === 5) { clear('VK завершил сеанс. Войдите заново.'); problem('EXPIRED', 'VK завершил сеанс. Войдите заново.'); }
            if ([7, 15, 27, 28].includes(vkCode)) problem('VK_ACCESS', 'VK не разрешил чтение сообществ. Проверьте доступ groups в настройках приложения; он может требовать согласования с VK.' + suffix);
            if ([6, 9, 29].includes(vkCode)) problem('VK_LIMIT', 'VK ограничил частоту запросов. Повторите позже.' + suffix);
            problem('VK_API', 'VK не предоставил список сообществ.' + suffix + ' Проверьте доступы приложения и условия метода groups.get.');
          }
          const result = data?.response;
          if (!result || !Array.isArray(result.items) || result.items.length > 1000 || !Number.isSafeInteger(result.count) || result.count < 0) problem('FORMAT', 'VK вернул неполный список.');
          if (total !== null && total !== result.count) problem('CHANGED', 'Список изменился во время загрузки. Нажмите «Обновить».');
          const parsed = result.items.map(community), seen = new Set(groups.map(g => g.id));
          if (parsed.some(g => seen.has(g.id) || !seen.add(g.id)) || (!parsed.length && groups.length < result.count) || groups.length + parsed.length > result.count) problem('PARTIAL', 'Список VK неполон или изменился. Нажмите «Обновить».');
          total = result.count; groups.push(...parsed); complete = groups.length === total;
          if (!complete && page + 1 < pageBudget && delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
          check(epoch);
        }
        note = complete ? 'Список загружен полностью.' : 'Показана часть списка. Продолжите загрузку.';
      } finally { if (epoch === revision) loading = false; emit(); }
      return snapshot();
    },
    async probeGroups(reset = false) { return this.loadGroups(reset, true); },
    preparePost(draft) { return publisher.prepare(draft); },
    async submitPost(id) { return publisher.submit(id); },
    discardPost() { publisher.discard(); },
    select(id) {
      requireAuth(); const found = groups.find(g => g.id === id);
      if (!found) problem('SELECTION', 'Выберите сообщество из полученного списка.');
      selected = found; publisher.discard(); note = 'Сообщество выбрано для просмотра. Изменений в VK не выполнено.'; emit();
    },
    logout() { clear('Сеанс на этой странице завершён. Доступ приложения можно отозвать в настройках VK.'); emit(); },
    clear() { clear(); emit(); }
  };
}
