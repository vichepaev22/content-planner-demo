import {saveTabSession,restoreTabSession,clearTabSession} from './tab-session.mjs';
import { googleSheetCsvUrl, localPublicationTime, parseEditorialPlan, PLAN_MAX_BYTES } from './editorial-plan.mjs';
import { mountOutreach } from './outreach-workspace.mjs';
import { mountCampaign } from './campaign-workspace.mjs?v=r21';
const tabStorage=(()=>{try{return sessionStorage;}catch{return null;}})();
const $ = id => document.getElementById(id);
const zone = 'Asia/Yekaterinburg';
let imagePreview = ''; const mediaUrls = new Map(), mediaLoads = new Map();
let origin = '', token = '', expiresAt = 0, groups = [], jobs = [], state, busy = false, screenshotUrl = '';
let renderedQueue = '';
let editorialRows = [], selectedRow = 0, planLoad = 0;
const labels = { draft: 'Предпросмотр · не отправлено', approved: 'Утверждено · ожидает VPS', preparing: 'VPS заполняет редактор VK', sending: 'Отправка началась', published: 'VK подтвердил публикацию', scheduled: 'VK подтвердил приём в отложенные', submitted: 'Передано на модерацию', unknown: 'Результат неизвестен · проверьте VK', blocked: 'Остановлено до отправки', cancelled: 'Отменено до отправки' };
const notify = (text, error = false) => {
  const notice = $('notice');
  if (notice.textContent !== text) notice.textContent = text;
  notice.classList.toggle('error', error);
};
function node(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function endpoint(value) {
  const u = new URL(value);
  if (u.href.replace(/\/$/, '') !== value.replace(/\/$/, '') || !/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(u.pathname) || u.search || u.hash || u.username || u.password || (u.protocol !== 'https:' && !(location.hostname === 'localhost' && u.origin === 'http://localhost:4320'))) throw new Error('Нужен только HTTPS-адрес вашего API с допустимым префиксом API, без логина и параметров.');
  return u.origin + u.pathname.replace(/\/$/, '');
}
function clearSession() {
  resetEditorialPlan();
  activePanel = entryPanel;
  $('post-text').value = '';
  $('post-time').value = initialPublicationTime();
  $('post-mode').value = 'now';
  updateMode();
  clearTabSession(tabStorage);
  for (const url of mediaUrls.values()) URL.revokeObjectURL(url); mediaUrls.clear(); mediaLoads.clear(); clearImage();
  token = ''; expiresAt = 0; groups = []; jobs = []; state = null; $('owner-password').value = '';
  if (screenshotUrl) URL.revokeObjectURL(screenshotUrl); screenshotUrl = ''; $('auth-screen').hidden = true; $('auth-screen').removeAttribute('src'); $('auth-hint').hidden = true; $('enlarge-auth').hidden = true; $('vk-login-code').value = ''; $('auth-dialog').close(); $('auth-large').removeAttribute('src'); render();
}
async function api(path, body, binary = false, mediaType = null) {
  if (!origin) throw new Error('Сначала укажите VPS.');
  const session = token;
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    headers: { ...(session ? { Authorization: 'Bearer ' + session } : {}), ...(body === undefined ? {} : { 'Content-Type': mediaType ?? 'application/json' }) }, body: body === undefined ? undefined : (mediaType ? body : JSON.stringify(body)), signal: AbortSignal.timeout(45000) });
  if (binary && response.ok) return response.blob();
  const data = await response.json();
  if (!response.ok) {
    const message = data.message ?? 'Сервер отклонил действие.';
    if (response.status === 401 && session && token === session) {
      clearSession();
      notify(message, true);
    }
    throw new Error(message);
  }
  return data;
}
async function work(action) { if (busy) return; busy = true; render(); try { await action(); } catch (error) { notify(error instanceof TypeError ? 'Сервер не ответил. Проверьте HTTPS-адрес, доступность VPS и разрешённый Origin. Если отправка уже была утверждена, сначала проверьте её результат в очереди.' : error.message, true); } finally { busy = false; render(); } }
async function refresh() {
  const session = token;
  const result = await api('/api/status');
  if (session !== token) return;
  state = result;
  jobs = result.queue;
  render();
}
function render() {
  const connected = Boolean(token && expiresAt > Date.now()), vkReady = connected && state?.browser.authenticated;
  const challenge = state?.browser.authChallenge; $('vk-code-form').hidden = !connected || vkReady || !challenge; $('submit-vk-code').disabled = busy || !challenge; $('vk-login-code').disabled = busy || !challenge;
  if (challenge) { $('vk-login-code').minLength = challenge.minLength; $('vk-login-code').maxLength = challenge.maxLength; $('vk-login-code').pattern = `[0-9]{${challenge.minLength},${challenge.maxLength}}`; }
  $('server-title').textContent = connected ? 'VPS подключён' : 'Подключить VPS';
  $('connect-form').hidden = connected; $('disconnect').disabled = !connected || busy;
  $('server-url').disabled = busy; $('connect').disabled = busy;
  for (const id of ['start-browser', 'show-qr', 'refresh']) $(id).disabled = !connected || busy || Boolean(state?.workerBusy) || (id !== 'refresh' && Boolean(state?.browser.setupBlocked));
  $('load-groups').disabled = !vkReady || busy || Boolean(state?.workerBusy);
  for (const id of ['group', 'post-text', 'post-mode', 'prepare-post', 'plan-file', 'import-plan', 'post-image', 'clear-image']) $(id).disabled = !vkReady || !groups.length || busy;
  $('server-status').textContent = connected ? 'Сеанс в этой вкладке до ' + new Date(expiresAt).toLocaleTimeString('ru-RU', { timeZone: zone }) + ' (Екатеринбург).' : 'Подключения пока нет.';
  $('vk-status').textContent = !connected ? 'VK и сообщества подключатся после входа в кабинет.' : state?.browser.setupBlocked ? 'Сервер готов. Настройка браузера ещё не завершена; публикация пока недоступна.' : vkReady ? (groups.length?'VK подключён. Сообщества готовы к публикации.':'VK подключён. Загружаем сообщества.') : state?.browser.started ? 'VK ожидает входа владельца на VPS. Обновите экран и подтвердите вход телефоном.' : 'Сервер подключён. Нажмите «Открыть VK на VPS».';
  if (vkReady) { $('vk-login-code').value = ''; $('enlarge-auth').hidden = true; $('auth-dialog').close(); $('auth-large').removeAttribute('src'); }
  if (vkReady && screenshotUrl) { URL.revokeObjectURL(screenshotUrl); screenshotUrl = ''; $('auth-screen').hidden = true; $('auth-hint').hidden = true; $('auth-screen').removeAttribute('src'); }
  $('start-browser').hidden=Boolean(vkReady&&groups.length);$('show-qr').hidden=Boolean(vkReady);$('load-groups').hidden=Boolean(vkReady&&groups.length);
  renderWorkspace(connected, Boolean(vkReady && groups.length));
  renderQueue(connected, Boolean(vkReady));
}
function renderQueue(connected, vkReady) {
  const key = JSON.stringify([connected, vkReady, busy, groups, jobs, mediaUrls.size]);
  if (key === renderedQueue) return;
  renderedQueue = key;
  $('jobs').replaceChildren();
  if (!jobs.length) $('jobs').append(node('p', connected ? 'Очередь сервера пуста.' : 'После подключения здесь появятся реальные записи вашего сервера.', 'empty'));
  for (const j of [...jobs].reverse()) {
    const article = node('article', null, 'job'), g = groups.find(g => g.id === j.groupId);
    const heading = node('div', null, 'job-heading');
    heading.append(node('h3', j.outreach?.name ?? g?.name ?? 'Сообщество ' + j.groupId),
      node('span', j.outreach && j.status==='approved' ? (j.outreach.route==='suggest'?'Ожидает отправки на модерацию':'Ожидает отправки на стену') : j.campaignId && j.status==='approved' ? (Date.parse(j.publishAt)>Date.now()+7*86400000 ? 'Ожидает окна VK' : vkReady ? 'Утверждено · ожидает VPS' : 'Ожидает подключения VK') : labels[j.status] ?? j.status, 'state ' + j.status));
    const timing = j.publishAt
      ? 'По плану: ' + new Date(j.publishAt).toLocaleString('ru-RU', { timeZone: zone }) + ' · Екатеринбург'
      : 'Сразу после утверждения и проверки VPS.';
    article.append(heading, node('p', j.text, 'copy'), node('p', timing, 'hint time'));
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
    const retryImage = j.status === 'blocked' && j.image && !j.result && (j.note === 'VK не подтвердил готовность фотографии. Запись не отправлена.' || ['В новом редакторе уже есть вложения. Проверьте прежний черновик VK.','Предпросмотр VK не подтвердил утверждённый текст.'].includes(j.note) && j.resumeImagePreparation && (j.preparationRetryOrigin === 'image-upload-readiness' || j.previousPreparationNote === 'VK не подтвердил готовность фотографии. Запись не отправлена.'));
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
  saveTabSession(tabStorage,{origin,token,expiresAt}); await initializeConnected({ showConnections: true });
}); });
$('disconnect').addEventListener('click', async () => {
  await work(async () => {
    try {
      await api('/api/logout', {});
      notify('Вы вышли из Content Planner.');
    } catch {
      notify('Вы вышли в этой вкладке. Сервер не подтвердил завершение сеанса.', true);
    } finally {
      clearSession();
    }
  });
  if (!token) $('owner-password').focus();
});
$('start-browser').addEventListener('click', () => work(initializeConnected));
async function screen() { const blob = await api('/api/browser/screenshot', undefined, true); if (screenshotUrl) URL.revokeObjectURL(screenshotUrl); screenshotUrl = URL.createObjectURL(blob); $('auth-screen').src = screenshotUrl; $('auth-screen').hidden = false; $('auth-hint').hidden = false; $('enlarge-auth').hidden = false; $('auth-large').src = screenshotUrl; }
$('show-qr').addEventListener('click', () => work(async () => { await api('/api/browser/qr', {}); await screen(); await refresh(); }));
$('enlarge-auth').addEventListener('click', () => $('auth-dialog').showModal());
$('close-auth').addEventListener('click', () => $('auth-dialog').close());
$('vk-code-form').addEventListener('submit', event => { event.preventDefault(); const challengeId = state?.browser.authChallenge?.id; let code = $('vk-login-code').value; $('vk-login-code').value = ''; work(async () => { try { await api('/api/browser/code', { code, challengeId }); code = ''; await refresh(); if (!state.browser.authenticated) await screen(); else await loadGroups(); notify(state.browser.authenticated ? '' : 'Код передан в VK. Обновите состояние и проверьте результат входа.'); } finally { code = ''; } }); });
async function loadGroups() {
  const result=await api('/api/groups');groups=result.groups;
  $('group').replaceChildren();for(const g of groups){const option=node('option',g.name);option.value=g.id;$('group').append(option);}
}
async function initializeConnected({ showConnections = false } = {}) {
  await refresh();
  if(state.browser.setupBlocked){if(showConnections) selectPanel('connections', true);notify('Настройка браузера на VPS ещё не завершена.');return;}
  if(state.workerBusy||state.browser.busy){notify('Сеанс восстановлен. VPS выполняет утверждённое задание.');return;}
  if(!state.browser.started){notify('Открываем сохранённый профиль VK на VPS.');await api('/api/browser/start',{});}
  for(let n=0;n<12;n++) {
    await refresh();if(state.browser.authenticated)break;
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  if(state.browser.authenticated){await loadGroups();notify('');}
  else {
    if (showConnections && ['plan','campaign'].includes(activePanel)) selectPanel('connections', true);
    await screen();
    notify('VK запросил подтверждение входа. Подтвердите его телефоном.');
  }
}
$('load-groups').addEventListener('click',()=>work(async()=>{await loadGroups();notify(`Сервер подтвердил сообществ: ${groups.length}.`);}));
$('post-form').addEventListener('submit', event => { event.preventDefault(); work(async () => { const value = draftFromForm(), file = $('post-image').files[0]; if (file) { if (!['image/png','image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Выберите PNG или JPEG до 5 МБ.'); const uploaded = await api('/api/media', file, false, file.type); value.mediaId = uploaded.media.id; } await api('/api/jobs', value); await refresh(); clearImage(); selectPanel('queue', true); notify('Предпросмотр сохранён на VPS. Проверьте группу, текст и время; отправка начнётся только после утверждения записи в очереди.'); }); });
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

const navigation = [...document.querySelectorAll('[data-panel]')];
const requestedPanel = new URLSearchParams(location.search).get('section');
const entryPanel = navigation.some(button => button.dataset.panel === requestedPanel) ? requestedPanel : 'campaign';
let activePanel = entryPanel;
const serverCard = $('server-card');

function selectPanel(panel, focus = false) {
  activePanel = panel;
  for (const button of navigation) {
    const selected = button.dataset.panel === panel;
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    $(button.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) $('panel-' + panel).querySelector('h1').focus();
}

function renderWorkspace(connected, ready) {
  $('entry').hidden = connected;
  $('studio').hidden = !connected;
  const slot = connected ? $('server-card-slot') : $('entry');
  if (serverCard.parentElement !== slot) slot.append(serverCard);
  selectPanel(activePanel);
  campaignUi.updateConnection(connected, ready);
  outreachUi.updateConnection(connected, Boolean(connected&&state?.browser.authenticated));
  renderVkIndicator(ready);
  const prepare = $('prepare-editorial-post');
  if (prepare) prepare.disabled = busy || !ready;
  const hint = $('editorial-vk-hint');
  if (hint) hint.hidden = ready;
}

function resetEditorialPlan() {
  planLoad++;
  editorialRows = [];
  selectedRow = 0;
  $('editorial-file').value = '';
  $('sheet-link').value = '';
  $('sheet-download').hidden = true;
  $('sheet-download').removeAttribute('href');
  planFeedback('В первой строке укажите «Тема» или «Текст поста». Можно добавить дату, время, цель, формат и промпт.');
  renderEditorialRows();
}

function planFeedback(message, isError = false) {
  $('plan-feedback').textContent = message;
  $('plan-feedback').classList.toggle('field-error', isError);
}

function renderEditorialRows(focusRow = false) {
  const list = $('editorial-rows');
  const preview = $('editorial-preview');
  list.replaceChildren();
  preview.replaceChildren();
  $('plan-results').hidden = !editorialRows.length;
  const focusPreview = focusRow && window.matchMedia('(max-width: 580px)').matches;
  for (const [index, post] of editorialRows.entries()) {
    const button = node('button', post.topic || 'Строка ' + post.number, 'editorial-row');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(index === selectedRow));
    button.append(node('small', [post.date, post.carousel ? 'Карусель' : (post.format || 'Пост')].filter(Boolean).join(' · ')));
    button.addEventListener('click', () => { selectedRow = index; renderEditorialRows(true); });
    const item = node('li');
    item.append(button);
    list.append(item);
    if (focusRow && !focusPreview && index === selectedRow) button.focus();
  }
  const post = editorialRows[selectedRow];
  if (!post) return;
  const title = node('h2', post.topic || 'Запись без темы');
  title.tabIndex = -1;
  preview.append(node('p', 'СТРОКА ' + post.number, 'step'), title);
  const meta = [post.format || 'Пост', [post.date, post.time].filter(Boolean).join(' '), post.goal].filter(Boolean);
  preview.append(node('p', meta.join(' · '), 'hint'));
  preview.append(node('h3', 'Текст поста'), node('p', post.text || 'Текст ещё не добавлен.', 'editorial-copy'));
  preview.append(node('h3', 'Промпт изображения'), node('p', post.prompt || 'Промпт ещё не добавлен.', 'editorial-copy'));
  if (post.carousel) {
    preview.append(node('p', 'Запись с карточками доступна для просмотра. Отправку карусели подключим после проверки в VK.', 'hint'));
  } else if (post.text && post.text.length <= 2000) {
    const prepare = node('button', 'Открыть в редакторе');
    prepare.id = 'prepare-editorial-post';
    prepare.type = 'button';
    prepare.disabled = busy || !state?.browser.authenticated || !groups.length;
    prepare.addEventListener('click', () => openEditorialPost(post));
    const hint = node('p', 'Для подготовки публикации подключите сообщество VK.', 'hint');
    hint.id = 'editorial-vk-hint';
    hint.hidden = Boolean(state?.browser.authenticated && groups.length);
    preview.append(prepare, hint);
  } else if (post.text) {
    preview.append(node('p', 'Для текущего редактора сократите текст до 2 000 символов.', 'hint'));
  }
  if (focusPreview) title.focus();
}

function openEditorialPost(post) {
  if (busy || !state?.browser.authenticated || !groups.length) return;
  const currentText = $('post-text').value;
  if (((currentText && currentText !== post.text) || $('post-image').files.length)
    && !window.confirm('Заменить текст и убрать выбранное изображение в редакторе?')) return;
  clearImage();
  $('post-text').value = post.text;
  $('post-mode').value = 'scheduled';
  $('post-time').value = localPublicationTime(post.date, post.time);
  updateMode();
  selectPanel('composer', true);
}

for (const button of navigation) button.addEventListener('click', () => selectPanel(button.dataset.panel, true));
$('sheet-link').addEventListener('input', () => {
  $('sheet-download').hidden = true;
  $('sheet-download').removeAttribute('href');
});
$('sheet-link-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    $('sheet-download').href = googleSheetCsvUrl($('sheet-link').value);
    $('sheet-download').hidden = false;
    $('sheet-download').focus();
    planFeedback('Скачайте нужный лист в Google и выберите полученный CSV.');
  } catch (error) {
    planFeedback(error.message, true);
  }
});
$('editorial-file').addEventListener('change', async () => {
  const file = $('editorial-file').files[0], version = ++planLoad;
  if (!file) return;
  try {
    if (file.size > PLAN_MAX_BYTES) throw new Error('Выберите CSV размером до 1 МБ.');
    const input = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (version !== planLoad) return;
    editorialRows = parseEditorialPlan(input);
    selectedRow = 0;
    renderEditorialRows();
    planFeedback('Прочитано записей: ' + editorialRows.length + '. Выберите запись для просмотра.');
  } catch (error) {
    if (version !== planLoad) return;
    $('editorial-file').value = '';
    planFeedback((error instanceof TypeError ? 'Не удалось прочитать файл. Скачайте CSV в кодировке UTF‑8.' : error.message)
      + (editorialRows.length ? ' Ниже показан предыдущий план.' : ''), true);
  }
});

