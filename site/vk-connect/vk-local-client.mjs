import { LoginError } from './session.mjs';
export function createLocalSession({ onChange }) {
  let csrf = '', value;
  async function call(path, body) {
    let response;
    try { response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error',
      headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000) }); }
    catch { throw new LoginError('LOCAL_NETWORK', 'Локальный процесс не ответил. Если выполнялась отправка, проверьте запись в VK перед повтором.'); }
    const data = await response.json();
    if (data.state) { value = data.state; csrf = data.csrf; onChange(value); }
    if (!response.ok) throw new LoginError(data.error ?? 'LOCAL', data.message ?? 'Локальное действие не выполнено.');
    return data.result;
  }
  return {
    initialize: () => call('/api/status'),
    begin: scope => call('/api/auth/start', { scope }),
    snapshot: () => value,
    expire() { call('/api/status').catch(() => {}); },
    loadGroups: (reset = false) => call('/api/groups', { reset }),
    probeGroups: (reset = false) => call('/api/groups', { reset }),
    select: id => call('/api/select', { id }),
    preparePost: draft => call('/api/post/prepare', draft),
    submitPost: id => call('/api/post/submit', { id }),
    discardPost: () => call('/api/post/discard', {}),
    logout: () => call('/api/logout', {}),
    clear() {} // navigation does not log out the local server session
  };
}
