// Tiny helpers
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];

const els = {
  trackList: $('#trackList'),
  stationList: $('#stationList'),
  player: $('#player'),
  playBtn: $('#playBtn'),
  prevBtn: $('#prevBtn'),
  nextBtn: $('#nextBtn'),
  shuffleBtn: $('#shuffleBtn'),
  repeatBtn: $('#repeatBtn'),
  vol: $('#vol'),
  fade: $('#fade'),
  seek: $('#seek'),
  cur: $('#cur'),
  dur: $('#dur'),
  nowTitle: $('#nowMeta .title'),
  nowSub: $('#nowMeta .sub'),
  nowLinks: $('#nowMeta .links'),
  officeMode: $('#officeMode'),
  search: $('#search')
};

// Data state
let tracks = [];
let stations = [];
let queue = [];
let idx = -1;
let repeat = false;
let shuffle = false;
let seeking = false;
let fadeSec = 1.0;

// Persisted settings
const savedVol = Number(localStorage.getItem('office.vol') ?? 0.25);
const savedFade = Number(localStorage.getItem('office.fade') ?? 1.0);
const savedOffice = localStorage.getItem('office.mode') !== '0';
els.vol.value = savedVol;
els.player.volume = savedVol;
els.fade.value = savedFade;
fadeSec = savedFade;
els.officeMode.checked = savedOffice;
if(savedOffice) capVolume();

// Boot
Promise.all([
  fetch('data/playlist.json').then(r => r.json()),
  fetch('data/stations.json').then(r => r.json())
]).then(([pl, st]) => {
  // Expect playlist.json to be an array of track objects (template provided)
  tracks = (pl || []).map(t => ({...t, kind:'track'}));
  stations = (st || []).map(s => ({...s, kind:'station'}));
  queue = [...tracks, ...stations];
  renderLists();
}).catch(err => {
  console.error(err);
  els.trackList.innerHTML = `<li>Failed to load playlist.</li>`;
});

// --- Render
function renderLists(filter=''){
  const q = filter.trim().toLowerCase();
  const t = tracks.filter(x =>
    !q || [x.title,x.artist,(x.tags||[]).join(' ')].join(' ').toLowerCase().includes(q)
  );
  const s = stations.filter(x =>
    !q || [x.name,x.genre].join(' ').toLowerCase().includes(q)
  );

  els.trackList.innerHTML = t.map(x => liRow(x)).join('');
  els.stationList.innerHTML = s.map(x => liRow(x)).join('');

  $$('#trackList .playbtn').forEach(btn => btn.addEventListener('click', () => {
    playById(btn.dataset.id);
  }));
  $$('#stationList .playbtn').forEach(btn => btn.addEventListener('click', () => {
    playById(btn.dataset.id);
  }));
}

function liRow(item){
  const isTrack = item.kind === 'track';
  const leftTitle = isTrack ? item.title : item.name;
  const leftSub   = isTrack ? (item.artist || '') : (item.genre || '');
  const badge     = isTrack ? (guessEraFromTags(item.tags) || 'IA') : (guessEraFromName(item.name) || 'Radio');

  return `
    <li>
      <div class="rowL">
        <span class="badge">${badge}</span>
        <div>
          <div class="title" title="${escapeHtml(leftTitle)}">${escapeHtml(leftTitle)}</div>
          <div class="sub">${escapeHtml(leftSub)}</div>
        </div>
      </div>
      <div class="rowR">
        <button class="playbtn" data-id="${item.id}">Play</button>
      </div>
    </li>`;
}

function guessEraFromTags(tags=[]){
  const s = (tags.join(' ') || '').toLowerCase();
  if(s.includes('196') || s.includes('60s')) return '60s';
  if(s.includes('197') || s.includes('70s')) return '70s';
  if(s.includes('198') || s.includes('80s')) return '80s';
  return '';
}

function guessEraFromName(name=''){
  const n = name.toLowerCase();
  if(n.includes('60')) return '60s';
  if(n.includes('70')) return '70s';
  if(n.includes('80')) return '80s';
  return '';
}

// --- Playback controls
function playById(id){
  const i = queue.findIndex(x => x.id === id);
  if(i >= 0){ idx = i; playCurrent(true); }
}

function next(auto=false){
  if(shuffle){
    let n;
    do { n = Math.floor(Math.random()*queue.length); } while (queue.length>1 && n === idx);
    idx = n;
  } else {
    idx = (idx + 1) % queue.length;
    if(!repeat && auto && idx === 0) return; // stop at end if repeat is off
  }
  playCurrent(true);
}

function prev(){
  idx = (idx - 1 + queue.length) % queue.length;
  playCurrent(true);
}