const vkIndicator=$('vk-indicator'),vkStatus=$('vk-indicator-button'),vkFeedback=$('vk-feedback');
let vkWasReady=false,vkFeedbackTimer;
function closeVkTooltip(dismiss=false) {
  delete vkIndicator.dataset.open;
  vkStatus.setAttribute('aria-expanded','false');
  if(dismiss)vkIndicator.dataset.dismissed='';
}
vkStatus.addEventListener('click',()=>{
  const opened=vkIndicator.hasAttribute('data-open');
  if(opened)closeVkTooltip(true);
  else {
    delete vkIndicator.dataset.dismissed;
    vkIndicator.dataset.open='';
    vkStatus.setAttribute('aria-expanded','true');
    vkFeedback.hidden=true;
  }
});
vkIndicator.addEventListener('pointerenter',()=>delete vkIndicator.dataset.dismissed);
vkStatus.addEventListener('focus',()=>delete vkIndicator.dataset.dismissed);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!vkIndicator.hidden) {closeVkTooltip(true);vkFeedback.hidden=true;}
});
document.addEventListener('pointerdown',event=>{if(!vkIndicator.contains(event.target))closeVkTooltip();});
function renderVkIndicator(ready) {
  vkIndicator.hidden=!ready;
  if(ready&&!vkWasReady) {
    vkFeedback.hidden=false;
    clearTimeout(vkFeedbackTimer);
    vkFeedbackTimer=setTimeout(()=>{vkFeedback.hidden=true;},3200);
  } else if(!ready) {
    clearTimeout(vkFeedbackTimer);
    vkFeedback.hidden=true;
    closeVkTooltip();
  }
  vkWasReady=ready;
}

