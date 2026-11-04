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
  $('account').textContent = state.authenticated ? `Вход подтверждён · VK ID ${state.userId}. Доступ groups: ${state.hasGroups ? 'получен, чтение ещё нужно проверить' : 'не подтверждён'}.` : '';
  $('logout').hidden = !state.authenticated;
  $('connect-groups').hidden = !state.authenticated || state.hasGroups;
  $('prepare').hidden = state.authenticated; $('prepare').disabled = preparing || state.loading;
  $('redirect-login').hidden = state.authenticated; $('redirect-login').disabled = preparing || state.loading;
  $('redirect-login').textContent = pendingScope ? 'Запросить groups в этой вкладке' : 'Войти в этой вкладке';
  $('catalog').hidden = !state.authenticated || !state.hasGroups; $('setup').hidden = state.authenticated && state.hasGroups;
  for (const id of ['refresh', 'more', 'connect-groups']) $(id).disabled = preparing || state.loading;
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
  $('more').hidden = state.complete; $('more').textContent = state.total === null ? 'Загрузить список' : 'Загрузить ещё';
  if (state.selected) {
    const g = state.selected, link = node('a', 'Открыть в VK ↗'); link.href = g.url; link.target = '_blank'; link.rel = 'noreferrer';
    $('selection').append(node('h3', g.name), node('p', `${types[g.type]}${g.members === null ? '' : ` · участников: ${g.members}`}`), link);
  }
  if (state.note) message(state.note);
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
  finally { preparing = false; if (state) render({ ...state, note: '' }); else $('prepare').disabled = false; }
}
async function startRedirect() {
  if (preparing) return;
  if (location.origin + location.pathname !== REDIRECT_URL) { message('Откройте зарегистрированную HTTPS-страницу входа.', true); return; }
  preparing = true; $('redirect-login').disabled = true;
  try {
    sdk = await loadSdk(); closeWidget(); controller ??= createBrowserSession({ sdk, onChange: render });
    const config = controller.prepare(pendingScope);
    const url = await buildRedirectUrl(config); createProofStore().save(config);
    message('Открываем официальную страницу VK…'); location.assign(url);
  } catch (error) { message(error instanceof LoginError ? error.message : 'Не удалось подготовить вход в этой вкладке.', true); }
  finally { preparing = false; if (state) render({ ...state, note: '' }); else $('redirect-login').disabled = false; }
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
  } catch (error) { message(error instanceof LoginError ? error.message : 'Не удалось завершить вход. Подготовьте новую попытку.', true); }
  finally { preparing = false; if (state) render({ ...state, note: '' }); else { $('prepare').disabled = false; $('redirect-login').disabled = false; } }
}
async function action(work) {
  try { await work(); }
  catch (error) { message(error instanceof LoginError ? error.message : 'Действие не выполнено. Начните вход заново.', true); }
}
$('prepare').addEventListener('click', () => prepare());
$('redirect-login').addEventListener('click', startRedirect);
$('connect-groups').addEventListener('click', () => prepare('groups'));
$('logout').addEventListener('click', () => { closeWidget(); createProofStore().clear(); controller.logout(); });
$('refresh').addEventListener('click', () => action(() => controller.loadGroups(true)));
$('more').addEventListener('click', () => action(() => controller.loadGroups()));
for (const id of ['search', 'type', 'managed']) $(id).addEventListener('input', () => { if (state) render({ ...state, note: '' }); });
setInterval(() => controller?.expire(), 15000);
window.addEventListener('pagehide', () => { closeWidget(); controller?.clear(); });
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
if (callbackError) { try { createProofStore().clear(); } catch {} message(callbackError instanceof LoginError ? callbackError.message : 'Не удалось проверить ответ VK. Начните заново.', true); }
else if (callbackPayload) await finishRedirect(callbackPayload);
