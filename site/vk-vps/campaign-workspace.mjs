const names = {launch:'Запуск новой услуги',regular:'Регулярный контент',promo:'Акция или событие',sales:'Продажа'};
const hints = {
  launch:'Кому нужна услуга, как проходит первый визит и что мешает записаться.',
  regular:'Кто читает сообщество, какие вопросы задаёт и какие рубрики важны.',
  promo:'Для кого акция, что должно побудить человека обратиться и что важно объяснить.',
  sales:'Кому подходит предложение, что входит и какие сомнения чаще всего возникают.',
};
const strategy = {
  launch:'Знакомство с услугой → доверие → ответы на вопросы → приглашение попробовать.',
  regular:'Чередуем знакомство, советы, процесс работы и приглашение к диалогу.',
  promo:'Объясняем условия → показываем пользу → помогаем выбрать → приглашаем оформить.',
  sales:'Показываем пользу → объясняем процесс → помогаем выбрать → ведём к обращению.',
};
const colors=['#e7efdf','#e0eceb','#eeebf4','#f4e8d2'];
const phases=['Знакомство','Доверие','Решение','Действие'];
const $=id=>document.getElementById(id);
function node(tag,content,cls) {
  const element=document.createElement(tag);
  if (content!=null) element.textContent=content;
  if (cls) element.className=cls;
  return element;
}
function dateLabel(date, options={day:'numeric',month:'short'}) {
  return new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
}
function moveDate(date,offset) {
  const value=new Date(date+'T00:00:00Z');
  value.setUTCDate(value.getUTCDate()+offset);
  return value.toISOString().slice(0,10);
}
function localToday() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function countLabel(count) {
  const key=new Intl.PluralRules('ru').select(count);
  return count+' '+({one:'публикация',few:'публикации',many:'публикаций',other:'публикации'})[key];
}

function mountFrequencySlider(input) {
  const slider = input.parentElement;
  const track = slider.querySelector('.cp-slider-track');
  const thumb = track.querySelector('.cp-slider-thumb');
  const min = Number(input.min), span = Number(input.max) - min;
  let drag = null;

  const paint = position => slider.style.setProperty('--position', position * 100 + '%');
  const sync = () => { if (!drag) paint((input.valueAsNumber - min) / span); };
  const pointerPosition = event => {
    const {left, width} = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - left - drag.offset) / width));
  };
  function endDrag() {
    drag = null;
    delete slider.dataset.dragging;
  }

  slider.addEventListener('pointerdown', event => {
    if (drag || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    input.focus({preventScroll: true});
    const rect = thumb.getBoundingClientRect();
    const grabbedThumb = event.clientX >= rect.left && event.clientX <= rect.right;
    drag = {id: event.pointerId, offset: grabbedThumb ? event.clientX - rect.left - rect.width / 2 : 0};
    slider.setPointerCapture(event.pointerId);
    slider.dataset.dragging = '';
    paint(pointerPosition(event));
  });
  slider.addEventListener('pointermove', event => {
    if (event.pointerId === drag?.id) paint(pointerPosition(event));
  });
  slider.addEventListener('pointerup', event => {
    if (event.pointerId !== drag?.id) return;
    const value = min + Math.round(pointerPosition(event) * span);
    const changed = value !== input.valueAsNumber;
    endDrag();
    input.valueAsNumber = value;
    sync();
    if (changed) input.dispatchEvent(new Event('input', {bubbles: true}));
  });
  for (const name of ['pointercancel', 'lostpointercapture']) {
    slider.addEventListener(name, event => {
      if (event.pointerId !== drag?.id) return;
      endDrag();
      sync();
    });
  }
  return sync;
}

