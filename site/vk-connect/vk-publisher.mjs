export class PublishError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, text) => { throw new PublishError(code, text); };
export function createTextPublisher({ connection, fetchImpl = fetch, cryptoImpl = globalThis.crypto, now = Date.now, onChange = () => {} }) {
  let draft = null, last = null, busy = false, revision = 0;
  const snapshot = () => ({ review: draft ? { ...draft.public } : null, result: last ? { ...last.public } : null, busy });
  const emit = () => onChange();
  function context() {
    const value = connection(), g = value.selected;
    if (!g || !Number.isSafeInteger(g.id) || g.id <= 0) fail('SELECT_GROUP', 'Выберите своё сообщество из загруженного списка.');
    if (!g.managed || ![2, 3].includes(g.adminLevel)) fail('ROLE', 'Для этого теста нужна роль редактора или администратора сообщества.');
    if (!value.scopes.includes('wall')) fail('WALL', 'VK не предоставил право wall. Подключите разрешение публикации; для нового приложения оно может требовать согласования с поддержкой VK.');
    return value;
  }
  return {
    snapshot,
    reset() { revision++; draft = null; last = null; busy = false; },
    discard() { draft = null; emit(); },
    prepare({ text, mode = 'now', publishAtMs = null }) {
      if (busy) fail('BUSY', 'Дождитесь результата предыдущей отправки.');
      const c = context(), message = typeof text === 'string' ? text.trim() : '';
      if (!message || message.length > 2000) fail('TEXT', 'Введите текст от 1 до 2000 символов.');
      if (!['now', 'scheduled'].includes(mode)) fail('MODE', 'Выберите публикацию сейчас или по времени.');
      let publishDate = null;
      if (mode === 'scheduled') {
        if (!Number.isFinite(publishAtMs) || publishAtMs < now() + 120000 || publishAtMs > now() + 7 * 86400000) fail('DATE', 'Для теста выберите время от 2 минут до 7 дней вперёд.');
        publishDate = Math.floor(publishAtMs / 1000);
      }
      const signature = JSON.stringify([c.userId, c.selected.id, message, publishDate]);
      if (last?.signature === signature && ['sending', 'published', 'scheduled', 'unknown'].includes(last.public.status)) fail('DUPLICATE', 'Этот текст уже отправлялся с такими параметрами. Проверьте результат в VK перед повтором.');
      const id = cryptoImpl.randomUUID();
      draft = { signature, userId: c.userId, revision, public: { id, groupId: c.selected.id, groupName: c.selected.name, text: message, mode, publishDate } };
      emit(); return snapshot().review;
    },
    async submit(id) {
      if (busy) fail('BUSY', 'Отправка уже выполняется.');
      const prepared = draft, c = context();
      if (!prepared || prepared.public.id !== id || prepared.revision !== revision || prepared.userId !== c.userId || prepared.public.groupId !== c.selected.id) fail('REVIEW', 'Составьте и проверьте предпросмотр заново.');
      if (prepared.public.publishDate !== null && prepared.public.publishDate < Math.floor(now() / 1000) + 120) fail('DATE', 'Время публикации слишком близко. Выберите новое время и проверьте предпросмотр.');
      draft = null; busy = true;
      const epoch = revision, review = prepared.public;
      last = { signature: prepared.signature, public: { status: 'sending', groupId: review.groupId, groupName: review.groupName, publishDate: review.publishDate } }; emit();
      const body = new URLSearchParams({ v: '5.199', owner_id: String(-review.groupId), from_group: '1', message: review.text, guid: review.id });
      if (review.publishDate !== null) body.set('publish_date', String(review.publishDate));
      let confirmedFailure = false;
      try {
        const response = await fetchImpl('https://api.vk.ru/method/wall.post', {
          method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${c.token}` }, body, signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error('transport');
        const reader = response.body?.getReader(); if (!reader) throw new Error('empty');
        let bytes = 0, text = ''; const decoder = new TextDecoder();
        try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 65536) { await reader.cancel(); throw new Error('size'); } text += decoder.decode(value, { stream: true }); } text += decoder.decode(); }
        finally { reader.releaseLock(); }
        const data = JSON.parse(text);
        if (data?.error) {
          confirmedFailure = true;
          const code = Number(data.error.error_code);
          if ([7, 15, 27, 28, 214].includes(code)) fail('VK_DENIED', 'VK отклонил публикацию. Проверьте право wall, тип приложения и роль в сообществе.');
          if (code === 5) fail('VK_EXPIRED', 'VK завершил сеанс. Войдите заново.');
          if ([6, 9, 29].includes(code)) fail('VK_LIMIT', 'VK ограничил запросы. Повторите позже после проверки стены.');
          fail('VK_ERROR', 'VK отклонил запись. Проверьте текст, время и разрешения приложения.');
        }
        const postId = Number(data?.response?.post_id);
        if (!Number.isSafeInteger(postId) || postId <= 0) throw new Error('format');
        if (epoch !== revision) fail('SESSION_CHANGED', 'Сеанс изменился. Проверьте результат на стене VK.');
        last.public = { ...last.public, status: review.mode === 'scheduled' ? 'scheduled' : 'published', postId, url: `https://vk.com/wall-${review.groupId}_${postId}` };
        return { ...last.public };
      } catch (error) {
        if (epoch === revision && last) last.public.status = confirmedFailure ? 'failed' : 'unknown';
        if (error instanceof PublishError) throw error;
        fail('UNKNOWN', 'Не удалось получить результат отправки. Неизвестно, принял ли VK запись. Проверьте стену и отложенные записи перед повтором; автоматического повтора нет.');
      } finally { if (epoch === revision) { busy = false; emit(); } }
    }
  };
}
