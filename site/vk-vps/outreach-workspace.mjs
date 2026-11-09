const $=id=>document.getElementById(id);
function element(tag,text,css) {const e=document.createElement(tag);if(text!=null)e.textContent=text;if(css)e.className=css;return e;}
const modes={wall:'Можно на стену',suggest:'На модерацию',unknown:'Требуется проверка',closed:'Доступ не подтверждён'};
const day=86400000, timeZone='Asia/Yekaterinburg';
const formatDate=(stamp,options)=>new Intl.DateTimeFormat('ru-RU',{timeZone,...options}).format(new Date(stamp));

function canonicalLink(raw){
  try{
    const url=new URL(/^https:\/\//i.test(raw)?raw:'https://'+raw);
    if(url.protocol==='https:'&&['vk.ru','vk.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&/^\/[\w][\w.-]{1,98}[\w]\/?$/.test(url.pathname))
      return 'https://vk.ru'+url.pathname.replace(/\/$/,'').toLowerCase();
  }catch{}
  return '';
}

export function mountOutreach({api,selectPanel,refreshQueue}){
  let targets=[],connected=false,ready=false,busy=false,epoch=0,previewUrl='',review=null;
  const reviewBox=$('or-review');
  function notice(text,error=false) {
    $('or-status').hidden=!text;$('or-status').textContent=text;$('or-status').classList.toggle('error',error);
  }
  function reviewError(text){
    $('or-review-error').hidden=!text;$('or-review-error').textContent=text;
  }
  function localDates(){
    const once=$('or-cadence').value==='once';
    const first=$('or-start').value, last=once?first:$('or-end').value, hour=$('or-time').value;
    const start=Date.parse(first+'T'+hour+':00+05:00'), end=Date.parse(last+'T'+hour+':00+05:00');
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>90*day)return [];
    const step=$('or-cadence').value==='fortnight'?14*day:7*day;
    const values=[];
    for(let t=start;t<=end;t+=step)values.push(t);
    return values;
  }
  function draw(rebuildTargets=true){
    const selected=targets.filter(target=>target.selected);
    const dates=localDates(),cadence=$('or-cadence').value;
    $('or-end-label').hidden=cadence==='once';
    $('or-preview-text').textContent=$('or-text').value.trim()||'Текст поста появится здесь.';
    $('or-selected-count').textContent=selected.length;
    $('or-target-count').textContent='Групп выбрано · ссылок ' + targets.length + ' из 5';
    $('or-wall-count').textContent=selected.filter(t=>t.route==='wall').length;
    $('or-suggest-count').textContent=selected.filter(t=>t.route==='suggest').length;
    $('or-date-count').textContent=dates.length;
    const dateSummary=$('or-date-summary');
    dateSummary.hidden=!dates.length;
    if(dates.length){
      const options={day:'numeric',month:'short'};
      const first=formatDate(dates[0],options);
      const period=dates.length===1?first:first+' — '+formatDate(dates.at(-1),options);
      dateSummary.textContent=period+' · '+$('or-time').value+' (Екатеринбург)';
    }
    $('or-next').textContent=!targets.length?'Добавьте ссылку на сообщество.'
      :!selected.length?'Проверьте доступ и выберите сообщества.'
      :!$('or-text').value.trim()?'Добавьте текст поста.'
      :!dates.length?'Выберите даты и время отправки.'
      :'Проверьте рассылку перед отправкой. Модератор сам определяет время выхода предложенной записи.';
    $('or-access').textContent=ready?'Проверка ищет доступную кнопку в VK для вашего профиля.':'Подключите VK, чтобы проверить группы.';
    $('or-prepare').disabled=busy||!ready||!selected.length||!dates.length||!$('or-text').value.trim();
    $('or-review-send').disabled=busy||!ready||!review;
    $('or-review-close').disabled=busy;
    if(!rebuildTargets)return;
    $('or-targets').replaceChildren(...targets.map(target=>{
      const row=element('li',null,'or-target'), select=element('input');
      select.type='checkbox';select.checked=target.selected;select.disabled=busy||!target.checkId;
      select.setAttribute('aria-label',target.name);
      select.addEventListener('change',()=>{target.selected=select.checked;draw(false);});
      const label=element('div');label.append(element('strong',target.name),element('small',target.link));
      const route=element('span',modes[target.route],'or-state '+target.route);
      const actions=element('div');
      const check=element('button','Проверить','secondary');check.type='button';check.disabled=busy||!ready;
      check.setAttribute('aria-label','Проверить '+target.name);
      check.addEventListener('click',()=>work(async generation=>{
        const result=await api('/api/outreach/check',{link:target.link});
        if(!active(generation))return;
        target.name=result.target.name;target.route=result.route??'closed';target.checkId=result.checkId??null;target.selected=Boolean(result.checkId);
        notice(result.reason??'Доступ проверен.');
      }));
      const remove=element('button','×','secondary');remove.type='button';remove.disabled=busy;
      remove.setAttribute('aria-label','Убрать '+target.name);
      remove.addEventListener('click',()=>{targets=targets.filter(item=>item!==target);draw();});
      actions.append(check,remove);row.append(select,label,route,actions);
      return row;
    }));
  }
  function active(generation){return connected&&generation===epoch;}
  async function work(task,inDialog=false){
    if(!connected||busy)return;
    const generation=epoch;
    busy=true;draw();
    try{
      if(inDialog)reviewError('');else notice('');
      await task(generation);
    }catch(error){
      if(!active(generation))return;
      const text=error instanceof TypeError?'Сервер не ответил. Проверьте очередь перед повтором.':error.message;
      if(inDialog)reviewError(text);else notice(text,true);
    }finally{if(active(generation)){busy=false;draw();}}
  }
  $('or-add').addEventListener('submit',event=>{
    event.preventDefault();
    const links=[...new Set($('or-links').value.trim().split(/[\s,;]+/).filter(Boolean).map(canonicalLink))];
    if(!links.length||links.includes('')){notice('Добавьте ссылки на сообщества vk.ru или vk.com.',true);return;}
    const fresh=links.filter(link=>!targets.some(target=>target.link===link));
    if(targets.length+fresh.length>5){notice('В одну рассылку можно добавить до пяти групп.',true);return;}
    targets.push(...fresh.map(link=>({link,name:new URL(link).pathname.slice(1),route:'unknown',checkId:null,selected:false})));
    $('or-links').value='';notice(fresh.length?'Теперь проверьте доступ для каждой группы.':'Эти группы уже добавлены.');draw();
  });
  for(const id of ['or-text','or-cadence','or-start','or-end','or-time']) $(id).addEventListener('input',()=>draw(false));
  function clearImage(){
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl='';$('or-file').value='';$('or-preview-image').hidden=true;$('or-preview-image').removeAttribute('src');$('or-clear').hidden=true;
  }
  $('or-file').addEventListener('change',()=>{
    const file=$('or-file').files[0];
    if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size>5*1024*1024){
      clearImage();if(file)notice('Выберите PNG или JPEG до 5 МБ.',true);return;
    }
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=URL.createObjectURL(file);$('or-preview-image').src=previewUrl;$('or-preview-image').hidden=false;$('or-clear').hidden=false;
  });
  $('or-clear').addEventListener('click',clearImage);
  $('or-prepare').addEventListener('click',()=>work(async generation=>{
    const file=$('or-file').files[0];
    const value={checkIds:targets.filter(t=>t.selected).map(t=>t.checkId),text:$('or-text').value,
      start:$('or-start').value,end:$('or-end').value,time:$('or-time').value,cadence:$('or-cadence').value};
    if(file)value.mediaId=(await api('/api/media',file,false,file.type)).media.id;
    const result=await api('/api/outreach/prepare',value);
    if(!active(generation))return;
    review=result;
    $('or-review-dates').textContent=result.dates.map(date=>formatDate(date,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})).join(' · ')+' · Екатеринбург';
    $('or-review-targets').replaceChildren(...result.targets.map(t=>element('li',t.name+' · '+(t.route==='wall'?'на стену от вашего имени':'на модерацию'))));
    reviewError('');reviewBox.showModal();
  }));
  $('or-review-close').addEventListener('click',()=>reviewBox.close());
  reviewBox.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('or-review-send').addEventListener('click',()=>work(async generation=>{
    const result=await api('/api/outreach/approve',{id:review.id,reviewHash:review.reviewHash});
    if(!active(generation))return;
    review=null;reviewBox.close();$('or-queue').hidden=false;
    notice('Добавлено в очередь VPS: '+result.ids.length+'.');
    await refreshQueue();
  },true));
  $('or-queue').addEventListener('click',()=>selectPanel('queue',true));
  return {updateConnection(nextConnected,nextReady){
    if(connected===nextConnected&&ready===nextReady)return;
    ready=nextReady;
    if(connected!==nextConnected){
      connected=nextConnected;epoch++;
      if(!connected){
        busy=false;targets=[];review=null;reviewBox.close();clearImage();$('or-links').value='';$('or-text').value='';
        $('or-start').value='';$('or-end').value='';$('or-time').value='19:00';$('or-cadence').value='once';$('or-queue').hidden=true;notice('');
      }
    }
    draw();
  }};
}
