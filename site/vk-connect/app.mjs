// Public prototype: no OAuth, network calls, account data, or persistent VK session.
const $ = id => document.getElementById(id);
const types = { group: 'Группа', page: 'Страница', event: 'Событие' };
const groups = [
  { id: 'demo-1', name: 'Студия керамики «Форма»', type: 'group', role: 'администратор', managed: true, members: 128 },
  { id: 'demo-2', name: 'Идеи на потом', type: 'page', role: 'редактор', managed: true, members: 360 },
  { id: 'demo-3', name: 'Открытый мастер-класс', type: 'event', role: 'администратор', managed: true, members: 24 },
  { id: 'demo-4', name: 'Городские истории', type: 'group', role: 'участник', managed: false, members: 850 },
  { id: 'demo-5', name: 'Маленькая мастерская', type: 'page', role: 'модератор', managed: true, members: 91 },
  { id: 'demo-6', name: 'Встреча авторов', type: 'event', role: 'участник', managed: false, members: 42 }
];
let opened = false, selected = null;
function node(tag, text, cls) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; }
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function render() {
  $('login').hidden = opened; $('logout').hidden = !opened; $('account').hidden = !opened;
  $('account').textContent = 'Демонстрационный каталог · учётная запись не подключена';
  $('registration').hidden = opened; $('catalog').hidden = !opened;
  $('more').hidden = true; $('selection').hidden = !selected;
  const query = $('search').value.trim().toLocaleLowerCase('ru');
  const filtered = groups.filter(g => (!query || g.name.toLocaleLowerCase('ru').includes(query)) &&
    ($('type').value === 'all' || g.type === $('type').value) && (!$('managed').checked || g.managed));
  $('count').textContent = `Показано ${filtered.length} из ${groups.length} · все данные вымышлены`;
  $('groups').replaceChildren();
  if (!filtered.length) $('groups').append(node('p', 'По этим условиям сообществ нет. Попробуйте другой поиск или фильтр.', 'empty'));
  for (const g of filtered) {
    const row = node('article', null, 'group'), info = node('div'), button = node('button', selected?.id === g.id ? 'Выбрано' : 'Выбрать', 'secondary');
    row.append(node('div', g.name.slice(0, 1), 'avatar')); info.append(node('h3', g.name), node('p', `${types[g.type]} · ${g.role}`)); row.append(info);
    button.type = 'button'; button.addEventListener('click', () => { selected = g; message('Демонстрационное сообщество выбрано. В VK ничего не изменилось.'); render(); });
    row.append(button); $('groups').append(row);
  }
  $('selection').replaceChildren();
  if (selected) $('selection').append(node('h3', selected.name), node('p', `${types[selected.type]} · ${selected.role} · участников: ${selected.members}`), node('p', 'Это вымышленное сообщество. В рабочем модуле здесь доступны сведения и переход на настоящую страницу VK.'));
}
$('login').disabled = false;
$('login').addEventListener('click', () => { opened = true; message('Макет списка открыт. Попробуйте поиск, типы и фильтр управления.'); render(); });
$('logout').addEventListener('click', () => { opened = false; selected = null; message('Демонстрационный список закрыт.'); render(); });
$('refresh').addEventListener('click', () => { message('Демонстрационный список обновлён. Запросов к VK не было.'); });
$('denied').addEventListener('click', () => { opened = false; selected = null; message('Пример ошибки: VK не предоставил доступ к сообществам. В рабочем модуле нужно проверить разрешение groups и войти заново.', true); render(); });
for (const id of ['search', 'type', 'managed']) $(id).addEventListener('input', render);
render(); message('Макет готов. Нажмите «Открыть демосписок», чтобы проверить выбор сообществ.');
