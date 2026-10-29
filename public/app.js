const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,month=new Date(2026,10,1),filter='all',view='list',query='',results=null,activeTitle=null;
let page=location.hash.slice(1)||'upcoming';
const countries={US:'United States',GB:'United Kingdom',LK:'Sri Lanka'};
const services=['Netflix','Prime Video','Apple TV','Disney+','HBO Max','Mubi'];
let token=sessionStorage.getItem('reel-token')||'';
async function api(path,method='GET',body){
 const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const d=await r.json();if(!r.ok){if(r.status===401&&!path.startsWith('auth/')){currentUser=null;showAuth(false);}throw Error(d.error||'Request failed');}return d;
}

function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').style.display='none',3800);}
async function load(){state=await api('state');$('#market').value=state.settings.market;$('#follow-count').textContent=new Set(state.subscriptions.map(s=>s.titleId)).size;$('#notification-dot').hidden=!state.notifications.some(n=>!n.read);render();}
const market=()=>state.settings.market;
const followed=(id,medium)=>state.subscriptions.find(s=>s.titleId===id&&s.market===market()&&(!medium||s.medium===medium));
const dateLabel=e=>!e.date?'Date to be announced':e.precision==='year'?e.date.slice(0,4):e.precision==='quarter'?`Q${Math.ceil(Number(e.date.slice(5,7))/3)} ${e.date.slice(0,4)}`:new Intl.DateTimeFormat('en-US',{month:'short',...(e.precision==='day'?{day:'numeric'}:{year:'numeric'}),timeZone:'UTC'}).format(new Date(e.date+'T12:00Z'));
function poster(t){return `<button class="poster" data-title="${esc(t.id)}" aria-label="View ${esc(t.name)}" ${t.demo?`style="--ink:${esc(t.ink)};--poster-bg:${esc(t.bg)}"`:''}>${t.poster?`<img src="${esc(t.poster)}" alt="${esc(t.name)} poster" loading="lazy">`:`<span class="poster-art">${esc(t.art||t.name)}</span><span class="poster-credit">${esc(t.credit)}</span>`}<span class="poster-tag">${t.mediaType==='tv'?'TV SERIES':'MOVIE'}${t.demo?' · SAMPLE':''}</span></button>`;}
function card(t,e){return `<article class="card">${poster(t)}<div class="card-info"><div><button class="text-button card-name" data-title="${esc(t.id)}">${esc(t.name)}</button><div class="card-meta">${esc(t.year||'TBA')} &nbsp;·&nbsp; ${esc(t.genre||t.mediaType)}</div></div><button class="follow-btn ${followed(t.id)?'on':''}" data-follow="${esc(t.id)}" aria-label="Follow options for ${esc(t.name)}">${followed(t.id)?'♥':'+'}</button></div><div class="event-info"><span class="dot"></span>${e?`${esc(dateLabel(e))} &nbsp;·&nbsp; ${esc(e.service|| (e.medium==='theatrical'?'In cinemas':'Streaming · service TBA'))}`:'Release date not yet sourced'}</div></article>`;}
function heading(title,sub,extra=''){return `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div>${extra}</div>`;}
function render(){
 page=['upcoming','search','following','settings'].includes(page)?page:'upcoming';document.querySelectorAll('[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===page));
 if(!$('.settings-link')){$('nav').insertAdjacentHTML('beforeend','<a href="#settings" data-page="settings" class="settings-link" aria-label="Settings"><span>⚙</span></a>');$('.settings-link').style.display='none';}
 const c=$('#content');
 if(page==='settings'){renderSettings();renderAccount();return;}
 let html='';
 if(page==='upcoming'){
 html+=heading('Upcoming releases.','Theatrical and streaming premieres, in one place.');
 html+=`<div class="sample"><div><b>Preview data</b> · Dates and services are illustrative.</div><a href="#settings">Connect sources ↗</a></div>`;
 html+=`<div class="toolbar"><div class="month-nav"><button data-month="-1" aria-label="Previous month">‹</button><h2>${month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><button data-month="1" aria-label="Next month">›</button></div><div class="filters">${[['all','All releases'],['theatrical','In cinemas'],['streaming','Streaming'],['following','Following']].map(([v,l])=>`<button data-filter="${v}" class="${filter===v?'active':''}">${l}</button>`).join('')}</div><div class="view-toggle"><button data-view="grid" class="${view==='grid'?'active':''}" aria-label="Poster view">▦</button><button data-view="list" class="${view==='list'?'active':''}" aria-label="List view">☷</button></div></div>`;
 const prefix=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`;
 const events=state.releases.filter(e=>e.market===market()&&e.date?.startsWith(prefix)&&['day','month'].includes(e.precision)&&!['cancelled','postponed'].includes(e.status)&&(filter==='all'||filter==='following'&&followed(e.titleId)||e.medium===filter)).sort((a,b)=>a.date.localeCompare(b.date));
 if(!events.length)html+=empty('No releases yet.',`No sourced ${filter==='all'?'':filter+' '}releases for this month in ${countries[market()]}. Try another month or add a verified date.`, '<a href="#search" class="primary">Find a title ↗</a>');
 const groups=Object.groupBy(events,e=>e.precision==='month'?'month':e.date);
 html+=`<div class="${view==='list'?'list':''}">`;
 for(const [date,evs] of Object.entries(groups)){html+=`<div class="section-line"><h3>${date==='month'?'Sometime this month':new Date(date+'T12:00Z').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'})}</h3><span>${evs.length} ${evs.length===1?'release':'releases'}</span></div><div class="cards">${evs.map(e=>{const t=state.titles.find(t=>t.id===e.titleId);return t?card(t,e):'';}).join('')}</div>`;}
 html+='</div>';
 const unknown=state.releases.filter(e=>e.market===market()&&['unknown','year','quarter'].includes(e.precision));
 if(unknown.length)html+=`<div class="uncertain"><div><h3>Dates to be announced</h3><p>${unknown.length} releases have a broader window or no date. Follow them to hear when a date is added.</p></div><button data-unknown>Explore the horizon &nbsp; →</button></div>`;
 }else if(page==='search'){
 html+=heading('Find a title.','Search movies and series, then choose which releases to follow.');
 html+=`<form id="search-form"><input class="search-input" type="search" id="query" aria-label="Search movies and TV" placeholder="Search movies & TV series…" value="${esc(query)}"><button class="primary" type="submit">Search titles &nbsp; ↗</button></form><p class="fineprint">${state.sources.tmdb?'Searching the TMDB catalogue.':'Sample catalogue only. Connect TMDB for live search.'}</p>`;
 const titles=results??state.titles;html+=`<div class="section-line"><h3>${results?'SEARCH RESULTS':'A LITTLE INSPIRATION'}</h3><span>${titles.length} titles</span></div><div class="cards">${titles.map(t=>card(t,state.releases.find(e=>e.titleId===t.id&&e.market===market()))).join('')}</div>`;if(!titles.length)html+=empty('No titles found.','Try a different title or connect TMDB for the full catalogue.');
 }else{
 const ids=new Set(state.subscriptions.filter(s=>s.market===market()).map(s=>s.titleId));html+=heading('Following.',`Your followed releases in ${countries[market()]}. Dates may be unknown; you can follow anyway.`);
 html+=`<div class="cards">${state.titles.filter(t=>ids.has(t.id)).map(t=>card(t,state.releases.find(e=>e.titleId===t.id&&e.market===market()))).join('')}</div>`;
 if(!ids.size)html+=empty('Nothing followed yet.','Follow a theatrical release or a streaming premiere. We’ll keep your preferences even before a date is announced.','<a href="#search" class="primary">Discover something great ↗</a>');
 }
 c.innerHTML=html;
 c.querySelectorAll('[data-title],[data-follow]').forEach(b=>b.onclick=()=>openTitle(b.dataset.title||b.dataset.follow));
 c.querySelectorAll('[data-month]').forEach(b=>b.onclick=()=>{month.setMonth(month.getMonth()+Number(b.dataset.month));render();});
 c.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});
 c.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});
 if($('#search-form'))$('#search-form').onsubmit=async e=>{e.preventDefault();query=$('#query').value;try{results=await api('search?q='+encodeURIComponent(query));await load();}catch(err){toast(err.message);}};
 if(c.querySelector('[data-unknown]'))c.querySelector('[data-unknown]').onclick=()=>showHorizon();
}
function empty(title,body,button=''){return `<div class="empty"><h2>${title}</h2><p>${body}</p>${button}</div>`;}
function showHorizon(){const d=$('#inbox');d.innerHTML=`<div class="dialog-top"><h2>On the horizon</h2><button data-close aria-label="Close">×</button></div>${state.releases.filter(e=>e.market===market()&&['unknown','quarter','year'].includes(e.precision)).map(e=>`<div class="release-row"><button class="text-button" data-title="${esc(e.titleId)}">${esc(state.titles.find(t=>t.id===e.titleId)?.name)} ↗</button><small>${esc(dateLabel(e))} · ${esc(e.service||e.medium)} · ${esc(e.status)}</small></div>`).join('')}`;d.querySelector('[data-close]').onclick=()=>d.close();d.querySelectorAll('[data-title]').forEach(b=>b.onclick=()=>{d.close();openTitle(b.dataset.title);});d.showModal();}
const bellIcon=`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>`;
const defaultRules=['announced','changed','day','release'];
function channelSubscriptions(id,medium,service){return state.subscriptions.filter(s=>s.titleId===id&&s.market===market()&&s.medium===medium&&(service?s.services.includes(service):!s.services.length));}
async function toggleChannel(id,medium,service){
 const selected=channelSubscriptions(id,medium,service);
 if(selected.length){
  for(const s of selected){
   const rest=service?s.services.filter(x=>x!==service):[];
   if(rest.length)await api('subscriptions','POST',{...s,services:rest});
   else await api('subscriptions/'+encodeURIComponent(s.id),'DELETE');
  }
 }else{
  const rules=state.subscriptions.find(s=>s.titleId===id&&s.market===market())?.rules||defaultRules;
  await api('subscriptions','POST',{titleId:id,market:market(),medium,services:service?[service]:[],rules,scope:'channel'});
 }
 await load();await openTitle(id,false);
 toast(selected.length?'Channel notifications turned off':'Channel notifications turned on');
}
async function openTitle(id,hydrate=true){
 if(hydrate&&!id.includes('-season-')){try{const fresh=await api('titles/'+encodeURIComponent(id));const idx=state.titles.findIndex(t=>t.id===id);if(idx>=0)state.titles[idx]=fresh;else state.titles.push(fresh);}catch(err){toast('Showing cached details. '+err.message);}}
 activeTitle=id;const t=state.titles.find(t=>t.id===id);if(!t)return;
 const d=$('#detail');const evs=state.releases.filter(e=>e.titleId===id&&e.market===market());
 const channelRow=(medium,service,events,label)=>{
  const on=channelSubscriptions(id,medium,service).length>0;
  const dates=events.length?events.map(e=>`<div class="channel-date"><span class="${!e.date?'date-tba':''}">${esc(e.date?dateLabel(e):'Date TBA')}</span>${['estimated','postponed','cancelled','first_observed'].includes(e.status)&&e.date?`<small class="date-status ${e.status==='estimated'?'estimated':''}">${esc(e.status.replace('_',' '))}</small>`:''}</div>`).join(''):'<span class="date-tba">Date TBA</span>';
  return `<div class="channel-row"><span class="channel-monogram" aria-hidden="true">${medium==='theatrical'?'▤':service?esc(service.slice(0,1)):'◎'}</span><span class="channel-name">${esc(label||service||'In cinemas')}</span><div class="channel-dates">${dates}</div><button class="channel-toggle ${on?'is-on':''}" data-channel-medium="${medium}" data-channel-service="${esc(service||'')}" aria-pressed="${on}" aria-label="Notifications for ${esc(label||service||'In cinemas')}">${bellIcon}<span>${on?'Following':'Notify me'}</span></button></div>`;
 };
 const knownServices=[...new Set(evs.filter(e=>e.medium==='streaming'&&e.service).map(e=>e.service))];
 // Include followed channels even when they have no sourced release date yet.
 const followedServices=state.subscriptions.filter(s=>s.titleId===id&&s.market===market()&&s.medium==='streaming').flatMap(s=>s.services);
 const shownServices=[...new Set([...knownServices,...followedServices])];
 const otherServices=services.filter(s=>!shownServices.includes(s));
 const rules=state.subscriptions.find(s=>s.titleId===id&&s.market===market())?.rules||defaultRules;
 const tags=[t.mediaType==='tv'?'TV series':'Movie',t.year,...(t.genre||'').split(' · ')].filter(Boolean);
 const posterHTML=poster(t).replace('<button class="poster"','<div class="poster"').replace('</button>','</div>');
 d.className='title-dialog';
 d.innerHTML=`<button class="detail-close" data-close aria-label="Close details">×</button><section class="title-overview"><div class="detail-poster">${posterHTML}</div><div class="title-copy">${t.demo?'<span class="sample-label">Sample title & dates</span>':''}<h2>${esc(t.name)}</h2><div class="title-tags">${tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div><p class="title-description">${esc(t.synopsis||'No description available yet.')}</p>${t.credit?`<span class="title-credit">${esc(t.credit)}</span>`:''}${t.seasons?.length?`<label class="sr-only" for="season-number">Season</label><select id="season-number"><option value="">Choose a season</option>${t.seasons.map(s=>`<option value="${s.number}">${esc(s.name)}</option>`).join('')}</select>`:''}</div></section><section class="release-channels"><div class="channels-heading"><h3>Release dates</h3><span>${esc(market())} · ${esc(countries[market()])}</span></div>${t.mediaType!=='tv'||evs.some(e=>e.medium==='theatrical')?channelRow('theatrical',null,evs.filter(e=>e.medium==='theatrical')):''}${shownServices.map(service=>channelRow('streaming',service,evs.filter(e=>e.medium==='streaming'&&e.service===service))).join('')}${channelRow('streaming',null,evs.filter(e=>e.medium==='streaming'&&!e.service),'Any streaming service')}${otherServices.length?`<details class="other-channels"><summary>Track a specific streaming channel <span>+ ${otherServices.length}</span></summary>${otherServices.map(service=>channelRow('streaming',service,[])).join('')}</details>`:''}<p class="channel-hint">Tap the bell to follow a channel, even before a date is announced.</p></section><div class="detail-secondary"><details class="reminder-options"><summary>Notification preferences</summary><form id="reminder-form"><div class="reminder-checks">${[['announced','Date announced'],['changed','Date changed'],['week','7 days before'],['day','1 day before'],['release','Release day']].map(([v,l])=>`<label><input type="checkbox" name="rule" value="${v}" ${rules.includes(v)?'checked':''}> ${l}</label>`).join('')}</div><button class="primary" type="submit">Save preferences</button></form><small>Delivered to your in-app inbox. Email and push are not connected.</small></details><details class="release-sources"><summary>Sources & date corrections</summary>${evs.map(e=>`<div class="source-entry"><div><strong>${esc(e.service|| (e.medium==='theatrical'?'In cinemas':'Streaming'))}</strong><small>${esc(e.source)}${e.sourceUrl?` · <a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`:''}</small></div><button data-edit="${esc(e.id)}">Edit</button></div>`).join('')}<button data-add class="text-button">+ Add release date</button></details></div>${t.episodes?.length?`<details class="episode-list"><summary>Episodes <span>${t.episodes.length}</span></summary>${t.episodes.map(e=>`<div class="source-row"><span>${e.number}. ${esc(e.name)}</span><small>${esc(e.originalAirDate||'TBA')}</small></div>`).join('')}<small>Original air dates; local streaming dates may differ.</small></details>`:''}`;
 d.querySelector('[data-close]').onclick=()=>d.close();
 d.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editRelease(b.dataset.edit));d.querySelector('[data-add]').onclick=()=>editRelease(null);
 d.querySelectorAll('[data-channel-medium]').forEach(b=>b.onclick=async()=>{
  b.disabled=true;
  try{await toggleChannel(id,b.dataset.channelMedium,b.dataset.channelService||null);}catch(err){toast(err.message);b.disabled=false;}
 });
 if($('#season-number'))$('#season-number').onchange=async event=>{const n=event.target.value;if(!n)return;try{const season=await api('titles/'+encodeURIComponent(id)+'/seasons/'+n);await load();openTitle(season.id,false);}catch(err){toast(err.message);}};
 $('#reminder-form').onsubmit=async event=>{
  event.preventDefault();const selectedRules=[...d.querySelectorAll('[name=rule]:checked')].map(b=>b.value);
  const subscriptions=state.subscriptions.filter(s=>s.titleId===id&&s.market===market());
  if(!subscriptions.length){toast('Follow a channel first, then customize its notifications.');return;}
  try{for(const s of subscriptions)await api('subscriptions','POST',{...s,rules:selectedRules});await load();toast('Notification preferences saved');}catch(err){toast(err.message);}
 };
 if(!d.open)d.showModal();
}