function updateNow(meta){
  const isTrack = meta.kind === 'track';
  const title = isTrack ? meta.title : meta.name;
  const sub   = isTrack ? (meta.artist || '') : (meta.genre || '');
  els.nowTitle.textContent = title || '—';
  els.nowSub.textContent = sub || '—';
  els.nowLinks.innerHTML = '';

  if(isTrack && meta.archive && meta.archive.page){
    const a = document.createElement('a');
    a.href = meta.archive.page; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Open on Internet Archive';
    els.nowLinks.appendChild(a);
  }
  if(!isTrack && meta.site){
    const a = document.createElement('a');
    a.href = meta.site; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Station Site';
    els.nowLinks.appendChild(a);
  }

  if('mediaSession' in navigator){
    try{
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: isTrack ? (meta.artist||'') : meta.name,
        album: isTrack && meta.archive ? (meta.archive.identifier||'') : (meta.genre||''),
        artwork: []
      });
      navigator.mediaSession.setActionHandler('previoustrack', prev);
      navigator.mediaSession.setActionHandler('nexttrack', next);
      navigator.mediaSession.setActionHandler('play', () => togglePlay(true));
      navigator.mediaSession.setActionHandler('pause', () => togglePlay(false));
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if(Number.isFinite(d.seekTime)){ els.player.currentTime = d.seekTime; }
      });
    }catch(_){}
  }
}

async function playCurrent(startFresh=false){
  const meta = queue[idx];
  if(!meta) return;
  updateNow(meta);

  const src = meta.src;
  const player = els.player;

  if(startFresh){
    await crossfadeTo(src);
  } else {
    if(player.src !== src){ player.src = src; }
    player.play();
  }

  els.playBtn.textContent = '⏸';
}

function togglePlay(force){
  const p = els.player;
  if(force === true || p.paused){ p.play(); els.playBtn.textContent = '⏸'; }
  else if(force === false || !p.paused){ p.pause(); els.playBtn.textContent = '▶️'; }
}

async function crossfadeTo(nextSrc){
  const p = els.player;
  const fromVol = p.volume;
  const fade = fadeSec;

  if(!p.paused){
    const steps = 12;
    for(let i=steps;i>=0;i--){
      p.volume = Math.max(0, fromVol * (i/steps));
      await sleep(fade*1000/steps);
    }
  }
  p.src = nextSrc;
  try{ await p.play(); }catch(_){}
  const target = Number(els.vol.value);
  const steps = 12;
  for(let i=0;i<=steps;i++){
    p.volume = target * (i/steps);
    await sleep(fade*1000/steps);
  }
}

// --- UI wiring
els.playBtn.addEventListener('click', () => togglePlay());
els.prevBtn.addEventListener('click', prev);
els.nextBtn.addEventListener('click', () => next(false));
els.shuffleBtn.addEventListener('click', () => {
  shuffle = !shuffle;
  els.shuffleBtn.style.borderColor = shuffle ? '#47a3ff' : '#263647';
});
els.repeatBtn.addEventListener('click', () => {
  repeat = !repeat;
  els.repeatBtn.style.borderColor = repeat ? '#47a3ff' : '#263647';
});

els.vol.addEventListener('input', () => {
  capVolume();
  els.player.volume = Number(els.vol.value);
  localStorage.setItem('office.vol', String(els.vol.value));
});
els.fade.addEventListener('input', () => {
  fadeSec = Number(els.fade.value);
  localStorage.setItem('office.fade', String(fadeSec));
});
els.officeMode.addEventListener('change', () => {
  localStorage.setItem('office.mode', els.officeMode.checked ? '1' : '0');
  capVolume();
});

els.player.addEventListener('ended', () => next(true));
els.player.addEventListener('timeupdate', () => {
  if(seeking) return;
  const cur = els.player.currentTime || 0;
  const dur = isFinite(els.player.duration) ? els.player.duration : 0;
  els.cur.textContent = fmtTime(cur);
  els.dur.textContent = dur ? fmtTime(dur) : '—';
  if(dur){ els.seek.value = (cur/dur*100).toFixed(2); }
});
els.seek.addEventListener('input', () => { seeking = true; });
els.seek.addEventListener('change', () => {
  const dur = els.player.duration || 0;
  if(dur){ els.player.currentTime = dur * (Number(els.seek.value)/100); }
  seeking = false;
});

els.search.addEventListener('input', (e) => renderLists(e.target.value));

// --- utils
function fmtTime(s){
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s/60);
  const ss = (s%60).toString().padStart(2,'0');
  return `${m}:${ss}`;
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function capVolume(){
  // Office Mode caps volume to 0.35
  if(els.officeMode.checked && Number(els.vol.value) > 0.35){
    els.vol.value = 0.35;
    els.player.volume = 0.35;
  }
}
