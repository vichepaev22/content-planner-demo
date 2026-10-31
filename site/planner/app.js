'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const KEY = 'ritm-prototype-v1';
const defaults = { business: '', audience: '', offer: '', links: '', goal: 'leads', horizon: '1', start: '2026-11-01', frequency: '3', channel: 'Telegram' };
const state = { version: 1, step: 0, reached: 1, brief: { ...defaults }, mode: 'funnel', competitors: '', unavailable: false, plan: null, filter: 'all' };
const stages = { awareness: 'Знакомство', trust: 'Доверие', offer: 'Предложение' };
const goals = { leads: 'Получать обращения', launch: 'Запустить новую услугу', awareness: 'Повысить узнаваемость' };
const bases = { funnel: 'Пример воронки', manual: 'Ручной список · демо', auto: 'Автопоиск · демо' };
const stepNames = ['Новый проект', 'О бизнесе', 'Что работает', 'Основа плана', 'Контент-план'];
let editingId = null;
let toastTimer;
let storageAvailable = true;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    $('#save-state').textContent = 'Черновик сохранён в этом браузере';
    storageAvailable = true;
  } catch {
    $('#save-state').textContent = 'Хранение недоступно · правки останутся до перезагрузки';
    if (storageAvailable) notify('Браузер не разрешил сохранить черновик. Вы можете скачать план в CSV.');
    storageAvailable = false;
  }
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved || saved.version !== 1 || !saved.brief) return;
    for (const key of Object.keys(defaults)) {
      if (typeof saved.brief[key] === 'string') state.brief[key] = saved.brief[key].slice(0, 3000);
    }
    if (!['leads', 'launch', 'awareness'].includes(state.brief.goal)) state.brief.goal = defaults.goal;
    if (!['1', '6', '12'].includes(state.brief.horizon)) state.brief.horizon = '1';
    if (!['2', '3', '5'].includes(state.brief.frequency)) state.brief.frequency = '3';
    if (!['Telegram', 'ВКонтакте', 'Instagram'].includes(state.brief.channel)) state.brief.channel = 'Telegram';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(state.brief.start) || !Number.isFinite(parseDate(state.brief.start).getTime())) state.brief.start = defaults.start;
    if (['funnel', 'manual', 'auto'].includes(saved.mode)) state.mode = saved.mode;
    if (typeof saved.competitors === 'string') state.competitors = saved.competitors.slice(0, 3000);
    state.unavailable = saved.unavailable === true;
    const validPost = (post) => post && typeof post.id === 'number' && typeof post.title === 'string' && typeof post.cta === 'string' && stages[post.stage] && ['date', 'format', 'purpose', 'reason', 'channel'].every(key => typeof post[key] === 'string');
    if (saved.plan && saved.plan.brief && saved.plan.posts?.length > 0 && saved.plan.posts.length < 40 && saved.plan.posts.every(validPost) && typeof saved.plan.signature === 'string' && bases[saved.plan.mode]) {
      state.plan = saved.plan;
    }
    if (Number.isInteger(saved.reached)) state.reached = Math.max(1, Math.min(saved.reached, state.plan ? 4 : 3));
    if (Number.isInteger(saved.step)) state.step = Math.max(0, Math.min(saved.step, state.reached));
  } catch {
    // A missing or malformed local draft must not prevent the demo from opening.
  }
}
function readBrief() {
  return Object.fromEntries(new FormData($('#brief-form')).entries());
}
function writeBrief() {
  for (const [key, value] of Object.entries(state.brief)) { $(`#${key}`).value = value; $(`#${key}`).setCustomValidity(''); }
}
function signature() {
  return JSON.stringify({ brief: state.brief, mode: state.mode, competitors: state.mode === 'manual' ? state.competitors : '', unavailable: state.unavailable });
}
function go(step, focus = true) {
  if (step > state.reached) return;
  state.step = step;
  $$('.screen').forEach((screen, index) => { screen.hidden = index !== step; });
  $$('.nav-item').forEach((button) => {
    const index = Number(button.dataset.step);
    button.classList.toggle('active', step === index);
    button.disabled = index > state.reached;
    if (step === index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
  });
  $('#breadcrumb').textContent = stepNames[step];
  if (step === 2) renderAnalysis();
  if (step === 3) renderStrategy();
  if (step === 4 && state.plan) renderPlan();
  if (focus) { $('#main').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  save();
}
function sample() {
  Object.assign(state.brief, { business: 'Студия керамики «Форма»', audience: 'Взрослые, которые хотят попробовать творческое хобби и провести время с близкими', offer: 'Первый мастер-класс по керамике: создать свою чашку с нуля', links: 'https://t.me/forma_demo_example', goal: 'leads', horizon: '1', start: '2026-11-01', frequency: '3', channel: 'Telegram' });
  state.unavailable = false;
  writeBrief();
  $('#link-error').hidden = true;
  $('#links').removeAttribute('aria-invalid');
  save();
}
function validateLinks(value) {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    try {
      const url = new URL(lines[i]);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw new Error('invalid');
    } catch { return { error: `В строке ${i + 1} нужна полная ссылка, например https://t.me/channel. Проверьте адрес и оставьте одну ссылку на строку.` }; }
  }
  return { lines: [...new Set(lines)] };
}
function submitBrief(event) {
  event.preventDefault();
  if (!$('#brief-form').reportValidity()) return;
  const draft = readBrief();
  for (const key of ['business', 'audience', 'offer']) {
    if (!draft[key].trim()) { $(`#${key}`).setCustomValidity('Заполните поле, используя не только пробелы.'); $(`#${key}`).reportValidity(); return; }
    draft[key] = draft[key].trim();
  }
  const validation = validateLinks(draft.links);
  if (validation.error) {
    $('#link-error').textContent = validation.error;
    $('#link-error').hidden = false;
    $('#links').setAttribute('aria-invalid', 'true');
    $('#links').focus();
    return;
  }
  draft.links = validation.lines.join('\n');
  state.brief = draft;
  writeBrief();
  $('#link-error').hidden = true;
  $('#links').removeAttribute('aria-invalid');
  state.reached = Math.max(state.reached, 2);
  go(2);
}
function renderAnalysis() {
  const count = state.brief.links.split('\n').filter(Boolean).length;
  $('#unavailable').checked = state.unavailable;
  $('#unavailable').disabled = !count;
  $('#source-summary').textContent = count ? `Добавлено ссылок: ${count}. Загрузка отключена в демо.` : 'Соцсети не добавлены. Режим: план по брифу.';
  if (!count || state.unavailable) {
    $('#analysis-content').innerHTML = `<div class="notice warning"><strong>${count ? 'Демонстрация: источник недоступен' : 'Нет истории — можно начать с брифа'}</strong>${count ? 'Мы не знаем показатели публикаций. Недоступность данных не означает, что контент работает плохо.' : 'Персональных наблюдений пока нет. Для первого плана используем ваше описание бизнеса.'}</div><div class="empty-analysis"><div class="eyebrow">ДАННЫХ ДЛЯ РАЗБОРА НЕТ</div><h2>Честный старт с нуля.</h2><p>Можно вернуться и поправить ссылки или продолжить с гипотезами по брифу. В рабочем сервисе здесь пригодится подключение статистики или выгрузка владельца.</p><button class="button subtle" id="fix-source">Исправить бриф ←</button></div>`;
    $('#fix-source').addEventListener('click', () => go(1));
    return;
  }
  $('#analysis-content').innerHTML = `<div class="notice"><strong>Так мог бы выглядеть разбор — это вымышленные примеры.</strong>Содержимое ваших ссылок не загружалось. Ниже подготовлены две демонстрационные публикации, а не выводы о вашем бизнесе.</div><div class="insight-heading"><h2>Не оценка ради оценки.</h2><span>2 примера · метрика: реакции / просмотры</span></div><div class="insight-grid"><article class="insight"><div class="insight-top"><span>СИЛЬНЕЕ ОБЫЧНОГО · ПРИМЕР</span><span>↗</span></div><h3>«Как проходит первый мастер-класс»</h3><p>Понятный процесс и опыт новичка. Гипотеза: читателю легче представить себя на занятии.</p><div class="insight-metric"><strong>4,2%</strong><span>реакций на просмотры<br>у условного обычного поста — 1,8%</span></div></article><article class="insight"><div class="insight-top"><span>СЛАБЕЕ ОБЫЧНОГО · ПРИМЕР</span><span>↘</span></div><h3>«У нас снова свободные места»</h3><p>Предложение без контекста. Гипотеза: сначала стоит объяснить ценность и снять сомнения.</p><div class="insight-metric"><strong>0,6%</strong><span>реакций на просмотры<br>у условного обычного поста — 1,8%</span></div></article></div><p class="evidence">Все числа придуманы. В рабочем разборе нужны исходные посты, период, размер выборки и сопоставимые форматы. Реакции не показывают, сколько было заявок или продаж.</p>`;
}
function renderStrategy() {
  $$('.strategy-option').forEach((button) => {
    const selected = button.dataset.mode === state.mode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if (state.mode === 'funnel') {
    $('#strategy-detail').innerHTML = '<div class="notice"><strong>Пока используем пример воронки.</strong>Ваша структура ещё не получена. Заменим этот пример после того, как вы её предоставите.</div><div class="funnel-line"><div>Знакомство<small>Помочь узнать себя в проблеме</small></div><span>→</span><div>Доверие<small>Показать процесс, опыт и ответы</small></div><span>→</span><div>Предложение<small>Пригласить к понятному действию</small></div></div>';
  } else if (state.mode === 'manual') {
    $('#strategy-detail').innerHTML = `<label>Ссылки на конкурентов<textarea id="competitor-links" rows="3" placeholder="По одной полной ссылке на строку">${esc(state.competitors)}</textarea><small>Список для будущего анализа. В демо содержимое ссылок не загружается.</small></label><div class="form-error" id="competitor-error" role="alert" hidden></div>`;
    $('#competitor-links').addEventListener('input', (event) => { state.competitors = event.target.value; $('#competitor-error').hidden = true; save(); });
  } else {
    $('#strategy-detail').innerHTML = '<div class="notice"><strong>Автопоиск пока демонстрационный.</strong>В рабочем сервисе сначала нужно подтвердить нишу, географию и критерии конкурента. Эти кандидаты придуманы и не найдены в интернете.</div><div class="competitor-list"><div class="competitor"><strong>Кандидат 01</strong><p>Та же услуга и аудитория.<br>Прямой конкурент.</p><small>Вымышленный профиль</small></div><div class="competitor"><strong>Кандидат 02</strong><p>Соседняя категория.<br>Борется за тот же бюджет.</p><small>Вымышленный профиль</small></div><div class="competitor"><strong>Референс 03</strong><p>Сильная подача в другой нише.<br>Источник форматов.</p><small>Вымышленный профиль</small></div></div>';
  }
  const b = state.brief;
  const horizon = b.horizon === '1' ? 'Подробный месяц' : `Карта на ${b.horizon} месяцев + первый месяц подробно`;
  $('#strategy-summary').textContent = `${horizon} · ${b.frequency} публикации в неделю · ${b.channel}`;
}

const templates = [
  ['awareness', 'С какой задачей к нам приходят', 'Помочь аудитории узнать свою ситуацию', 'История + фото', 'Расскажите, какая часть истории вам знакома.'],
  ['trust', 'Как всё устроено: путь клиента', 'Снять неопределённость перед первым шагом', 'Фоторазбор', 'Задайте вопрос о процессе в комментариях.'],
  ['trust', 'Один частый вопрос — подробный ответ', 'Отработать конкретное сомнение', 'Пост-вопрос', 'Напишите, что ещё вам важно узнать.'],
  ['awareness', 'Три ошибки при выборе решения', 'Дать полезный критерий выбора', 'Чек-лист', 'Сохраните список перед выбором.'],
  ['trust', 'Разбор примера: задача, процесс, результат', 'Показать доказательства без неподтверждённых обещаний', 'Разбор кейса', 'Напишите, если у вас похожая задача.'],
  ['offer', 'Кому подойдёт наше предложение', 'Соединить потребность с конкретным предложением', 'Пост-приглашение', 'Напишите «подробнее», чтобы обсудить условия.'],
  ['awareness', 'Что важно знать перед первым шагом', 'Привлечь внимание полезным наблюдением', 'Короткое видео', 'Поделитесь с тем, кому это пригодится.'],
  ['trust', 'Что происходит за кадром', 'Показать подход и заботу о деталях', 'Фотоистория', 'Спросите о детали, которую хотите увидеть.'],
  ['trust', 'Сравнение двух подходов', 'Помочь принять осознанное решение', 'Сравнение', 'Расскажите, какой вариант ближе вам.'],
  ['awareness', 'Мини-инструкция для вашей задачи', 'Дать небольшой самостоятельный результат', 'Инструкция', 'Попробуйте один шаг и поделитесь наблюдением.'],
  ['trust', 'Сомнения, которые можно обсудить', 'Открыть диалог и снять барьер обращения', 'Вопросы и ответы', 'Напишите свой вопрос — разберём его отдельно.'],
  ['offer', 'Понятный следующий шаг', 'Перевести интерес в обращение', 'Предложение', 'Напишите нам, чтобы выбрать подходящий формат.'],
];
function parseDate(value) { return new Date(`${value}T12:00:00`); }
function isoDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function fmtDate(value, options = { day: 'numeric', month: 'short' }) { return parseDate(value).toLocaleDateString('ru-RU', options); }
function createPlan() {
  if (!$('#brief-form').checkValidity()) { go(1); $('#brief-form').reportValidity(); return; }
  state.brief = readBrief();
  const validation = validateLinks(state.brief.links);
  if (validation.error || ['business', 'audience', 'offer'].some(key => !state.brief[key].trim())) { go(1); notify('Проверьте бриф и ссылки, затем продолжите.'); return; }
  if (state.mode === 'manual') {
    const competitors = validateLinks(state.competitors);
    if (competitors.error || competitors.lines.length === 0) {
      $('#competitor-error').textContent = competitors.error || 'Добавьте хотя бы одну ссылку или выберите другую основу.';
      $('#competitor-error').hidden = false;
      $('#competitor-links').focus();
      return;
    }
    state.competitors = competitors.lines.join('\n');
  }
  const b = { ...state.brief };
  const start = parseDate(b.start);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1, 1);
  const daysInNextMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  end.setDate(Math.min(start.getDate(), daysInNextMonth));
  const offsets = { 2: [0, 3], 3: [0, 2, 4], 5: [0, 1, 2, 3, 4] }[b.frequency];
  const posts = [];
  for (let day = 0; day < 32; day++) {
    const date = new Date(start); date.setDate(date.getDate() + day);
    if (date >= end) break;
    if (!offsets.includes(day % 7)) continue;
    const index = posts.length;
    const template = templates[index % templates.length];
    let [stage, title, purpose, format, cta] = template;
    if (b.goal === 'launch') {
      if (day < 7) { stage = 'awareness'; title = ['Почему мы готовим новое предложение', 'Какую задачу решит новая услуга', 'Что важно вам в новом формате'][index % 3]; }
      else if (day < 21) { stage = 'trust'; title = ['Как устроена новая услуга', 'Отвечаем на вопросы перед стартом', 'Показываем процесс подготовки'][index % 3]; }
      else { stage = 'offer'; title = ['Новое предложение: состав и условия', 'Кому подойдёт новая услуга', 'Как сделать первый шаг'][index % 3]; }
      purpose = { awareness: 'Проверить интерес к новому предложению', trust: 'Объяснить формат и снять сомнения', offer: 'Пригласить обсудить новое предложение' }[stage];
      cta = stage === 'offer' ? 'Напишите «старт», чтобы узнать условия новой услуги.' : 'Расскажите, что хотите узнать о новом предложении.';
    } else if (b.goal === 'awareness' && stage === 'offer') {
      stage = 'awareness'; title = 'Полезная идея, которой хочется поделиться'; purpose = 'Помочь аудитории познакомиться с вашим подходом'; cta = 'Поделитесь с человеком, которому это полезно.';
    }
    if (index === 0 && b.goal !== 'launch') title = `С чего начинается знакомство с «${b.business}»`;
    const sourceReason = !b.links || state.unavailable ? 'История публикаций недоступна; это гипотеза по брифу.' : 'Используется демонстрационный шаблон; ваши публикации не анализировались.';
    const basisReason = { funnel: 'Позиция в примере воронки: знакомство → доверие → предложение.', manual: 'Вы добавили список конкурентов, но он ещё не анализировался. Этот план показывает формат гипотез.', auto: 'Кандидаты конкурентов вымышлены. План иллюстрирует формат, а не результат поиска.' }[state.mode];
    posts.push({ id: index, date: isoDate(date), week: Math.floor(day / 7) + 1, stage, title, purpose, format, cta, channel: b.channel, done: false, reason: `${sourceReason} ${basisReason} Аудитория: ${b.audience}. Предложение: ${b.offer}.` });
  }
  state.plan = { brief: b, mode: state.mode, signature: signature(), posts };
  state.filter = 'all';
  state.reached = 4;
  go(4);
  notify('Демонстрационный план собран. Откройте любую публикацию, чтобы её изменить.');
}
function renderRoadmap() {
  const b = state.plan.brief;
  const horizon = Number(b.horizon);
  $('#roadmap').hidden = horizon === 1;
  if (horizon === 1) { $('#roadmap').innerHTML = ''; return; }
  const themes = b.goal === 'launch'
    ? ['Подготовка и первый запуск', 'Обратная связь первых клиентов', 'Ответы и уточнение предложения', 'Примеры применения услуги', 'Расширение аудитории', 'Оценка и следующий цикл']
    : ['Позиционирование и знакомство', 'Вопросы и барьеры аудитории', 'Процесс и доказательства', 'Сравнение подходов', 'Сообщество и диалог', 'Итоги и новые гипотезы'];
  const start = parseDate(b.start);
  const items = Array.from({ length: horizon }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth() + i, 1, 12);
    const month = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return `<div class="roadmap-item"><span>${String(i + 1).padStart(2, '0')} / ${esc(month)}</span><h3>${esc(themes[i % themes.length])}</h3><small>${i === 0 ? 'Публикации первого месяца — ниже' : 'Направление · детализация после результатов'}</small></div>`;
  }).join('');
  $('#roadmap').innerHTML = `<div class="roadmap-heading"><h2>Карта на ${horizon} месяцев</h2><span>Черновые направления, а не обещание результата</span></div><div class="roadmap-grid">${items}</div>`;
}
function visiblePosts() { return state.plan.posts.filter(post => state.filter === 'all' || state.filter === post.stage); }
function renderPlan() {
  const { brief: b, posts } = state.plan;
  $('#stale-notice').hidden = signature() === state.plan.signature;
  $('#plan-subhead').textContent = `${b.business} · ${b.channel} · с ${fmtDate(b.start, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  $('#plan-goal').textContent = goals[b.goal];
  $('#plan-count').textContent = `${b.frequency} в неделю · ${posts.length} в первом месяце`;
  $('#plan-basis').textContent = bases[state.plan.mode];
  const start = parseDate(b.start);
  const finalDate = posts[posts.length - 1].date;
  const month = start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  $('#calendar-title').textContent = start.getDate() === 1 ? month.replace(' г.', '') : `${fmtDate(b.start)} — ${fmtDate(finalDate)}`;
  $('#completion').textContent = `${posts.filter(post => post.done).length} из ${posts.length} готовы · показано ${visiblePosts().length}`;
  $$('.filter-group button').forEach(button => {
    const selected = state.filter === button.dataset.filter;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  renderRoadmap();
  const selected = visiblePosts();
  if (!selected.length) { $('#calendar').innerHTML = '<div class="plan-empty">На этом этапе публикаций нет. Попробуйте фильтр «Все».</div>'; return; }
  const weeks = [...new Set(selected.map(post => post.week))];
  $('#calendar').innerHTML = weeks.map(week => {
    const weekPosts = selected.filter(post => post.week === week);
    return `<div class="week"><div class="week-label"><strong>Неделя ${week}</strong><span>${esc(fmtDate(weekPosts[0].date))}</span></div><div class="posts">${weekPosts.map(post => `<button class="post${post.done ? ' done' : ''}" data-post="${post.id}" aria-label="Изменить: ${esc(post.title)}"><div class="post-top"><span class="post-date">${esc(fmtDate(post.date, { day: 'numeric', weekday: 'short' }))}</span><span class="stage-label ${post.stage}">${stages[post.stage]}</span></div><h3>${esc(post.title)}</h3><p class="post-purpose">${esc(post.purpose)}</p><div class="post-bottom"><span>${esc(post.format)}</span><b>${post.done ? 'Готово ✓' : 'Открыть ↗'}</b></div></button>`).join('')}</div></div>`;
  }).join('');
  $$('[data-post]').forEach(button => button.addEventListener('click', () => openPost(Number(button.dataset.post))));
}
function openPost(id) {
  const post = state.plan.posts.find(item => item.id === id);
  if (!post) return;
  editingId = id;
  $('#post-meta').textContent = `${fmtDate(post.date)} · ${post.channel} · ${post.format}`;
  $('#post-title').value = post.title;
  $('#post-cta').value = post.cta;
  $('#post-purpose').textContent = post.purpose;
  $('#post-reason').textContent = post.reason;
  $('#post-done').checked = post.done;
  $('#post-dialog').showModal();
}
function savePost(event) {
  event.preventDefault();
  if (!$('#post-form').reportValidity()) return;
  for (const selector of ['#post-title', '#post-cta']) {
    if (!$(selector).value.trim()) { $(selector).setCustomValidity('Добавьте текст, используя не только пробелы.'); $(selector).reportValidity(); return; }
  }
  const post = state.plan.posts.find(item => item.id === editingId);
  post.title = $('#post-title').value.trim();
  post.cta = $('#post-cta').value.trim();
  post.done = $('#post-done').checked;
  $('#post-dialog').close();
  save(); renderPlan();
  notify(storageAvailable ? 'Правки сохранены в этом браузере.' : 'Правки применены до перезагрузки. Скачайте CSV, чтобы их сохранить.');
}
function csvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet programs may interpret user-entered text as a formula.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function exportCsv() {
  const posts = visiblePosts();
  if (!posts.length) { notify('В выбранном фильтре нет публикаций. Выберите «Все» для экспорта.'); return; }
  const header = ['Тип данных', 'Бизнес', 'Дата', 'Канал', 'Этап', 'Формат', 'Тема', 'Цель', 'Призыв к действию', 'Основание', 'Статус'];
  const rows = posts.map(post => ['ДЕМОНСТРАЦИЯ — не анализ соцсетей', state.plan.brief.business, post.date, post.channel, stages[post.stage], post.format, post.title, post.purpose, post.cta, post.reason, post.done ? 'Готово' : 'План']);
  const csv = '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `ritm-demo-${state.plan.brief.start}-${state.filter}.csv`; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`В CSV выгружено публикаций: ${posts.length}. Учтён выбранный фильтр.`);
}
function chatReply(empty = false) {
  const body = $('#chat-body');
  body.innerHTML = '<div class="chat-date">Сценарий знакомства</div><div class="bubble bot">Привет! Помогу собрать контент-план для вашего бизнеса.</div>';
  const user = document.createElement('div'); user.className = 'bubble user'; user.textContent = empty ? 'У меня пока нет соцсетей.' : 'Хочу составить план.'; body.append(user);
  const bot = document.createElement('div'); bot.className = 'bubble bot'; bot.textContent = empty ? 'Это нормально. Начнём с описания бизнеса. План будет гипотезой по брифу, без анализа публикаций.' : 'Начнём с короткого брифа: кому вы помогаете, что предлагаете и к чему должен вести контент.'; body.append(bot);
  $('.chat-actions').innerHTML = '<button id="chat-open">Открыть мини-приложение ↗</button>';
  $('#chat-open').addEventListener('click', () => { if (empty) { state.brief.links = ''; writeBrief(); } go(1); });
}

restore(); writeBrief();
$$('[data-step]').forEach(button => button.addEventListener('click', () => go(Number(button.dataset.step))));
$$('[data-back]').forEach(button => button.addEventListener('click', () => go(Number(button.dataset.back))));
$('.brand').addEventListener('click', event => { event.preventDefault(); go(0); });
$('#start-button').addEventListener('click', () => go(1));
$('#example-button').addEventListener('click', () => { sample(); go(1); });
$('#fill-example').addEventListener('click', () => { sample(); notify('Заполнен вымышленный пример. Можно изменить любое поле.'); });
$('#chat-plan').addEventListener('click', () => chatReply());
$('#chat-empty').addEventListener('click', () => chatReply(true));
$('#brief-form').addEventListener('submit', submitBrief);
$('#brief-form').addEventListener('input', event => {
  event.target.setCustomValidity?.('');
  state.brief = readBrief();
  if (event.target.id === 'links') { $('#link-error').hidden = true; $('#links').removeAttribute('aria-invalid'); }
  save();
});
$('#brief-form').addEventListener('change', () => { state.brief = readBrief(); save(); });
$('#unavailable').addEventListener('change', event => { state.unavailable = event.target.checked; save(); renderAnalysis(); });
$('#analysis-next').addEventListener('click', () => { state.reached = Math.max(state.reached, 3); go(3); });
$$('[data-mode]').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.mode; renderStrategy(); save(); }));
$('#generate').addEventListener('click', createPlan);
$$('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; renderPlan(); }));
$('#close-post').addEventListener('click', () => $('#post-dialog').close());
$('#post-form').addEventListener('submit', savePost);
$('#post-form').addEventListener('input', event => event.target.setCustomValidity?.(''));
$('#export').addEventListener('click', exportCsv);
$('#questions-button').addEventListener('click', () => $('#questions-dialog').showModal());
$('#close-questions').addEventListener('click', () => $('#questions-dialog').close());
go(state.step, false);