function editRelease(id){const d=$('#detail');d.className='';const e=state.releases.find(r=>r.id===id)||{titleId:activeTitle,medium:'streaming',service:'',date:'',precision:'unknown',status:'announced',source:'',sourceUrl:''};
 d.innerHTML=`<div class="dialog-top"><h2>${id?'Edit release':'Add release'}</h2><button data-back>Back</button></div><p>Keep the date’s precision and source. Imports will preserve manual corrections.</p><form id="release-form"><div class="split"><div><label for="medium">Category</label><select id="medium"><option value="theatrical">Theatrical</option><option value="streaming">Subscription streaming</option></select></div><div><label for="service">Service (optional)</label><input id="service" value="${esc(e.service||'')}" maxlength="100"></div><div><label for="precision">Precision</label><select id="precision">${['day','month','quarter','year','unknown'].map(x=>`<option>${x}</option>`).join('')}</select></div><div><label for="date">Date / start of period</label><input id="date" type="date" value="${esc(e.date||'')}"></div><div><label for="status">Status</label><select id="status">${['announced','estimated','postponed','cancelled','first_observed'].map(x=>`<option>${x}</option>`).join('')}</select></div></div><label for="source">Source note *</label><input id="source" required value="${esc(e.source)}" maxlength="500"><label for="source-url">Announcement URL</label><input id="source-url" type="url" value="${esc(e.sourceUrl)}"><p class="fineprint">For month, quarter, or year precision, the date is a range anchor, never a release day. No release-day reminder is sent.</p><button class="primary">Save release</button></form>`;
 $('#medium').value=e.medium;$('#precision').value=e.precision;$('#status').value=e.status;const dateState=()=>{$('#date').disabled=$('#precision').value==='unknown';$('#date').required=!$('#date').disabled;};$('#precision').onchange=dateState;dateState();d.querySelector('[data-back]').onclick=()=>openTitle(activeTitle);
 $('#release-form').onsubmit=async event=>{event.preventDefault();try{const medium=$('#medium').value;await api('releases'+(id?'/'+id:''),id?'PATCH':'POST',{titleId:activeTitle,market:market(),medium,service:medium==='streaming'?$('#service').value||null:null,offer:medium==='streaming'?'subscription':'ticket',date:$('#date').value||null,precision:$('#precision').value,status:$('#status').value,source:$('#source').value,sourceUrl:$('#source-url').value});await load();openTitle(activeTitle);toast('Release saved with source history');}catch(err){toast(err.message);}};
}
function renderSettings(){const s=state.settings;$('#content').innerHTML=heading('Settings.','Choose your release market and reminder preferences.')+`<div class="settings-grid"><div><form id="settings-form"><fieldset><legend>Release preferences</legend><label for="pref-market">Release market</label><select id="pref-market">${Object.entries(countries).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><p>Market selection never falls back to another country. Sri Lankan release coverage requires your own local sources.</p><label for="timezone">Reminder timezone</label><select id="timezone">${['Asia/Colombo','UTC','America/New_York','Europe/London','Asia/Kolkata'].map(x=>`<option>${x}</option>`).join('')}${!['Asia/Colombo','UTC','America/New_York','Europe/London','Asia/Kolkata'].includes(s.timezone)?`<option>${esc(s.timezone)}</option>`:''}</select><label for="hour">Reminder hour (24-hour)</label><input id="hour" type="number" min="0" max="23" value="${s.hour}" required><p>Date-only releases stay on the market calendar day. Reminder checks use this timezone.</p><button class="primary">Save preferences</button></fieldset></form><fieldset><legend>Notifications</legend><p>In-app inbox and a durable, deduplicated outbox are enabled. The server checks every minute while running.</p><p>Email, phone push, and weekly digests are not connected yet. This preview does not promise offline delivery.</p><button id="open-inbox">Open notification inbox →</button></fieldset></div><div><fieldset><legend>Data connections</legend><div class="source-row"><span>TMDB · catalogue & theatrical dates</span><span class="badge ${state.sources.tmdb?'':'off'}">${state.sources.tmdb?'Configured':'Not connected'}</span></div><div class="source-row"><span>Streaming premiere feed</span><span class="badge off">Not connected</span></div><div class="source-row"><span>Manual announcements</span><span class="badge">Ready</span></div><p>Set TMDB_TOKEN on the server and restart to enable live search and theatrical imports. Credentials never go in the browser.</p><p>Streaming dates can be added in a title’s details, with a source. Provider-feed integration remains to be built.</p><button id="import-tmdb" ${state.sources.tmdb?'':'disabled'}>Import theatrical dates · ${month.toLocaleDateString('en-US',{month:'short',year:'numeric'})}</button>${state.health.map(h=>`<p>${esc(h.id)} · ${esc(h.state)} · ${esc(h.note)}<small>${esc(h.updatedAt)}</small></p>`).join('')}<p class="fineprint">Live catalogue metadata and images: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. Official logo attribution must be added before public launch.</p></fieldset><fieldset><legend>About this build</legend><p>Lineup is a personal release radar for theatrical and subscription streaming premieres. Sample titles, dates, and service associations are clearly marked and are not verified.</p><p>Follows, settings, release history, and notifications are stored in a local SQLite database. Back up the data directory.</p></fieldset></div></div>`;
 $('#pref-market').value=s.market;$('#timezone').value=s.timezone;
 $('#settings-form').onsubmit=async e=>{e.preventDefault();try{await api('settings','PATCH',{market:$('#pref-market').value,timezone:$('#timezone').value,hour:Number($('#hour').value)});await load();toast('Preferences saved');}catch(err){toast(err.message);}};
 $('#open-inbox').onclick=openInbox;$('#import-tmdb').onclick=async()=>{const b=$('#import-tmdb');b.disabled=true;b.textContent='Importing regional dates…';try{const r=await api('import','POST',{market:market(),from:`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-01`});await load();toast(`Imported ${r.count} regional release events`);}catch(err){await load();toast(err.message);}};
}
async function openInbox(){try{await load();const d=$('#inbox');d.innerHTML=`<div class="dialog-top"><h2>Your release radar</h2><button data-close aria-label="Close inbox">×</button></div><p>Scheduled reminders say a release is scheduled, not verified available.</p>${state.notifications.length?state.notifications.slice().reverse().map(n=>`<div class="notify-item"><strong>${esc(state.titles.find(t=>t.id===n.titleId)?.name||'Release update')}</strong><small>${esc({announced:'A date has been added',changed:'Release details changed',week:'Scheduled in 7 days',day:'Scheduled tomorrow',release:'Scheduled for today'}[n.kind]||n.kind)} · ${esc(n.date||'TBA')} · ${esc(n.service||n.medium)}</small></div>`).join(''):empty('Quiet for now.','Follow a release to receive date announcements, changes, and scheduled reminders here.')}`;d.querySelector('[data-close]').onclick=()=>d.close();if(!d.open)d.showModal();await api('notifications/read','POST',{});$('#notification-dot').hidden=true;}catch(err){toast(err.message);}}
$('#notifications').onclick=openInbox;
$('#market').onchange=async e=>{try{await api('settings','PATCH',{...state.settings,market:e.target.value});results=null;await load();}catch(err){toast(err.message);}};
window.addEventListener('hashchange',()=>{page=location.hash.slice(1);render();window.scrollTo(0,0);});
let currentUser=null;
function showAuth(setup=false,setupKeyRequired=false){
 document.querySelectorAll('dialog[open]').forEach(d=>d.close());
 $('.shell').hidden=true;const screen=$('#auth-screen');screen.hidden=false;
 screen.innerHTML=`<div class="auth-card"><a href="#" class="brand"><span class="brand-icon">L</span> lineup<span class="brand-dot">.</span></a><div class="auth-heading"><h1>${setup?'Your lineup starts here.':'Welcome back.'}</h1><p>${setup?'Create your personal sign-in to keep your follows and release dates together.':'Sign in to your releases, wherever you left off.'}</p></div><form id="auth-form">${setup&&setupKeyRequired?'<label for="setup-key">Setup key</label><input id="setup-key" type="password" autocomplete="off" required placeholder="From your hosting secrets">':''}<label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="username" required placeholder="you@example.com" maxlength="254"><label for="auth-password">Password</label><input id="auth-password" type="password" autocomplete="${setup?'new-password':'current-password'}" ${setup?'minlength="12"':''} maxlength="256" required placeholder="${setup?'At least 12 characters':'Your password'}"><div class="auth-error" id="auth-error" role="alert"></div><button class="primary" type="submit">${setup?'Create my Lineup':'Sign in'} <span aria-hidden="true">→</span></button></form><p class="auth-note">${setup?'One personal account. Your existing library stays with you.':'You’ll stay signed in on this device for 30 days.'}</p><div class="auth-footer">Your next watch, all lined up.</div></div>`;
 $('#auth-form').onsubmit=async event=>{
  event.preventDefault();const button=$('#auth-form button');button.disabled=true;$('#auth-error').textContent='';
  try{const result=await api('auth/'+(setup?'setup':'login'),'POST',{email:$('#auth-email').value,password:$('#auth-password').value,setupKey:$('#setup-key')?.value});currentUser=result.user;await showApp();}
  catch(err){$('#auth-error').textContent=err.message;button.disabled=false;}
 };
}
async function showApp(){
 await load();$('#auth-screen').hidden=true;$('.shell').hidden=false;
 const profile=$('.profile');profile.innerHTML=`<span>${esc((currentUser?.email||'L').slice(0,1).toUpperCase())}</span><div><span class="profile-name">${esc(currentUser?.email||'Personal space')}</span><small>Personal account</small></div>`;
}
async function signOut(){try{await api('auth/logout','POST',{});currentUser=null;state=null;results=null;query='';$('#content').innerHTML='';showAuth(false);}catch(err){toast(err.message);}}
function renderAccount(){
 const grid=$('.settings-grid');if(!grid)return;
 const section=document.createElement('fieldset');section.className='account-settings';section.innerHTML=`<legend>Your account</legend><div class="account-summary"><div><strong>${esc(currentUser?.email||'Personal account')}</strong><small>Follows, settings, and dates saved on this server.</small></div><button id="sign-out" type="button">Sign out</button></div><details><summary>Change password</summary><form id="password-form"><label for="current-password">Current password</label><input id="current-password" type="password" autocomplete="current-password" required maxlength="256"><label for="new-password">New password</label><input id="new-password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required><p class="fineprint">Changing your password signs out your other devices.</p><button type="submit" class="primary">Update password</button></form></details>`;
 grid.firstElementChild.prepend(section);$('#sign-out').onclick=signOut;
 $('#password-form').onsubmit=async event=>{event.preventDefault();const button=$('#password-form button');button.disabled=true;try{await api('auth/password','POST',{currentPassword:$('#current-password').value,password:$('#new-password').value});$('#password-form').reset();toast('Password updated. Other devices have been signed out.');}catch(err){toast(err.message);}finally{button.disabled=false;}};
}
async function init(){try{const status=await api('auth/status');if(status.authenticated){currentUser=status.user;await showApp();}else showAuth(status.setupRequired,status.setupKeyRequired);}catch(err){$('#auth-screen').innerHTML=`<div class="auth-card"><h1>Unable to connect.</h1><p>${esc(err.message)}</p><button id="retry-auth">Try again</button></div>`;$('#retry-auth').onclick=init;}}

init();
