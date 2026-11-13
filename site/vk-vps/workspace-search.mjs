const history = new Set(['published', 'submitted', 'unknown', 'blocked', 'cancelled']);
const areaLabels = { plan: 'План', draft: 'Черновик', queue: 'Очередь', history: 'История' };
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
const day = value => {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms + 5 * 3600000).toISOString().slice(0, 10) : '';
};

function records({ campaign, jobs, groups }) {
  const names = new Map(groups.map(group => [group.id, group.name]));
  const groupName = id => names.get(id) ?? ('Сообщество ' + id);
  const planned = (campaign?.posts ?? []).map(post => ({
    id: post.id, campaignId: campaign.id, area: 'plan', status: 'plan',
    groupId: campaign.groupId, group: groupName(campaign.groupId),
    date: post.date, title: post.topic, text: post.copy
  }));
  return planned.concat(jobs.map(job => ({
    id: job.id, area: job.status === 'draft' ? 'draft' : history.has(job.status) ? 'history' : 'queue',
    status: job.status, groupId: job.groupId, group: job.managedGroup?.name ?? job.outreach?.name ?? groupName(job.groupId),
    date: day(job.publishAt ?? job.createdAt), title: '', text: job.text
  })));
}

export function searchWorkspace(items, filters) {
  const terms = normalize(filters.query).split(/\s+/).filter(Boolean);
  if (filters.from && filters.to && filters.from > filters.to) return [];
  return items.filter(item => {
    if (filters.area && filters.area !== item.area) return false;
    if (filters.status && filters.status !== item.status) return false;
    if (filters.group && filters.group !== String(item.groupId)) return false;
    if ((filters.from || filters.to) && (!item.date || (filters.from && item.date < filters.from) || (filters.to && item.date > filters.to))) return false;
    const haystack = normalize([item.title, item.text].join(' '));
    return terms.every(term => haystack.includes(term));
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export function mountWorkspaceSearch({ snapshot, labels, open }) {
  const $ = id => document.getElementById(id);
  const form = $('search-form');
  const results = $('search-results');
  const fields = ['query', 'group', 'area', 'status', 'from', 'to'];
  let rendered = '';
  function feedback(message, summary = message) {
    $('search-feedback').textContent = message;
    $('search-summary').textContent = summary;
  }
  function update() {
    const data = snapshot();
    const items = records(data);
    const group = $('search-group');
    const selected = group.value;
    const groups = new Map(data.groups.map(g => [g.id, g.name]));
    for (const item of items) groups.set(item.groupId, item.group);
    const options = JSON.stringify([...groups]);
    if (group.dataset.options !== options) {
      group.replaceChildren(new Option('Все сообщества', ''),
        ...[...groups].sort((a, b) => a[1].localeCompare(b[1], 'ru')).map(([id, name]) => new Option(name, id)));
      if (groups.has(Number(selected))) group.value = selected;
      group.dataset.options = options;
    }
    const filters = Object.fromEntries(fields.map(field => [field, $('search-' + field).value]));
    const invalidRange = filters.from && filters.to && filters.from > filters.to;
    const found = invalidRange ? [] : searchWorkspace(items, filters);
    const key = JSON.stringify([found, filters, data.ready]);
    if (rendered === key) return;
    rendered = key;
    const status = data.ready ? '' : ' План пока недоступен.';
    feedback(invalidRange ? 'Дата начала должна быть раньше даты окончания.' :
      (found.length ? 'Найдено: ' + found.length + '.' : 'По заданным условиям ничего не найдено.') + status);
    results.replaceChildren(...found.map(item => {
      const row = document.createElement('article'); row.className = 'job';
      const title = document.createElement('h3'); title.textContent = item.title || item.group;
      const meta = document.createElement('p'); meta.className = 'hint';
      meta.textContent = [areaLabels[item.area], item.title ? item.group : '', item.date.split('-').reverse().join('.'), labels[item.status]].filter(Boolean).join(' · ');
      const excerpt = document.createElement('p'); excerpt.className = 'copy';
      excerpt.textContent = item.text.length > 180 ? item.text.slice(0, 180) + '…' : item.text;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Открыть запись';
      button.addEventListener('click', () => {
        if (!open(item)) feedback('Запись сейчас недоступна. Обновите раздел и повторите поиск.');
      });
      row.append(title, meta, excerpt, button);
      return row;
    }));
  }
  $('search-status').append(new Option('В плане', 'plan'), ...Object.entries(labels).map(([value, label]) => new Option(label, value)));
  form.addEventListener('submit', event => { event.preventDefault(); rendered = ''; update(); });
  form.addEventListener('change', update);
  function clear() {
    rendered = '';
    form.reset();
    $('search-group').replaceChildren(new Option('Все сообщества', ''));
    delete $('search-group').dataset.options;
    results.replaceChildren();
    feedback('', 'Введите фразу или выберите фильтр.');
  }
  $('search-reset').addEventListener('click', () => { clear(); update(); $('search-query').focus(); });
  return { update, clear };
}
