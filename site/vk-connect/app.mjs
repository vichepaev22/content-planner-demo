import { PublishError } from './vk-publisher.mjs';
import { createBrowserSession, LoginError, REDIRECT_URL } from './session.mjs';
import { createProofStore, buildRedirectUrl, parseRedirectPayload } from './redirect.mjs';
const $ = id => document.getElementById(id);
const types = { group: 'Группа', page: 'Страница', event: 'Событие' };
let sdk, controller, widget, state, preparing = false, sdkPromise, pendingScope = '';
let callbackPayload = null, callbackError = null;
try { callbackPayload = parseRedirectPayload(location.href); } catch (error) { callbackError = error; }
if (location.search || location.hash) history.replaceState(null, '', location.pathname);
function node(tag, text, cls) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; }
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function closeWidget() { widget?.close(); widget = null; $('vk-widget').replaceChildren(); }
function render(next) {
  state = next;
  $('account').hidden = !state.authenticated;
  $('account').textContent = state.authenticated ? `Вход подтверждён · VK ID ${state.userId}. Список сообществ: ${state.catalogReadable ? 'чтение проверено' : state.hasGroups ? 'доступ выдан, чтение ещё не проверено' : 'проверка нужна'}. Публикация: ${state.hasWall ? 'wall получен' : 'wall не предоставлен'}.` : '';
  $('logout').hidden = !state.authenticated;
  $('connect-groups').hidden = !state.authenticated || state.hasGroups || state.catalogReadable;
  $('connect-publish').hidden = !state.authenticated || state.hasWall;
  $('prepare').hidden = state.authenticated; $('prepare').disabled = preparing || state.loading;
  $('redirect-login').hidden = state.authenticated; $('redirect-login').disabled = preparing || state.loading;
  $('redirect-login').textContent = pendingScope ? 'Подключить сообщества VK' : 'Войти через VK ID';
  $('alternate-login').hidden = state.authenticated;
  $('catalog').hidden = !state.authenticated; $('setup').hidden = state.authenticated;
  for (const id of ['refresh', 'more', 'connect-groups', 'connect-publish']) $(id).disabled = preparing || state.loading;
  $('groups').replaceChildren(); $('selection').replaceChildren(); $('selection').hidden = !state.selected;
  const query = $('search').value.trim().toLocaleLowerCase('ru');
  const filtered = state.groups.filter(g => (!query || g.name.toLocaleLowerCase('ru').includes(query)) &&
    ($('type').value === 'all' || g.type === $('type').value) && (!$('managed').checked || g.managed));
  $('count').textContent = state.total === null ? 'Настоящие данные VK ещё не загружены.' : `Показано ${filtered.length} · загружено ${state.groups.length} из ${state.total}${state.complete ? ' · список полный' : ' · загрузка не завершена'}`;
  for (const g of filtered) {
    const row = node('article', null, 'group'), info = node('div'), choose = node('button', state.selected?.id === g.id ? 'Выбрано' : 'Выбрать', 'secondary');
    const role = g.managed ? ({ 1: 'модератор', 2: 'редактор', 3: 'администратор' }[g.adminLevel] ?? 'управление') : 'участник';
    row.append(node('div', g.name.slice(0, 1), 'avatar')); info.append(node('h3', g.name), node('p', `${types[g.type]} · ${role}`)); row.append(info);
    choose.type = 'button'; choose.addEventListener('click', () => action(() => controller.select(g.id))); row.append(choose); $('groups').append(row);
  }
  if (!filtered.length && state.total !== null) $('groups').append(node('p', 'Сообществ по этим условиям нет.', 'empty'));
  $('more').hidden = state.complete; $('more').textContent = state.total === null ? 'Проверить мой список' : 'Загрузить ещё';
  if (state.selected) {
    const g = state.selected, link = node('a', 'Открыть в VK ↗'); link.href = g.url; link.target = '_blank'; link.rel = 'noreferrer';
    $('selection').append(node('h3', g.name), node('p', `${types[g.type]}${g.members === null ? '' : ` · участников: ${g.members}`}`), link);
  }
  renderPublication();
  if (state.note) message(state.note);
}
function renderPublication() {
  const pub = state.publication, g = state.selected;
  $('publisher').hidden = !g;
  $('post-target').textContent = g ? `Сообщество: ${g.name}` : '';
  const canPost = state.hasWall && g?.managed && [2, 3].includes(g.adminLevel);
  $('post-access').textContent = !state.hasWall ? 'VK ещё не предоставил wall. Подключите разрешение публикации.' : !canPost ? 'Нужна роль редактора или администратора.' : 'Отправка только после предпросмотра и отдельного нажатия.';
  $('post-preview').disabled = !canPost || state.loading || pub.busy;
  $('post-send').disabled = !canPost || pub.busy;
  $('post-review').hidden = !pub.review;
  $('post-review-body').replaceChildren();
  if (pub.review) {
    const r = pub.review;
    $('post-review-body').append(node('h3', r.groupName), node('p', r.text), node('p', r.publishDate ? `Публикация: ${new Date(r.publishDate * 1000).toLocaleString('ru')}` : 'Публикация сразу после нажатия кнопки.'));
    $('post-send').textContent = r.publishDate ? 'Передать запись в отложенные VK' : 'Опубликовать эту запись сейчас';
  }
  $('post-result').hidden = !pub.result;
  $('post-result').replaceChildren();
  if (pub.result) {
    const r = pub.result, labels = { sending: 'Отправляем…', published: 'VK подтвердил публикацию', scheduled: 'VK принял отложенную запись', failed: 'VK отклонил отправку', unknown: 'Результат неизвестен. Проверьте стену и отложенные записи VK перед повтором.' };
    $('post-result').append(node('h3', labels[r.status]), node('p', r.groupName));
    if (r.url) { const link = node('a', 'Открыть запись в VK ↗'); link.href = r.url; link.target = '_blank'; link.rel = 'noreferrer'; $('post-result').append(link); }
  }
}
function updatePostMode() {
  const scheduled = $('post-mode').value === 'scheduled'; $('post-time-label').hidden = !scheduled; $('post-time').required = scheduled;
  if (scheduled && !$('post-time').value) { const d = new Date(Date.now() + 600000), pad = n => String(n).padStart(2, '0'); $('post-time').value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  $('post-timezone').textContent = `Часовой пояс браузера: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
}

async function loadSdk() {
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL('vendor/vkid-sdk-2.6.10.js', import.meta.url).href;
    script.onload = () => window.VKIDSDK ? resolve(window.VKIDSDK) : reject(new Error()); script.onerror = () => reject(new Error()); document.head.append(script);
  });
  return sdkPromise;
}
async function prepare(scope = '') {
  if (preparing) return;
  if (location.origin + location.pathname !== REDIRECT_URL) { message('Реальный вход включён только на зарегистрированном HTTPS-адресе GitHub Pages. Откройте публичную страницу.', true); return; }
  pendingScope = scope; preparing = true; $('prepare').disabled = true; $('redirect-login').disabled = true; message('Подготавливаем официальный виджет VK…');
  try {
    sdk = await loadSdk(); closeWidget();
    controller ??= createBrowserSession({ sdk, onChange: render });
    const config = controller.prepare(scope);
    sdk.Config.init({ ...config, mode: sdk.ConfigAuthMode.InNewWindow, responseMode: sdk.ConfigResponseMode.Callback, source: sdk.ConfigSource.LOWCODE });
    widget = new sdk.OAuthList();
    widget.render({ container: $('vk-widget'), oauthList: ['vkid'] })
      .on(sdk.WidgetEvents.ERROR, () => message('VK не открыл вход. Разрешите всплывающее окно для этой страницы и проверьте настройки своего приложения VK.', true))
      .on(sdk.OAuthListInternalEvents.LOGIN_SUCCESS, payload => action(async () => { await controller.authorize(payload); closeWidget(); }));
    message(scope ? 'Кнопка VK ниже запросит доступ к сообществам. Подтвердите разрешения на странице VK.' : 'Нажмите официальную кнопку VK ниже. Разрешения и вход подтверждаются на стороне VK.');
  } catch { message('Не удалось подготовить SDK VK. Обновите страницу и проверьте настройки приложения.', true); }
  finally { preparing = false; if (state) render({ ...state, note: '' }); else { $('prepare').disabled = false; $('redirect-login').disabled = false; } }
}
async function startRedirect(scope = pendingScope) {
  if (preparing) return;
  if (location.origin + location.pathname !== REDIRECT_URL) { message('Откройте зарегистрированную HTTPS-страницу входа.', true); return; }
  preparing = true;
  for (const id of ['redirect-login', 'prepare', 'connect-groups']) $(id).disabled = true;
  message('Открываем защищённую страницу VK…');
  try {
    closeWidget();
    // Building a PKCE redirect needs only Web Crypto. The SDK is loaded after VK returns.
    const config = createBrowserSession({ sdk: {} }).prepare(scope);
    const url = await buildRedirectUrl(config); createProofStore().save(config);
    message('Открываем официальную страницу VK…'); location.assign(url);
  } catch (error) { message((error instanceof LoginError || error instanceof PublishError) ? error.message : 'Не удалось подготовить вход в этой вкладке.', true); }
  finally { preparing = false; if (state) render({ ...state, note: '' }); else { $('redirect-login').disabled = false; $('prepare').disabled = false; } }
}
async function finishRedirect(payload) {
  preparing = true; $('prepare').disabled = true; $('redirect-login').disabled = true;
  try {
    const proof = createProofStore().take();
    if (payload.state !== proof.state) throw new LoginError('STATE', 'VK вернул ответ на другую попытку входа. Начните заново.');
    sdk = await loadSdk(); controller = createBrowserSession({ sdk, onChange: render });
    const config = controller.restore(proof);
    sdk.Config.init({ ...config, responseMode: sdk.ConfigResponseMode.Callback, source: sdk.ConfigSource.LOWCODE });
    await controller.authorize(payload);
  } catch (error) { message((error instanceof LoginError || error instanceof PublishError) ? error.message : 'Не удалось завершить вход. Подготовьте новую попытку.', true); }
  finally { preparing = false; if (state) render({ ...state, note: '' }); else { $('prepare').disabled = false; $('redirect-login').disabled = false; } }
}
async function action(work) {
  try { await work(); }
  catch (error) { message((error instanceof LoginError || error instanceof PublishError) ? error.message : 'Действие не выполнено. Начните вход заново.', true); }
}
$('prepare').addEventListener('click', () => prepare());
$('redirect-login').addEventListener('click', () => startRedirect('groups'));
$('connect-groups').addEventListener('click', () => startRedirect('groups'));
$('connect-publish').addEventListener('click', () => startRedirect('groups wall'));
$('logout').addEventListener('click', () => { closeWidget(); createProofStore().clear(); controller.logout(); });
$('refresh').addEventListener('click', () => action(() => state.hasGroups ? controller.loadGroups(true) : controller.probeGroups(true)));
$('more').addEventListener('click', () => action(() => state.hasGroups ? controller.loadGroups() : controller.probeGroups()));
for (const id of ['search', 'type', 'managed']) $(id).addEventListener('input', () => { if (state) render({ ...state, note: '' }); });
setInterval(() => controller?.expire(), 15000);
window.addEventListener('pagehide', () => { closeWidget(); controller?.clear(); });
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
if (callbackError) { try { createProofStore().clear(); } catch {} message(callbackError instanceof LoginError ? callbackError.message : 'Не удалось проверить ответ VK. Начните заново.', true); }
else if (callbackPayload) await finishRedirect(callbackPayload);

$('post-form').addEventListener('submit', event => { event.preventDefault(); action(() => controller.preparePost({ text: $('post-text').value, mode: $('post-mode').value, publishAtMs: $('post-mode').value === 'scheduled' ? new Date($('post-time').value).getTime() : null })); });
$('post-send').addEventListener('click', () => action(async () => { const id = state.publication.review?.id; if (!id) throw new PublishError('REVIEW', 'Сначала проверьте предпросмотр.'); const r = await controller.submitPost(id); message(r.status === 'scheduled' ? 'VK принял запись в отложенные. Это ещё не подтверждение её выхода по времени.' : 'VK подтвердил публикацию.'); }));
for (const id of ['post-text', 'post-mode', 'post-time']) $(id).addEventListener('input', () => { updatePostMode(); if (controller) controller.discardPost(); });
updatePostMode();
