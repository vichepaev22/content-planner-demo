export const PLAN_MAX_BYTES = 1024 * 1024;
const aliases = {
  topic: ['тема', 'тематика', 'название', 'тема поста', 'topic', 'title'],
  text: ['текст', 'текст поста', 'текст публикации', 'сам текст поста', 'готовый текст', 'пост', 'text', 'caption'],
  date: ['дата', 'дата публикации', 'дата и время', 'дата и время публикации', 'date', 'publishat'],
  time: ['время', 'время публикации', 'time'],
  goal: ['цель', 'цель поста', 'цель публикации', 'goal'],
  format: ['формат', 'формат поста', 'формат публикации', 'тип', 'тип поста', 'format'],
  prompt: ['промпт', 'промпт для изображения', 'промпт для картинки', 'промпт для генерации изображения', 'промпт для генерации картинки', 'промпт изображения', 'промпт для генерации', 'промпт для gpt image', 'image prompt', 'prompt'],
};
const headerKey = value => value.toLowerCase().trim().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');

function delimiterOf(input) {
  const counts = new Map([ [',', 0], [';', 0], ['\t', 0] ]);
  let quoted = false;
  for (const ch of input) {
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === '\r' || ch === '\n') break;
    if (counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function csvRows(input) {
  const source = input.replace(/^\uFEFF/, '').trimEnd();
  if (!source) throw new Error('В файле нет данных.');
  const separator = delimiterOf(source);
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const addField = () => { row.push(field); field = ''; closed = false; };
  const addRow = () => { addField(); rows.push(row); row = []; };
  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    if (quoted) {
      if (ch === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else field += ch;
    } else if (ch === separator) {
      addField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && source[index + 1] === '\n') index++;
      addRow();
    } else if (ch === '"' && !field && !closed) {
      quoted = true;
    } else if (closed || ch === '"') {
      throw new Error('В CSV повреждены кавычки. Скачайте лист заново из Google Таблиц.');
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error('В CSV есть незакрытые кавычки.');
  addRow();
  return rows;
}

export function parseEditorialPlan(input) {
  const [head, ...rows] = csvRows(input);
  const headers = head.map(headerKey);
  const columns = Object.fromEntries(Object.entries(aliases).map(([name, terms]) => [name, headers.findIndex(header => terms.includes(header))]));
  if (columns.text < 0 && columns.topic < 0) throw new Error('В первой строке нужен столбец «Тема» или «Текст поста».');
  const posts = rows.map((row, index) => {
    const post = Object.fromEntries(Object.entries(columns).map(([name, column]) => [name, row[column]?.trim() ?? '']));
    return { ...post, number: index + 2, carousel: /карусел|карточк|carousel/i.test(post.format) };
  }).filter(post => post.text || post.topic);
  if (!posts.length) throw new Error('В плане нет строк с темой или текстом поста.');
  if (posts.length > 100) throw new Error('Выберите лист, в котором не больше 100 публикаций.');
  return posts;
}

export function googleSheetCsvUrl(value) {
  let source;
  try { source = new URL(value); }
  catch { throw new Error('Вставьте ссылку из адресной строки Google Таблиц.'); }
  const match = source.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/(?:edit|view|copy|export))?\/?$/);
  if (source.origin !== 'https://docs.google.com' || source.username || source.password || !match) throw new Error('Нужна ссылка на Google Таблицу.');
  const gid = new URLSearchParams(source.hash.slice(1)).get('gid') ?? source.searchParams.get('gid');
  if (gid !== null && !/^\d{1,12}$/.test(gid)) throw new Error('В ссылке указан неверный номер листа Google Таблиц.');
  const download = new URL('https://docs.google.com/spreadsheets/d/' + match[1] + '/export?format=csv');
  if (gid !== null) download.searchParams.set('gid', gid);
  return download.href;
}

export function localPublicationTime(date, time) {
  const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2})(?::00)?)?$/);
  const ru = date.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}:\d{2})(?::00)?)?$/);
  if (!iso && !ru) return '';
  const [year, month, day, embedded] = iso ? iso.slice(1) : [ru[3], ru[2], ru[1], ru[4]];
  const hours = (time || embedded || '').match(/^(\d{1,2}):(\d{2})(?::00)?$/);
  if (!hours || Number(hours[1]) > 23 || Number(hours[2]) > 59) return '';
  const pad = value => value.padStart(2, '0');
  const calendarDate = [year, pad(month), pad(day)].join('-');
  const parsed = new Date(calendarDate + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== calendarDate) return '';
  return calendarDate + 'T' + pad(hours[1]) + ':' + hours[2];
}