const outreachUi=mountOutreach({api,selectPanel,refreshQueue:refresh});
const campaignUi=mountCampaign({api,selectPanel,refreshQueue:refresh});
try { $('server-url').value = localStorage.getItem('content-planner:vps-origin') || 'https://31.76.80.185/content-planner-api'; } catch {}
function initialPublicationTime() {
  const defaultTime = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + 600000)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${defaultTime.year}-${defaultTime.month}-${defaultTime.day}T${defaultTime.hour}:${defaultTime.minute}`;
}
$('post-time').value = initialPublicationTime();
setInterval(async () => {
  if (!token || busy || document.hidden) return;
  if (expiresAt <= Date.now()) {
    clearSession();
    notify('Сеанс Content Planner истёк. Войдите снова отдельным паролем сервера.');
    return;
  }
  const session = token;
  try {
    await refresh();
    if (token === session && !busy && !state.workerBusy && !state.browser.busy
      && (!state.browser.started || (state.browser.authenticated && !groups.length))) await work(initializeConnected);
  } catch (error) {
    if (token === session) notify(error.message, true);
  }
}, 5000);
window.addEventListener('pagehide', () => { if (token) saveTabSession(tabStorage, {origin, token, expiresAt}); });
window.addEventListener('pageshow', event => {
  if (event.persisted && token && restoreTabSession(tabStorage, origin)?.token !== token) location.reload();
});
updateMode(); render();
try {const target=endpoint($('server-url').value);const saved=restoreTabSession(tabStorage,target);if(saved){origin=saved.origin;token=saved.token;expiresAt=saved.expiresAt;await work(() => initializeConnected({ showConnections: true }));}}catch{clearTabSession(tabStorage);}

function clearImage() { if (imagePreview) URL.revokeObjectURL(imagePreview); imagePreview = ''; $('post-image').value = ''; $('image-preview').hidden = true; $('image-preview').removeAttribute('src'); $('clear-image').hidden = true; }
$('post-image').addEventListener('change', () => { if (imagePreview) URL.revokeObjectURL(imagePreview); imagePreview = ''; const file = $('post-image').files[0]; if (!file) { clearImage(); return; } if (!['image/png','image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) { clearImage(); notify('Выберите PNG или JPEG до 5 МБ.', true); return; } imagePreview = URL.createObjectURL(file); $('image-preview').src = imagePreview; $('image-preview').hidden = false; $('clear-image').hidden = false; });
$('clear-image').addEventListener('click', clearImage);