export function mountCampaign({api,selectPanel,refreshQueue,onChange}) {
  const syncFrequencySlider = mountFrequencySlider($('cp-frequency'));
  let current=null, groups=[], view='brief', connected=false, ready=false, busy=false, loaded=false, epoch=0, selected=null;
  let editorialEnabled = false, generationTimer;
  let generationPolls = 0;
  const scenarioFields = {
    launch: ['Что меняется для клиента', 'Например, кому подходит услуга и как проходит первый визит.'],
    regular: ['Рубрики и вопросы подписчиков', 'Например, советы тренера, вопросы новичков и жизнь бассейна.'],
    promotion: ['Выгода и ограничения акции', 'Например, кому доступна скидка и на какие услуги она действует.'],
    event: ['Программа и место проведения', 'Например, что входит в программу, где встречаемся и кто может прийти.'],
    sales: ['Причины выбрать предложение', 'Например, что входит, с чем сравнивают и какие вопросы задают перед покупкой.']
  };
  const readGoal=()=>document.querySelector('[name="cp-goal"]:checked').value;
  const matchGroup = id => groups.find(group => group.id === id)
    ?? (current?.managedGroup?.id === id ? current.managedGroup : undefined);
  const notice=(message,error=false)=>{ $('cp-status').textContent=message; $('cp-status').hidden=!message; $('cp-status').classList.toggle('error',error); };
  const errorAt=(id,message)=>{ $(id).textContent=message; $(id).hidden=!message; };
  const active=requestEpoch=>connected&&epoch===requestEpoch;
  function setView(next,focus=false) {
    view=next;
    for (const name of ['brief','calendar','posts']) $('cp-'+name).hidden=!loaded||next!==name;
    $('cp-return').hidden=!loaded||!current;
    $('cp-return').textContent=next==='brief'?'Вернуться к плану':'Новый план';
    $('campaign-title').textContent=next==='brief'?'Новый контент-план':next==='calendar'?'Календарь публикаций':'Публикации';
    $('cp-subtitle').textContent=next==='brief'?'Бриф, календарь и тексты для одного сообщества.'
      :countLabel(current.posts.length)+' · '+dateLabel(current.start)+' — '+dateLabel(current.end);
    renderSummary();
    if (focus) {
      const title = $('campaign-title');
      title.focus({preventScroll:true});
      const {top, bottom} = title.getBoundingClientRect();
      if (top < 0 || bottom > innerHeight) title.scrollIntoView({block:'start'});
    }
  }
  function openBrief() {
    if (!loaded || busy) return false;
    setView('brief', true);
    return true;
  }
  function renderSummary() {
    const duration = Number($('cp-duration').value);
    const start = view === 'brief' ? $('cp-start').value : current.start;
    const end = view === 'brief' && start ? moveDate(start, duration - 1) : current?.end;
    const count = view === 'brief' ? Number($('cp-frequency').value) * duration : current.posts.length;
    $('cp-count').textContent = loaded ? countLabel(count) : '—';
    $('cp-range').hidden = !loaded || !start;
    if (loaded && start) $('cp-range').textContent = dateLabel(start) + ' — ' + dateLabel(end);
    $('cp-next').textContent = view === 'brief' ? 'Заполните бриф, чтобы получить календарь и тексты.'
      : current.queueIds ? 'План в очереди. Там можно проверить статусы.'
      : view === 'calendar' ? 'Проверьте темы, даты и время. Затем подтвердите календарь.'
      : 'Проверьте тексты и передайте план в очередь.';
  }
  function controls() {
    const preparing = current?.generation?.status === 'generating';
    const flagged = current?.posts.some(post => post.warnings?.length);
    const inQueue=Boolean(current?.queueIds);
    $('cp-feed').disabled=busy||!ready||!$('cp-group').value;
    $('cp-generate').disabled=busy||preparing||!$('cp-group').value;
    $('cp-reload').disabled=busy;
    $('cp-return').disabled=busy;
    $('cp-calendar-back').disabled=busy;
    $('cp-group').disabled=busy;
    for (const id of ['cp-time-open','cp-edit-save','cp-time-save','cp-calendar-confirm']) $(id).disabled=busy||preparing||inQueue;
    $('cp-queue-open').disabled=busy||preparing||flagged||!ready||!current?.calendarConfirmed;
    $('cp-queue-open').hidden=inQueue;
    $('cp-open-queue').hidden=!inQueue;
    $('cp-queue-send').disabled=busy||preparing||flagged||!ready||inQueue;
    $('cp-queue-hint').textContent=inQueue?'План уже в очереди. Отдельные записи можно отменить до отправки.'
      :preparing?'Готовим тексты.'
      :flagged?'Уточните факты в отмеченных публикациях или обновите бриф.'
      :!ready?'Для передачи плана подключите VK в разделе «Подключения».':'Прочитайте тексты перед утверждением. Сохранение правок оставляет план в кабинете.';
  }
  async function work(fn,dialogError) {
    if (busy||!connected) return;
    const requestEpoch=epoch;
    busy=true; controls(); $('cp-reload').hidden=true;
    try {
      if(dialogError) errorAt(dialogError,'');
      await fn(requestEpoch);
    } catch(error) {
      if(!active(requestEpoch)) return;
      const message=error instanceof TypeError?'VPS не ответил. Обновите план перед повтором.':error.message;
      if(dialogError) errorAt(dialogError,message);
      else notice(message,true);
      $('cp-reload').hidden=false;
    } finally {
      if(active(requestEpoch)) { busy=false; controls(); }
    }
  }
  let managedGroups = null;
  function fillGroups(preferred) {
    const select = $('cp-group');
    const options = groups.map(group => new Option(group.name, group.id));
    if (managedGroups) options.unshift(new Option('Выберите сообщество', ''));
    select.replaceChildren(...options);
    if (groups.some(group => String(group.id) === preferred)) select.value = preferred;
  }
  function fillEditorial(value) {
    $('cp-kind').value = value?.kind === 'event' ? 'event' : 'promotion';
    $('cp-availability').value = value?.availableOn ?? '';
    $('cp-event-date').value = value?.eventDate ?? '';
    $('cp-registration').value = value?.registrationEnd ?? '';
    $('cp-specifics').value = value?.specifics ?? '';
    $('cp-facts').value = value?.facts?.join('\n') ?? '';
    $('cp-history').value = value?.history?.join('\n') ?? '';
  }
  function editorialBrief() {
    return { kind: $('cp-kind').value, availableOn: $('cp-availability').value, eventDate: $('cp-event-date').value,
      registrationEnd: $('cp-registration').value, specifics: $('cp-specifics').value,
      facts: $('cp-facts').value, history: $('cp-history').value };
  }
  function fillForm() {
    fillEditorial(current?.editorial);
    fillGroups(current ? String(current.groupId) : '');
    if(current) {
      document.querySelector('[name="cp-goal"][value="'+current.goal+'"]').checked=true;
      $('cp-duration').value=current.duration; $('cp-start').value=current.start;
      $('cp-frequency').value=current.frequency; $('cp-subject').value=current.subject;
      $('cp-details').value=current.brief; $('cp-conditions').value=current.conditions; $('cp-cta').value=current.cta; $('cp-offer-end').value=current.offerEnd??'';
    } else $('cp-start').value=moveDate(localToday(),1);
    updateForm();
  }
  function updateForm() {
    const frequency=Number($('cp-frequency').value);
    const label=frequency===1?'Раз в день':frequency+' раза в день';
    syncFrequencySlider();
    $('cp-frequency-label').textContent=label; $('cp-frequency').setAttribute('aria-valuetext',label);
    renderSummary();
    $('cp-group-link').textContent=matchGroup(Number($('cp-group').value))?.url??(managedGroups ? (groups.length ? 'Выберите сообщество для плана.' : 'Подключите VK и дождитесь списка сообществ.') : 'На VPS пока нет настроенного сообщества.');
    $('cp-brief-hint').textContent=hints[readGoal()];
    const goal = readGoal(), promo = goal === 'promo';
    const kind = promo && editorialEnabled ? $('cp-kind').value : '';
    const event = kind === 'event';
    $('cp-editorial').hidden = !editorialEnabled;
    $('cp-kind-field').hidden = !promo;
    $('cp-availability-field').hidden = goal !== 'launch';
    $('cp-event-fields').hidden = !event;
    $('cp-event-date').required = event;
    $('cp-offer-end-field').hidden = !promo || event;
    $('cp-offer-end').required = promo && !event;
    const [title, help] = scenarioFields[kind || goal] ?? scenarioFields.promotion;
    $('cp-specifics-label').textContent = title;
    $('cp-specifics-hint').textContent = help;
    controls();
  }
  async function load() {
    return work(async requestEpoch=>{
      notice('Загружаем план с VPS…');
      const result=await api('/api/campaign');
      if(!active(requestEpoch)) return;
      editorialEnabled = result.editorial === true;
      groups=managedGroups ?? result.groups; current=result.campaign; loaded=true; fillForm();
      if(current) { renderPlan(); monitorGeneration(); }
      else onChange?.();
      setView(current?(current.queueIds?'posts':'calendar'):'brief');
      notice('');
    });
  }
  function monitorGeneration() {
    clearTimeout(generationTimer);
    if (!connected || current?.generation?.status !== 'generating') return;
    const expected = current.id;
    const requestEpoch = epoch;
    generationTimer = setTimeout(async () => {
      if (!active(requestEpoch) || current?.id !== expected) return;
      try {
        const { campaign } = await api('/api/campaign');
        if (!active(requestEpoch) || campaign?.id !== expected) return;
        current = campaign;
        renderPlan();
        monitorGeneration();
      } catch {
        if (active(requestEpoch) && ++generationPolls <= 3) monitorGeneration();
        else if (active(requestEpoch)) {
          notice('Не удалось обновить статус. Откройте план заново.', true);
          $('cp-reload').hidden = false;
        }
      }
    }, 2500);
  }
  async function save(changes,requestEpoch) {
    const result=await api('/api/campaign/save',{id:current.id,revision:current.revision,times:current.times,posts:current.posts,
      calendarConfirmed:current.calendarConfirmed,...changes});
    if(!active(requestEpoch)) return false;
    current=result.campaign; renderPlan(); return true;
  }
  function dayGroups() {
    const groupsByDay=new Map();
    for(let i=0;i<current.duration;i++) groupsByDay.set(moveDate(current.start,i),[]);
    for(const post of [...current.posts].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))) groupsByDay.get(post.date).push(post);
    return groupsByDay;
  }
  function paddingDays() { return (new Date(current.start+'T00:00:00Z').getUTCDay()+6)%7; }
  function renderPlan() {
    const {subject,goal,times,queueIds}=current;
    renderSummary();
    $('cp-cover-title').textContent=subject;
    $('cp-cover-meta').textContent=names[goal]+' · '+matchGroup(current.groupId)?.name;
    $('cp-strategy').textContent=current.strategy ?? strategy[goal];
    const generation = current.generation;
    const status = generation?.status === 'generating' ? 'Готовим темы и тексты…'
      : generation?.status === 'failed' ? 'Модель не завершила работу. Сохранены черновики по правилам.'
        : generation?.mode === 'ai' ? 'Черновики подготовлены с помощью ИИ.'
          : generation ? 'Черновики подготовлены по правилам сценария.' : '';
    $('cp-generation').hidden = !status;
    if ($('cp-generation').textContent !== status) $('cp-generation').textContent = status;
    $('cp-default').textContent=times.join(' · ');
    $('cp-calendar-confirm').hidden=Boolean(queueIds);
    $('cp-calendar-confirm').textContent=current.calendarConfirmed?'К текстам постов →':'Подтвердить календарь →';
    const calendar=$('cp-days'), list=$('cp-list');
    calendar.replaceChildren(); list.replaceChildren();
    for(let i=0;i<paddingDays();i++) calendar.append(node('div',null,'cp-day cp-pad'));
    for(const [date,posts] of dayGroups()) {
      const day=node('div',null,'cp-day'+(posts.length?'':' cp-empty'));
      const dateNode=node('time',dateLabel(date),'cp-date'); dateNode.dateTime=date; day.append(dateNode);
      for(const post of posts) {
        const phase=phases.indexOf(post.phase);
        const button=node('button',null,'cp-event cp-phase-'+phase);
        button.type='button'; button.disabled = current.generation?.status === 'generating';
        if (post.why) button.title = post.why;
        button.append(node('small',post.time),document.createTextNode(post.topic));
        button.addEventListener('click',()=>openEditor(post)); day.append(button);
        const card=node('article',null,'card cp-post');
        const title=node('h3',post.topic); const meta=node('p',dateLabel(post.date)+' · '+post.time+' · '+post.phase,'hint');
        const copy=node('p',post.copy,'cp-copy'); const open=node('button',queueIds?'Открыть':'Редактировать','secondary');
        open.type='button'; open.disabled = Boolean(button.disabled); open.addEventListener('click',()=>openEditor(post));
        card.append(title,meta);
        if (post.why) card.append(node('p', post.why, 'hint'));
        if (post.warnings?.length) card.append(node('p', post.warnings.join(' '), 'cp-error'));
        card.append(copy,open); list.append(card);
      }
      calendar.append(day);
    }
    controls();
    onChange?.();
  }
  function scheduleLabel() {
    const date=$('cp-edit-date').value,time=$('cp-edit-time').value;
    $('cp-edit-when').textContent=date&&time?dateLabel(date)+' · '+time:'';
  }
  function openEditor(post) {
    if(busy || current.generation?.status === 'generating') return;
    $('cp-edit-why').textContent = post.why ?? '';
    $('cp-edit-why').hidden = !post.why;
    $('cp-edit-facts').textContent = post.warnings?.join(' ') ?? '';
    $('cp-edit-facts').hidden = !post.warnings?.length;
    selected=post.id;
    $('cp-editor-group').textContent=matchGroup(current.groupId)?.name??'Сообщество VK';
    $('cp-edit-topic').value=post.topic; $('cp-edit-copy').value=post.copy;
    $('cp-edit-date').value=post.date; $('cp-edit-time').value=post.time;
    $('cp-edit-date').min=current.start; $('cp-edit-date').max=current.end;
    for(const id of ['cp-edit-topic','cp-edit-copy','cp-edit-date','cp-edit-time']) $(id).readOnly=Boolean(current.queueIds);
    $('cp-edit-save').hidden=Boolean(current.queueIds);
    scheduleLabel(); errorAt('cp-edit-error',''); $('cp-edit-dialog').showModal();
  }
  $('cp-reload').addEventListener('click',load);
  $('cp-return').addEventListener('click',()=>{if(view==='brief')setView(current.queueIds?'posts':'calendar',true);else openBrief();});
  $('cp-calendar-back').addEventListener('click',openBrief);
  $('cp-form').addEventListener('input',updateForm);
  $('cp-group').addEventListener('change',()=>{ $('cp-feed-result').hidden=true; updateForm(); });
  $('cp-feed').addEventListener('click',()=>work(async requestEpoch=>{
    const groupId=Number($('cp-group').value);
    $('cp-feed-result').hidden=true;
    notice('Читаем доступные записи сообщества…');
    const {feed}=await api('/api/campaign/feed',{groupId});
    if(!active(requestEpoch)) return;
    const content=$('cp-feed-result');
    content.replaceChildren(node('strong',feed.sampleSize?'Наблюдения по видимым записям':'Доступных записей для разбора не найдено.'));
    if(feed.sampleSize) {
      content.append(node('p','Записей: '+feed.sampleSize+' · с фото: '+feed.withPhoto+' · средний текст: '+feed.averageLength+' знаков.'));
      if(feed.cues.length) content.append(node('p','Частые признаки: '+feed.cues.map(item=>item.label+' ('+item.count+')').join(', ')+'.'));
    }
    content.hidden=false; notice('');
  }));
  $('cp-form').addEventListener('submit',event=>{
    event.preventDefault();
    if (current?.generation?.status === 'generating') return;
    if(current&&!window.confirm('Заменить текущий план новым? Записи, уже переданные в очередь, сохранятся.')) return;
    work(async requestEpoch=>{
      notice('Составляем календарь…');
      const result=await api('/api/campaign/generate',{goal:readGoal(),groupId:Number($('cp-group').value),
        subject:$('cp-subject').value,brief:$('cp-details').value,conditions:$('cp-conditions').value,cta:$('cp-cta').value,
        offerEnd:$('cp-offer-end').value,start:$('cp-start').value,duration:Number($('cp-duration').value),frequency:Number($('cp-frequency').value),
        replaceId:current?.id,replaceRevision:current?.revision,
        ...(editorialEnabled ? { editorial: editorialBrief() } : {})});
      if(!active(requestEpoch)) return;
      current=result.campaign; generationPolls = 0;
      renderPlan(); notice(''); setView('calendar',true); monitorGeneration();
    });
  });
  $('cp-calendar-confirm').addEventListener('click',()=>work(async requestEpoch=>{
    if(!current.calendarConfirmed && !await save({calendarConfirmed:true},requestEpoch)) return;
    setView('posts',true); notice('Календарь подтверждён. Проверьте тексты перед передачей в очередь.');
  }));
  $('cp-to-calendar').addEventListener('click',()=>setView('calendar',true));
  $('cp-open-queue').addEventListener('click',()=>selectPanel('queue',true));
  $('cp-edit-date').addEventListener('input',scheduleLabel);
  $('cp-edit-time').addEventListener('input',scheduleLabel);
  $('cp-edit-form').addEventListener('submit',event=>{
    event.preventDefault();
    work(async requestEpoch=>{
      const posts=current.posts.map(post=>{
        if(post.id!==selected) return post;
        const date=$('cp-edit-date').value,time=$('cp-edit-time').value;
        return {...post,topic:$('cp-edit-topic').value,copy:$('cp-edit-copy').value,date,time,customTime:post.customTime||date!==post.date||time!==post.time};
      });
      if(await save({posts},requestEpoch)) { $('cp-edit-dialog').close(); notice('Правки сохранены.'); }
    },'cp-edit-error');
  });
  $('cp-time-open').addEventListener('click',()=>{
    const labels=current.times.map((time,i)=>{
      const label=node('label',current.times.length===1?'Время публикации':'Время '+(i+1));
      const input=node('input'); input.type='time'; input.value=time; input.required=true; label.append(input); return label;
    });
    $('cp-time-fields').replaceChildren(...labels); errorAt('cp-time-error',''); $('cp-time-dialog').showModal();
  });
  $('cp-time-form').addEventListener('submit',event=>{
    event.preventDefault();
    work(async requestEpoch=>{
      const times=[...$('cp-time-fields').querySelectorAll('input')].map(input=>input.value).sort();
      const posts=current.posts.map(post=>post.customTime?post:{...post,time:times[post.slot]});
      if(await save({times,posts},requestEpoch)) { $('cp-time-dialog').close(); notice('Общее время изменено. Индивидуальные правки сохранены.'); }
    },'cp-time-error');
  });
  $('cp-queue-open').addEventListener('click',()=>{
    $('cp-queue-summary').textContent=countLabel(current.posts.length)+' · '+matchGroup(current.groupId)?.name+' · '+dateLabel(current.start)+' — '+dateLabel(current.end);
    errorAt('cp-queue-error',''); $('cp-queue-dialog').showModal();
  });
  $('cp-queue-form').addEventListener('submit',event=>{
    event.preventDefault();
    work(async requestEpoch=>{
      const result=await api('/api/campaign/enqueue',{id:current.id,revision:current.revision,reviewHash:current.reviewHash});
      if(!active(requestEpoch)) return;
      current=result.campaign; renderPlan(); $('cp-queue-dialog').close();
      notice('План передан в очередь VPS.');
      await refreshQueue();
    },'cp-queue-error');
  });
  for(const button of document.querySelectorAll('[data-cp-close]')) button.addEventListener('click',()=>{if(!busy) $(button.dataset.cpClose).close();});
  $('cp-png').addEventListener('click',()=>exportCalendar(current,[...dayGroups()],paddingDays()));
  return {
    openBrief,
    getSearchSnapshot() { return { campaign: current, ready: loaded, groups }; },
    openSearchPost(campaignId, postId) {
      const post = current?.id === campaignId && current.posts.find(item => item.id === postId);
      if (!post || busy) return false;
      selectPanel('campaign', true);
      setView(current.queueIds ? 'posts' : 'calendar');
      openEditor(post);
      return true;
    },
    updateConnection(nextConnected, nextReady, nextGroups = null) {
      ready=nextReady;
      if (nextGroups !== managedGroups) {
        managedGroups = nextGroups;
        if (nextConnected && nextGroups) {
          const preferred = $('cp-group').value;
          groups = nextGroups;
          if (loaded) {
            fillGroups(preferred);
            updateForm();
          }
        }
      }
      if (nextConnected!==connected) {
        connected=nextConnected; epoch++;
        if(connected) load();
        else {
          clearTimeout(generationTimer); editorialEnabled = false;
          current=null; groups=[]; loaded=false; busy=false; selected=null;
          $('cp-form').reset(); $('cp-feed-result').replaceChildren(); $('cp-feed-result').hidden=true;
          $('cp-days').replaceChildren(); $('cp-list').replaceChildren();
          for(const id of ['cp-edit-topic','cp-edit-copy','cp-edit-date','cp-edit-time']) $(id).value='';
          for(const id of ['cp-edit-dialog','cp-time-dialog','cp-queue-dialog']) $(id).close();
          $('cp-queue-summary').textContent=''; $('cp-cover-title').textContent=''; $('cp-cover-meta').textContent='';
          setView('brief'); notice(''); $('cp-reload').hidden=true;
        }
      }
      controls();
    },
  };
}

