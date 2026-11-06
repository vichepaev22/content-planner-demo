const $ = id => document.getElementById(id);
const zone = 'Asia/Yekaterinburg';
let imagePreview = ''; const mediaUrls = new Map(), mediaLoads = new Map();
let origin = '', token = '', expiresAt = 0, groups = [], jobs = [], state, busy = false, screenshotUrl = '';
const labels = { draft: 'Предпросмотр · не отправлено', approved: 'Утверждено · ожидает VPS', preparing: 'VPS заполняет редактор VK', sending: 'Отправка началась', published: 'VK подтвердил публикацию', scheduled: 'VK подтвердил приём в отложенные', unknown: 'Результат неизвестен · проверьте VK', blocked: 'Остановлено до отправки', cancelled: 'Отменено до отправки' };
const notify = (text, error = false) => { $('notice').textContent = text; $('notice').classList.toggle('error', error); };
function node(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function endpoint(value) {
  const u = new URL(value);
  if (u.href.replace(/\/$/, '') !== value.replace(/\/$/, '') || !/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(u.pathname) || u.search || u.hash || u.username || u.password || (u.protocol !== 'https:' && !(location.hostname === 'localhost' && u.origin === 'http://localhost:4320'))) throw new Error('Нужен только HTTPS-адрес вашего API с допустимым префиксом API, без логина и параметров.');
  return u.origin + u.pathname.replace(/\/$/, '');
}
function clearSession() {
  for (const url of mediaUrls.values()) URL.revokeObjectURL(url); mediaUrls.clear(); mediaLoads.clear(); clearImage();
  token = ''; expiresAt = 0; groups = []; jobs = []; state = null; $('owner-password').value = '';
  if (screenshotUrl) URL.revokeObjectURL(screenshotUrl); screenshotUrl = ''; $('auth-screen').hidden = true; $('auth-screen').removeAttribute('src'); $('auth-hint').hidden = true; $('enlarge-auth').hidden = true; $('vk-login-code').value = ''; $('auth-dialog').close(); $('auth-large').removeAttribute('src'); render();
}
async function api(path, body, binary = false, mediaType = null) {
  if (!origin) throw new Error('Сначала укажите VPS.');
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': mediaType ?? 'application/json' }) }, body: body === undefined ? undefined : (mediaType ? body : JSON.stringify(body)), signal: AbortSignal.timeout(45000) });
  if (binary && response.ok) return response.blob();
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 && token) clearSession(); throw new Error(data.message ?? 'Сервер отклонил действие.'); }
  return data;
}
async function work(action) { if (busy) return; busy = true; render(); try { await action(); } catch (error) { notify(error instanceof TypeError ? 'Сервер не ответил. Проверьте HTTPS-адрес, доступность VPS и разрешённый Origin. Если отправка уже была утверждена, сначала проверьте её результат в очереди.' : error.message, true); } finally { busy = false; render(); } }
async function refresh() { const result = await api('/api/status'); state = result; jobs = result.queue; render(); }
function render() {
  const connected = Boolean(token && expiresAt > Date.now()), vkReady = connected && state?.browser.authenticated;
  const challenge = state?.browser.authChallenge; $('vk-code-form').hidden = !connected || vkReady || !challenge; $('submit-vk-code').disabled = busy || !challenge; $('vk-login-code').disabled = busy || !challenge;
  if (challenge) { $('vk-login-code').minLength = challenge.minLength; $('vk-login-code').maxLength = challenge.maxLength; $('vk-login-code').pattern = `[0-9]{${challenge.minLength},${challenge.maxLength}}`; }
  $('connect-form').hidden = connected; $('disconnect').hidden = !connected;
  $('server-url').disabled = busy; $('connect').disabled = busy;
  for (const id of ['start-browser', 'show-qr', 'refresh']) $(id).disabled = !connected || busy || Boolean(state?.workerBusy) || (id !== 'refresh' && Boolean(state?.browser.setupBlocked));
  $('load-groups').disabled = !vkReady || busy || Boolean(state?.workerBusy);
  for (const id of ['group', 'post-text', 'post-mode', 'prepare-post', 'plan-file', 'import-plan', 'post-image', 'clear-image']) $(id).disabled = !vkReady || !groups.length || busy;
  $('server-status').textContent = connected ? 'Связь с VPS подтверждена. Доступ текущей вкладки действует до ' + new Date(expiresAt).toLocaleTimeString('ru-RU', { timeZone: zone }) + ' (Екатеринбург).' : 'Подключения пока нет.';
  $('vk-status').textContent = !connected ? 'После подключения откройте VK в выделенном браузере VPS.' : state?.browser.setupBlocked ? 'Сервер готов. Настройка браузера ещё не завершена; публикация пока недоступна.' : vkReady ? 'VK в серверном браузере вошёл в учётную запись. Проверьте сообщества.' : state?.browser.started ? 'VK ожидает входа владельца на VPS. Обновите экран и подтвердите вход телефоном.' : 'Сервер подключён. Нажмите «Открыть VK на VPS».';
  if (vkReady) { $('vk-login-code').value = ''; $('enlarge-auth').hidden = true; $('auth-dialog').close(); $('auth-large').removeAttribute('src'); }
  if (vkReady && screenshotUrl) { URL.revokeObjectURL(screenshotUrl); screenshotUrl = ''; $('auth-screen').hidden = true; $('auth-hint').hidden = true; $('auth-screen').removeAttribute('src'); }
  $('jobs').replaceChildren();
  if (!jobs.length) $('jobs').append(node('p', connected ? 'Очередь сервера пуста.' : 'После подключения здесь появятся реальные записи вашего сервера.', 'empty'));
  for (const j of [...jobs].reverse()) {
    const article = node('article', null, 'job'), g = groups.find(g => g.id === j.groupId);
    article.append(node('h3', g?.name ?? `Сообщество ${j.groupId}`), node('span', labels[j.status] ?? j.status, 'state ' + j.status), node('p', j.text, 'copy'), node('p', j.publishAt ? 'По плану: ' + new Date(j.publishAt).toLocaleString('ru-RU', { timeZone: zone }) + ' · Екатеринбург' : 'Сразу после утверждения и проверки VPS.', 'hint'));
    if (j.image) {
      const image = node('img', null, 'post-image'); image.alt = 'Картинка этой публикации'; article.append(image);
      if (mediaUrls.has(j.image.id)) image.src = mediaUrls.get(j.image.id);
      else if (!mediaLoads.has(j.image.id)) {
        const session = token;
        const load = api('/api/media/' + j.image.id, undefined, true).then(blob => {
          if (session !== token || !token) return;
          mediaUrls.set(j.image.id, URL.createObjectURL(blob)); render();
        }).catch(() => { image.alt = 'Предпросмотр изображения временно недоступен'; }).finally(() => mediaLoads.delete(j.image.id));
        mediaLoads.set(j.image.id, load);
      }
    }
    if (j.note) article.append(node('p', j.note, 'hint'));
    const controls = node('div', null, 'controls');
    const retryImage = j.status === 'blocked' && j.image && !j.result && (j.note === 'VK не подтвердил готовность фотографии. Запись не отправлена.' || j.note === 'В новом редакторе уже есть вложения. Проверьте прежний черновик VK.' && j.resumeImagePreparation && (j.preparationRetryOrigin === 'image-upload-readiness' || j.previousPreparationNote === 'VK не подтвердил готовность фотографии. Запись не отправлена.'));
    if (j.status === 'draft' || retryImage) {
      const send = node('button', retryImage ? 'Повторить подготовку фотографии' : j.mode === 'scheduled' ? 'Утвердить и передать в отложенные VK' : 'Утвердить и опубликовать'); send.type = 'button'; send.disabled = busy || !vkReady;
      send.addEventListener('click', () => work(async () => { await api(`/api/jobs/${j.id}/approve`, { reviewHash: j.reviewHash }); await refresh(); notify('Запись утверждена. VPS выполнит проверку редактора и отправку. Результат появится в очереди.'); })); controls.append(send);
    }
    if (['draft', 'approved', 'blocked'].includes(j.status)) {
      const cancel = node('button', 'Отменить до отправки', 'secondary'); cancel.type = 'button'; cancel.disabled = busy; cancel.addEventListener('click', () => work(async () => { await api(`/api/jobs/${j.id}/cancel`, {}); await refresh(); })); controls.append(cancel);
    }
    if (/^https:\/\/vk\.ru\/wall-\d+_\d+$/.test(j.result?.url ?? '')) { const a = node('a', 'Открыть подтверждённую запись в VK ↗'); a.href = j.result.url; a.target = '_blank'; a.rel = 'noreferrer'; controls.append(a); }
    article.append(controls); $('jobs').append(article);
  }
}
function updateMode() { $('time-label').hidden = $('post-mode').value !== 'scheduled'; $('post-time').required = $('post-mode').value === 'scheduled'; }
function draftFromForm() { return { groupId: Number($('group').value), text: $('post-text').value, mode: $('post-mode').value, publishAt: $('post-mode').value === 'scheduled' ? $('post-time').value + ':00+05:00' : null }; }
$('connect-form').addEventListener('submit', event => { event.preventDefault(); const password = $('owner-password').value; const nextOrigin = $('server-url').value.trim(); work(async () => {
  clearSession(); origin = endpoint(nextOrigin); const result = await api('/api/login', { password }); token = result.token; expiresAt = result.expiresAt; $('owner-password').value = '';
  try { localStorage.setItem('content-planner:vps-origin', origin); } catch {}
  await refresh(); notify('Соединение с VPS установлено. Теперь откройте серверный браузер VK.');
}); });
$('disconnect').addEventListener('click', () => work(async () => { try { await api('/api/logout', {}); } finally { clearSession(); notify('Сеанс этой вкладки завершён. Утверждённые задания остаются на вашем VPS.'); } }));
$('start-browser').addEventListener('click', () => work(async () => { await api('/api/browser/start', {}); await refresh(); if (!state.browser.authenticated) await screen(); }));
async function screen() { const blob = await api('/api/browser/screenshot', undefined, true); if (screenshotUrl) URL.revokeObjectURL(screenshotUrl); screenshotUrl = URL.createObjectURL(blob); $('auth-screen').src = screenshotUrl; $('auth-screen').hidden = false; $('auth-hint').hidden = false; $('enlarge-auth').hidden = false; $('auth-large').src = screenshotUrl; }
$('show-qr').addEventListener('click', () => work(async () => { await api('/api/browser/qr', {}); await screen(); await refresh(); }));
$('enlarge-auth').addEventListener('click', () => $('auth-dialog').showModal());
$('close-auth').addEventListener('click', () => $('auth-dialog').close());
$('vk-code-form').addEventListener('submit', event => { event.preventDefault(); const challengeId = state?.browser.authChallenge?.id; let code = $('vk-login-code').value; $('vk-login-code').value = ''; work(async () => { try { await api('/api/browser/code', { code, challengeId }); code = ''; await refresh(); if (!state.browser.authenticated) await screen(); notify(state.browser.authenticated ? 'VK подтвердил вход. Теперь проверьте сообщества.' : 'Код передан в VK. Обновите состояние и проверьте результат входа.'); } finally { code = ''; } }); });
$('load-groups').addEventListener('click', () => work(async () => { const result = await api('/api/groups'); groups = result.groups; $('group').replaceChildren(); for (const g of groups) { const option = node('option', g.name); option.value = g.id; $('group').append(option); } notify(`Сервер подтвердил сообществ: ${groups.length}.`); }));
$('post-form').addEventListener('submit', event => { event.preventDefault(); work(async () => { const value = draftFromForm(), file = $('post-image').files[0]; if (file) { if (!['image/png','image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Выберите PNG или JPEG до 5 МБ.'); const uploaded = await api('/api/media', file, false, file.type); value.mediaId = uploaded.media.id; } await api('/api/jobs', value); await refresh(); clearImage(); notify('Предпросмотр сохранён на VPS. Проверьте группу, текст и время; отправка начнётся только после утверждения записи в очереди.'); }); });
$('post-mode').addEventListener('change', updateMode);
$('refresh').addEventListener('click', () => work(refresh));
$('import-plan').addEventListener('click', () => work(async () => {
  const file = $('plan-file').files[0]; if (!file || file.size > 1024 * 1024) throw new Error('Выберите JSON-файл не больше 1 МБ.');
  let plan; try { plan = JSON.parse(await file.text()); } catch { throw new Error('Не удалось прочитать JSON-план.'); }
  if (!Array.isArray(plan) || !plan.length || plan.length > 100 || plan.some(p => !p || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 2000 || !['now', 'scheduled'].includes(p.mode) || Object.keys(p).some(k => !['text', 'mode', 'publishAt'].includes(k)))) throw new Error('План должен содержать от 1 до 100 корректных записей text/mode/publishAt.');
  let count = 0;
  try { for (const p of plan) { await api('/api/jobs', { ...p, groupId: Number($('group').value) }); count++; } }
  finally { $('import-status').textContent = `Импортировано черновиков: ${count} из ${plan.length}. Отправка не запускалась.`; await refresh(); }
}));
try { $('server-url').value = localStorage.getItem('content-planner:vps-origin') || 'https://31.76.80.185/content-planner-api'; } catch {}
const defaultTime = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + 600000)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
$('post-time').value = `${defaultTime.year}-${defaultTime.month}-${defaultTime.day}T${defaultTime.hour}:${defaultTime.minute}`;
setInterval(async () => { if (!token || busy || document.hidden) return; if (expiresAt <= Date.now()) { clearSession(); notify('Сеанс Content Planner истёк. Войдите снова отдельным паролем сервера.'); return; } try { await refresh(); } catch (error) { notify(error.message, true); } }, 5000);
window.addEventListener('pagehide', clearSession); updateMode(); render();

function clearImage() { if (imagePreview) URL.revokeObjectURL(imagePreview); imagePreview = ''; $('post-image').value = ''; $('image-preview').hidden = true; $('image-preview').removeAttribute('src'); $('clear-image').hidden = true; }
$('post-image').addEventListener('change', () => { if (imagePreview) URL.revokeObjectURL(imagePreview); imagePreview = ''; const file = $('post-image').files[0]; if (!file) { clearImage(); return; } if (!['image/png','image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) { clearImage(); notify('Выберите PNG или JPEG до 5 МБ.', true); return; } imagePreview = URL.createObjectURL(file); $('image-preview').src = imagePreview; $('image-preview').hidden = false; $('clear-image').hidden = false; });
$('clear-image').addEventListener('click', clearImage);