function exportCalendar(campaign,days,padding) {
  const canvas=node('canvas'), width=1332, column=184, left=25, top=124;
  const height=40+Math.max(...days.map(([,posts])=>posts.length))*55;
  canvas.width=width; canvas.height=top+Math.ceil((days.length+padding)/7)*height+20;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#f4f4eb'; ctx.fillRect(0,0,width,canvas.height);
  ctx.fillStyle='#203b33'; ctx.font='bold 27px Georgia'; ctx.fillText(campaign.subject,left,43,width-50);
  ctx.font='16px system-ui'; ctx.fillText(dateLabel(campaign.start)+' — '+dateLabel(campaign.end)+' · Екатеринбург',left,72);
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach((name,i)=>ctx.fillText(name,left+i*column,110));
  for(const [index,[date,posts]] of days.entries()){
    const position=index+padding,x=left+position%7*column,y=top+Math.floor(position/7)*height;
    ctx.fillStyle='#fffdf8'; ctx.fillRect(x,y,column-6,height-5);
    ctx.fillStyle='#203b33'; ctx.font='bold 14px system-ui'; ctx.fillText(dateLabel(date),x+6,y+20);
    for(const [i,post] of posts.entries()){
      const yy=y+28+i*55;
      ctx.fillStyle=colors[phases.indexOf(post.phase)];ctx.fillRect(x+4,yy,column-14,50);
      ctx.fillStyle='#203b33';ctx.font='11px system-ui';ctx.fillText(post.time,x+9,yy+14);
      ctx.font='bold 13px system-ui';
      let line='', row=0;
      for(const word of post.topic.split(/\s+/)){
        const next=line?(line+' '+word):word;
        if(line&&ctx.measureText(next).width>column-22){ctx.fillText(line,x+9,yy+29+row*14,column-22);line=word;row++;if(row===2)break;}
        else line=next;
      }
      if(row<2)ctx.fillText(line,x+9,yy+29+row*14,column-22);
    }
  }
  canvas.toBlob(blob=>{
    if(!blob)return;
    const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='content-planner.png';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
}
