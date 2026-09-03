// ---------- CONFIG ----------
const DEFAULT_LAT = 22.5726;
const DEFAULT_LNG = 88.3639;
const CATEGORY_LABELS = { iconic:'Iconic', south:'South Kolkata', north:'North Kolkata', saltlake:'Salt Lake', bonedibari:'Bonedi Bari', all:'All Pandals' };
const EMERGENCY_CONTACTS = [
  { name:'Dial 100 (Police)', number:'100' },
  { name:'Fire Service', number:'101' },
  { name:'Women Helpline', number:'1091' },
  { name:'Child Helpline', number:'1098' },
  { name:'Cyber Crime', number:'1930' },
  { name:'Emergency Response Support', number:'112' }
];

// Target your specific HTML container
const container = document.getElementById('emergency-list'); 
if (container) {
  container.innerHTML = EMERGENCY_CONTACTS.map(contact => `
    <div class="emergency-row">
      <span class="emergency-name">${contact.name}</span>
      <a href="tel:${contact.number}" class="emergency-call-btn">
        <span>📞</span> ${contact.number}
      </a>
    </div>
  `).join('');
}




// ---------- STATE ----------
let DATA = { iconic:[], south:[], north:[], saltlake:[], bonedibari:[], all:[], metro:[], toilet:[] };
let userLat = DEFAULT_LAT, userLng = DEFAULT_LNG;
let locationStatus = 'loading';
let activeCategory = 'iconic';
let metroOn = false, toiletOn = false;
let leafletMap = null, userMarker = null, routingControl = null;
let clusterGroups = { pandal:null, metro:null, toilet:null };
let currentSheetItem = null, currentSheetType = null;
let activeCategoryNearest = null, metroOnNearest = false, toiletOnNearest = false;
let expandedOtherNearest = null;
let activeSubTab = 'visited';
let dashboardExpanded = false;
let dashboardCategory = 'iconic';
let dashboardVisibleCount = 10;

// ---------- HELPERS ----------
function esc(str){ return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function haversine(lat1,lng1,lat2,lng2){
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.asin(Math.sqrt(a));
}
function openMaps(lat,lng,mode){ window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${mode}`, '_blank'); }
function nearestMetroInfo(lat,lng){
  if (!DATA.metro.length) return null;
  let best=null, bestDist=Infinity;
  DATA.metro.forEach(m=>{ const d=haversine(lat,lng,m.lat,m.lng); if(d<bestDist){ bestDist=d; best=m; } });
  return best ? { name:best.name, dist:bestDist } : null;
}

// ---------- CSV LOADING ----------
function parseCSVGeneric(text, fields){
  return text.trim().split('\n').map(r=>r.trim()).filter(r=>r.length).slice(1).map((row,i)=>{
    const cols = row.split(',').map(c=>c.trim());
    const obj = { id:i+1 };
    fields.forEach((f,idx)=> obj[f]=cols[idx] ?? '');
    obj.lat = parseFloat(obj.lat); obj.lng = parseFloat(obj.lng);
    return obj;
  }).filter(o=>!isNaN(o.lat) && !isNaN(o.lng) && o.name);
}
async function loadCSV(key, filename, fields){
  try {
    const res = await fetch(filename);
    if (!res.ok) throw new Error('missing');
    DATA[key] = parseCSVGeneric(await res.text(), fields);
  } catch(e) { DATA[key] = []; }
}
async function loadAllData(){
  await Promise.all([
    loadCSV('iconic','Final Iconics.csv',['name','lat','lng']),
    loadCSV('south','Final South Kolkata.csv',['name','lat','lng']),
    loadCSV('north','final nortcentral.csv',['name','lat','lng']),
    loadCSV('saltlake','FinalSaltLake&dumdum.csv',['name','lat','lng']),
    loadCSV('bonedibari','Kolkata Bonedi Bari Map.csv',['name','lat','lng']),
    loadCSV('all','finalover.csv',['name','lat','lng']),
    loadCSV('metro','AllMetro.csv',['name','lat','lng','type']),
    loadCSV('toilet','Pay & Use.csv',['name','type','lat','lng'])
  ]);
}

function getMasterPandalList(){ return DATA.all; }
function getActiveList(){ return DATA[activeCategory] || []; }

// ---------- VISITED / FAVORITE (linked by name, persisted, no auto side-effects) ----------
function getVisitedNames(){ try{ return JSON.parse(localStorage.getItem('dpg_visited')||'[]'); } catch { return []; } }
function setVisitedNames(a){ try{ localStorage.setItem('dpg_visited', JSON.stringify(a)); } catch {} }
function isVisited(name){ return getVisitedNames().includes(name); }
function toggleVisited(name){
  let v = getVisitedNames();
  v = v.includes(name) ? v.filter(n=>n!==name) : [...v, name];
  setVisitedNames(v);
}
function getFavNames(){ try{ return JSON.parse(localStorage.getItem('dpg_favs')||'[]'); } catch { return []; } }
function setFavNames(a){ try{ localStorage.setItem('dpg_favs', JSON.stringify(a)); } catch {} }
function isFav(name){ return getFavNames().includes(name); }
function toggleFav(name){
  let f = getFavNames();
  f = f.includes(name) ? f.filter(n=>n!==name) : [...f, name];
  setFavNames(f);
}

// ---------- DATA MANAGEMENT: download / clear ----------
function downloadMyList(){
  const data = { saved: getFavNames(), visited: getVisitedNames() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'my-durga-puja-list.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function clearAllData(){
  showConfirmModal('🗑️ Clear All Data', 'This will permanently clear all your Saved and Visited pandals. This cannot be undone.', 'Yes, Clear All', ()=>{
    setFavNames([]); setVisitedNames([]);
    renderDashboard(); renderProfileList(); renderNearestTab();
    if (currentSheetItem) renderSheetContent();
  });
}

// ---------- DASHBOARD (collapsible on Profile tab) ----------
function renderDashboard(){
  const list = dashboardCategory === 'all' ? getMasterPandalList() : (DATA[dashboardCategory] || []);
  const total = list.length;
  const listNames = new Set(list.map(p=>p.name));
  const visitedCount = getVisitedNames().filter(n=>listNames.has(n)).length;
  const favCount = getFavNames().filter(n=>listNames.has(n)).length;
  document.getElementById('d-visited').textContent = visitedCount;
  document.getElementById('d-favs').textContent = favCount;
  document.getElementById('d-remaining').textContent = total - visitedCount;
  const pct = total ? Math.round(visitedCount/total*100) : 0;
  document.getElementById('d-pct').textContent = pct + '%';
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `${visitedCount} of ${total} visited`;
  document.getElementById('dashboard-summary-text').textContent = `${visitedCount} of ${total} visited · ${pct}%`;
}
function updateDashboardCategoryUI(){
  document.getElementById('dashboard-cat-toggle-btn').textContent = CATEGORY_LABELS[dashboardCategory] + ' ▾';
}
function toggleDashboard(){
  dashboardExpanded = !dashboardExpanded;
  document.getElementById('dashboard-expanded').style.display = dashboardExpanded ? 'block':'none';
  document.getElementById('visited-tracker-section').style.display = dashboardExpanded ? 'block':'none';
  document.getElementById('dashboard-toggle').classList.toggle('open', dashboardExpanded);
  if (dashboardExpanded) renderProfileList();
}

// ---------- INFO MODAL (drives the #info-modal markup already in index.html) ----------
// The modal markup currently sits inside the Profile tab's container, which is
// display:none until that tab is opened — so we detach it to the very end of
// <body> at startup. From then on its own display property is the only thing
// controlling visibility, no matter which tab is active.
function relocateInfoModal(){
  const modal = document.getElementById('info-modal');
  if (modal) document.body.appendChild(modal);
}
function showInfoModal(title, message){
  document.getElementById('modal-title-content').textContent = title;
  document.getElementById('modal-text-content').innerHTML = message;
  const footer = document.querySelector('#info-modal .modal-footer');
  footer.innerHTML = `<button class="modal-ok-btn" id="modal-close-btn">Got it</button>`;
  document.getElementById('modal-close-btn').addEventListener('click', closeInfoModal);
  document.getElementById('info-modal').style.display = 'flex';
}
function showConfirmModal(title, message, confirmLabel, onConfirm){
  document.getElementById('modal-title-content').textContent = title;
  document.getElementById('modal-text-content').textContent = message;
  const footer = document.querySelector('#info-modal .modal-footer');
  footer.innerHTML = `
    <button class="modal-cancel-btn" id="modal-cancel-btn">Cancel</button>
    <button class="modal-ok-btn danger" id="modal-confirm-btn">${esc(confirmLabel)}</button>
  `;
  document.getElementById('modal-cancel-btn').addEventListener('click', closeInfoModal);
  document.getElementById('modal-confirm-btn').addEventListener('click', ()=>{
    closeInfoModal();
    onConfirm();
  });
  document.getElementById('info-modal').style.display = 'flex';
}
function closeInfoModal(){
  document.getElementById('info-modal').style.display = 'none';
}

// ---------- EMERGENCY HELPLINE (tel: links open the phone dialer directly) ----------
function renderEmergencyContacts(){
  const cont = document.getElementById('emergency-list');
  cont.innerHTML = EMERGENCY_CONTACTS.map(c => `
    <div class="emergency-row">
      <span class="emergency-name">${esc(c.name)}</span>
      <a href="tel:${c.number}" class="emergency-call-btn" title="Call ${esc(c.name)}">📞 ${esc(c.number)}</a>
    </div>`).join('');
}
function toggleCollapsibleSection(contentId, btnId){
  const content = document.getElementById(contentId);
  const btn = document.getElementById(btnId);
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : '';
  btn.classList.toggle('open', !isOpen);
}

// ---------- BUY US A CHAI (copy UPI id, briefly shows a checkmark) ----------
async function copyUpiId(){
  const upiId = document.getElementById('upi-id-text').textContent.trim();
  const btn = document.getElementById('upi-copy-btn');
  try {
    await navigator.clipboard.writeText(upiId);
    btn.textContent = '✅ Copied';
    btn.classList.add('copied');
  } catch (e) {
    alert('Could not copy automatically — please copy this UPI ID manually: ' + upiId);
    return;
  }
  setTimeout(()=>{ btn.textContent = '📋 Copy'; btn.classList.remove('copied'); }, 2000);
}

// ---------- SHARE (native share sheet, with clipboard fallback) ----------
async function sharePage(){
  const shareData = {
    title: 'Kolkata Durga Puja Guide',
    text: 'Find the nearest Durga Puja pandals in Kolkata — check out this guide!',
    url: window.location.href
  };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch(e) { /* user cancelled — do nothing */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(shareData.url);
    showInfoModal('📤 Link Copied', "Your browser doesn't support direct sharing, so the page link was copied to your clipboard instead — paste it anywhere to share.");
  } catch(e) {
    showInfoModal('📤 Share This Page', 'Copy this link to share: ' + shareData.url);
  }
}

// ---------- LOCATION (silent periodic refresh vs. tap-to-recenter) ----------
function updateLocationUI(){
  document.getElementById('loc-dot').className = 'dot ' + (locationStatus==='ok' ? '' : locationStatus==='error' ? 'error' : 'loading');
}
function refreshLocation(recenter){
  locationStatus = 'loading'; updateLocationUI();
  const fab = document.getElementById('map-fab');
  if (recenter) fab.classList.add('spin');
  if (navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLat = pos.coords.latitude; userLng = pos.coords.longitude;
        locationStatus = 'ok'; updateLocationUI();
        updateUserMarker();
        drawMapLayers();
        renderDashboard();
        if (recenter && leafletMap) leafletMap.setView([userLat,userLng], leafletMap.getZoom());
        fab.classList.remove('spin');
      },
      () => { locationStatus='error'; updateLocationUI(); fab.classList.remove('spin'); },
      { enableHighAccuracy:true, timeout:8000 }
    );
  } else { locationStatus='error'; updateLocationUI(); fab.classList.remove('spin'); }
}

// ---------- MAP PINS ----------
function pinIcon(type, isTop){
  const cls = type==='pandal' ? (isTop?'pandal-top':'pandal') : type;
  const glyph = type==='pandal' ? '🪔' : type==='metro' ? '🚇' : '🚻';
  return L.divIcon({ html:`<div class="map-pin ${cls}"><span class="pin-icon">${glyph}</span></div>`, iconSize:[26,34], iconAnchor:[13,34], className:'' });
}
function userIcon(){
  return L.divIcon({
    html:`<div class="user-dot"></div>`,
    iconSize:[22,22],
    iconAnchor:[11,11],
    className:''
  });
}
function clusterIconFn(color, textColor){
  return function(cluster){
    const count = cluster.getChildCount();
    return L.divIcon({
      html:`<div style="background:${color};color:${textColor};width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 6px rgba(0,0,0,0.4);">${count}</div>`,
      className:'', iconSize:[36,36]
    });
  };
}

// ---------- MAP INIT / DRAW ----------
function initMap(){
  leafletMap = L.map('map-container-v2', { zoomControl:true }).setView([userLat,userLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap contributors', maxZoom:19 }).addTo(leafletMap);
  // clusterGroups.pandal = L.markerClusterGroup({ maxClusterRadius:50, iconCreateFunction: clusterIconFn('#D4AF37','#3A0810') });
  clusterGroups.pandal = L.markerClusterGroup({ maxClusterRadius:50, iconCreateFunction: clusterIconFn('#4A0E17','#F0D060') });
  clusterGroups.metro = L.markerClusterGroup({ maxClusterRadius:50, iconCreateFunction: clusterIconFn('#2563eb','#ffffff') });
  clusterGroups.toilet = L.markerClusterGroup({ maxClusterRadius:50, iconCreateFunction: clusterIconFn('#0f766e','#ffffff') });
  leafletMap.addLayer(clusterGroups.pandal);
  updateUserMarker();
  drawMapLayers();
}
function updateUserMarker(){
  if (!leafletMap) return;
  if (userMarker) leafletMap.removeLayer(userMarker);
  userMarker = L.marker([userLat,userLng], { icon:userIcon(), zIndexOffset:1000 }).addTo(leafletMap).bindPopup('📍 You are here');
}
function drawMapLayers(){
  if (!leafletMap) return;
  clusterGroups.pandal.clearLayers();
  clusterGroups.metro.clearLayers();
  clusterGroups.toilet.clearLayers();

  const list = getActiveList();
  const withDist = list.map(p=>({...p, dist:haversine(userLat,userLng,p.lat,p.lng)})).sort((a,b)=>a.dist-b.dist);
  const top3Names = new Set(withDist.slice(0,3).map(p=>p.name));

  withDist.forEach(p=>{
    const marker = L.marker([p.lat,p.lng], { icon: pinIcon('pandal', top3Names.has(p.name)) });
    marker.on('click', ()=>openSheet(p,'pandal'));
    clusterGroups.pandal.addLayer(marker);
  });

  if (metroOn){
    DATA.metro.forEach(m=>{
      const marker = L.marker([m.lat,m.lng], { icon: pinIcon('metro') });
      marker.on('click', ()=>openSheet(m,'metro'));
      clusterGroups.metro.addLayer(marker);
    });
    if (!leafletMap.hasLayer(clusterGroups.metro)) leafletMap.addLayer(clusterGroups.metro);
  } else if (leafletMap.hasLayer(clusterGroups.metro)) leafletMap.removeLayer(clusterGroups.metro);

  if (toiletOn){
    DATA.toilet.forEach(t=>{
      const marker = L.marker([t.lat,t.lng], { icon: pinIcon('toilet') });
      marker.on('click', ()=>openSheet(t,'toilet'));
      clusterGroups.toilet.addLayer(marker);
    });
    if (!leafletMap.hasLayer(clusterGroups.toilet)) leafletMap.addLayer(clusterGroups.toilet);
  } else if (leafletMap.hasLayer(clusterGroups.toilet)) leafletMap.removeLayer(clusterGroups.toilet);
}

// ---------- ROUTING (real road route, drawn on our own map) ----------
function showRoute(destLat, destLng){
  clearRoute();
  routingControl = L.Routing.control({
    waypoints: [L.latLng(userLat,userLng), L.latLng(destLat,destLng)],
    routeWhileDragging:false, addWaypoints:false, draggableWaypoints:false,
    show:false,
    lineOptions:{ styles:[{ color:'#2563EB', weight:5, opacity:0.85 }] },
    createMarker:()=>null
  }).addTo(leafletMap);
}
function clearRoute(){ if (routingControl){ leafletMap.removeControl(routingControl); routingControl=null; } }

// ---------- BOTTOM SHEET CARD ----------
function openSheet(item, type){
  currentSheetItem = item; currentSheetType = type;
  renderSheetContent();
  const card = document.getElementById('sheet-card');
  card.classList.remove('peek');
  card.classList.add('open');
}
function togglePeek(){
  const card = document.getElementById('sheet-card');
  if (card.classList.contains('open')){ card.classList.remove('open'); card.classList.add('peek'); }
  else if (card.classList.contains('peek')){ card.classList.remove('peek'); card.classList.add('open'); }
}
function closeSheet(){
  document.getElementById('sheet-card').classList.remove('open','peek');
  clearRoute();
}
function renderSheetContent(){
  const item = currentSheetItem, type = currentSheetType;
  if (!item) return;
  const dist = haversine(userLat,userLng,item.lat,item.lng).toFixed(2);
  let html = `<div class="sheet-name">${esc(item.name)}</div>`;
  if (type === 'pandal'){
    const vis = isVisited(item.name), fav = isFav(item.name);
    const nm = nearestMetroInfo(item.lat, item.lng);
    html += `<div class="sheet-meta">${nm ? `🚇 ${esc(nm.name)} — ${nm.dist.toFixed(1)} km from pandal` : 'No metro data yet'}</div>
      <div class="sheet-meta">${dist} km from you</div>
      <div class="sheet-actions-row1">
        <button class="sheet-btn fav ${fav?'on':''}" id="sheet-fav-btn">${fav?'⭐ Saved':'☆ Save'}</button>
        <button class="sheet-btn visit ${vis?'on':''}" id="sheet-visit-btn">${vis?'✅ Visited':'○ Mark Visited'}</button>
      </div>
      <div class="sheet-actions-row2">
        <button class="sheet-btn route" id="sheet-route-btn">🧭 Navigate</button>
        <button class="sheet-icon-btn" id="sheet-gmap-btn" title="Open in Google Maps">🗺️</button>
      </div>`;
  } else {
    const typeLabel = item.type || (type==='metro' ? 'Metro/Bus' : 'Toilet');
    html += `<div class="sheet-meta">${esc(typeLabel)} · ${dist} km</div>
      <div class="sheet-actions-row2">
        <button class="sheet-btn route" id="sheet-route-btn">🧭 Navigate</button>
        <button class="sheet-icon-btn" id="sheet-gmap-btn" title="Open in Google Maps">🗺️</button>
      </div>`;
  }
  document.getElementById('sheet-body').innerHTML = html;
}

// ---------- SEARCH ----------
function buildSearchIndex(){
  const idx = [];
  ['iconic','south','north','saltlake','bonedibari'].forEach(cat=>{
    DATA[cat].forEach(p=>idx.push({...p, _cat:CATEGORY_LABELS[cat], _kind:'pandal'}));
  });
  DATA.metro.forEach(m=>idx.push({...m, _cat:m.type||'Metro/Bus', _kind:'metro'}));
  DATA.toilet.forEach(t=>idx.push({...t, _cat:t.type||'Toilet', _kind:'toilet'}));
  return idx;
}
function handleSearchGeneric(inputId, resultsId, enableHide){
  const q = document.getElementById(inputId).value.trim().toLowerCase();
  const resultsEl = document.getElementById(resultsId);
  if (!q){ resultsEl.style.display='none'; resultsEl.innerHTML=''; return; }
  const matches = buildSearchIndex().filter(p=>p.name.toLowerCase().includes(q)).slice(0,15);
  resultsEl.innerHTML = matches.length ? matches.map(p=>{
    const showFavVisit = p._kind === 'pandal';
    /* ===== HIDE PANDAL FEATURE: collapsed row in search results ===== */
    if (enableHide && showFavVisit && isHidden(p.name)) {
      return `<div class="sr-hidden-row" data-name="${esc(p.name)}">
        <span class="hidden-pandal-label">🙈 ${esc(p.name)} — Hidden</span>
        <button class="restore-btn" title="Show this pandal">👁️ Show</button>
      </div>`;
    }
    /* ===== END HIDE PANDAL FEATURE in this function ===== */
    const fav = showFavVisit && isFav(p.name), vis = showFavVisit && isVisited(p.name);
    const nm = showFavVisit ? nearestMetroInfo(p.lat, p.lng) : null;
    return `<div class="search-result-row" data-name="${esc(p.name)}" data-lat="${p.lat}" data-lng="${p.lng}" data-kind="${p._kind}">
      <div class="sr-info"><span class="sr-name">${esc(p.name)}</span><span class="sr-cat">${esc(p._cat)}${nm ? ` · 🚇 ${esc(nm.name)} (${nm.dist.toFixed(1)}km)` : ''}</span></div>
      <div class="sr-actions">
        ${showFavVisit ? `<button class="sr-icon-btn fav-btn ${fav?'on':''}">${fav?'⭐':'☆'} Visited</button>
        <button class="sr-icon-btn visit-btn ${vis?'on':''}">${vis?'✅':'○'} Saved </button>` : ''}
        <button class="sr-icon-btn nav-btn" data-mode="walking">🚶<br>Walk </button>
        <button class="sr-icon-btn nav-btn" data-mode="bicycling">🏍 <br>Bike </button>
        ${enableHide && showFavVisit ? `<button class="sr-icon-btn hide-toggle-btn" title="Hide this pandal">👁️<br>Hide </button>` : ''}
      </div>
    </div>`;
  }).join('') : `<div class="search-empty">No matches</div>`;
  resultsEl.style.display = 'block';
}
function handleSearch(){ handleSearchGeneric('search-input-map','search-results-map', false); }
function handleSearchNearest(){ handleSearchGeneric('search-input-nearest','search-results-nearest', true); }
function handleVisitSearch(){
  const q = document.getElementById('search-input-visit').value.trim().toLowerCase();
  const resultsEl = document.getElementById('search-results-visit');
  if (!q){ resultsEl.style.display='none'; resultsEl.innerHTML=''; return; }
  const matches = getMasterPandalList()
    .map(p=>({...p, dist:haversine(userLat,userLng,p.lat,p.lng)}))
    .filter(p=>p.name.toLowerCase().includes(q)).slice(0,15);
  resultsEl.innerHTML = matches.length ? matches.map(p=>{
    const vis = isVisited(p.name);
    return `<div class="search-result-row" data-name="${esc(p.name)}">
      <div class="sr-info"><span class="sr-name">${esc(p.name)}</span><span class="sr-cat">${p.dist.toFixed(1)} km</span></div>
      <div class="sr-actions"><button class="sr-icon-btn mark-visit-btn ${vis?'on':''}">${vis?'✅ Visited':'○ Mark Visited'}</button></div>
    </div>`;
  }).join('') : `<div class="search-empty">No matches</div>`;
  resultsEl.style.display = 'block';
}
function closeAllSearchResults(){
  ['search-results-map','search-results-nearest','search-results-visit'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// ---------- CATEGORY / DROPDOWN UI (Map tab) ----------
function updateCategoryBoxUI(){
  document.querySelectorAll('#category-boxes-map [data-cat]').forEach(b=>b.classList.remove('active'));
  const activeBtn = document.querySelector(`#category-boxes-map [data-cat="${activeCategory}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  const wrap = document.querySelector('#category-boxes-map .cat-box-with-info');
  if (wrap) wrap.classList.toggle('active', activeCategory === 'all');
  const isArea = ['south','north','bonedibari','saltlake'].includes(activeCategory);
  const areaBtn = document.getElementById('area-toggle-btn');
  areaBtn.classList.toggle('active', isArea);
  areaBtn.textContent = isArea ? (CATEGORY_LABELS[activeCategory] + ' ▾') : 'Area ▾';
}
function closeAllDropdowns(){ document.querySelectorAll('.dropdown.open').forEach(d=>d.classList.remove('open')); }

// ---------- NEAREST TAB ----------
function updateCategoryBoxUIN(){
  document.querySelectorAll('#category-boxes-nearest [data-cat]').forEach(b=>b.classList.remove('active'));
  if (activeCategoryNearest){
    const btn = document.querySelector(`#category-boxes-nearest [data-cat="${activeCategoryNearest}"]`);
    if (btn) btn.classList.add('active');
  }
  const wrapN = document.querySelector('#category-boxes-nearest .cat-box-with-info');
  if (wrapN) wrapN.classList.toggle('active', activeCategoryNearest === 'all');
  const isArea = ['south','north','bonedibari','saltlake'].includes(activeCategoryNearest);
  const areaBtn = document.getElementById('area-toggle-btn-n');
  areaBtn.classList.toggle('active', isArea);
  areaBtn.textContent = isArea ? (CATEGORY_LABELS[activeCategoryNearest] + ' ▾') : 'Area ▾';
}
/* ===== HIDE PANDAL FEATURE (Nearest tab only) — delete this whole marked block + the matching CSS block + the matching pieces in renderTop3Cards/renderOthersList/handleSearchGeneric/attachEventListeners to remove entirely ===== */
const HIDE_FEATURE_ENABLED = true; // set to false to instantly disable without deleting anything
function getHiddenNames(){ try{ return JSON.parse(localStorage.getItem('dpg_hidden')||'[]'); } catch { return []; } }
function setHiddenNames(a){ try{ localStorage.setItem('dpg_hidden', JSON.stringify(a)); } catch {} }
function isHidden(name){ return HIDE_FEATURE_ENABLED && getHiddenNames().includes(name); }
function toggleHidden(name){
  let h = getHiddenNames();
  h = h.includes(name) ? h.filter(n=>n!==name) : [...h, name];
  setHiddenNames(h);
}
/* ===== END HIDE PANDAL FEATURE core functions ===== */
function renderNearestTab(){
  const emptyEl = document.getElementById('nearest-empty');
  const top3Label = document.getElementById('top3-label');
  const othersLabel = document.getElementById('others-label');
  if (!activeCategoryNearest){
    emptyEl.style.display = 'block'; top3Label.style.display = 'none'; othersLabel.style.display = 'none';
    document.getElementById('top3-container').innerHTML = '';
    document.getElementById('others-list').innerHTML = '';
  } else {
    emptyEl.style.display = 'none'; top3Label.style.display = 'block'; othersLabel.style.display = 'block';
    const list = DATA[activeCategoryNearest] || [];
    const withDist = list.map(p=>({...p, dist:haversine(userLat,userLng,p.lat,p.lng)})).sort((a,b)=>a.dist-b.dist);
    // Hidden pandals never occupy a Top 3 slot — the next nearest visible one backfills instead.
    const eligibleForTop3 = withDist.filter(p=>!isHidden(p.name));
    const top3 = eligibleForTop3.slice(0,3);
    const top3Names = new Set(top3.map(p=>p.name));
    const others = withDist.filter(p=>!top3Names.has(p.name)); // hidden ones stay in here, at their normal sorted position
    renderTop3Cards(top3);
    renderOthersList(others);
  }
  renderAmenityListN('metro-list-n','metro-section-n', DATA.metro, metroOnNearest);
  renderAmenityListN('toilet-list-n','toilet-section-n', DATA.toilet, toiletOnNearest);
}
function renderTop3Cards(top3){
  const cont = document.getElementById('top3-container');
  if (!top3.length){ cont.innerHTML = `<div class="empty-state" style="padding:16px;">No pandals in this category yet.</div>`; return; }
  const medals=['g','s','b'], ranks=['🥇 First Recommendation','🥈 Alternative Option','🥉 Backup Option'], rankClasses=['rank-1','rank-2','rank-3'];
  cont.innerHTML = top3.map((p,i)=>{
    const walkMin = Math.round(p.dist/4.5*60), bikeMin = Math.round(p.dist/20*60);
    const fav = isFav(p.name), vis = isVisited(p.name);
    const nm = nearestMetroInfo(p.lat, p.lng);
    return `<div class="medal-card ${rankClasses[i]}" data-name="${esc(p.name)}" data-lat="${p.lat}" data-lng="${p.lng}">
      <div style="font-size:10px;color:#6B7280;padding:8px 14px 0;font-weight:600;">${ranks[i]}</div>
      <div class="card-header">
        <div class="medal-badge ${medals[i]}">${['🥇','🥈','🥉'][i]}</div>
        <div class="card-title-block"><div class="card-name">${esc(p.name)}</div></div>
        <span class="metro-badge">${nm ? `🚇 ${esc(nm.name)} · ${nm.dist.toFixed(1)}km` : 'No metro data'}</span>
      </div>
      <div class="card-meta"><span class="meta-dist">📏 ${p.dist.toFixed(2)} km</span><span>🚶 ${walkMin} min</span><span>🏍 ${bikeMin} min</span></div>
      <div class="card-actions">
        <button class="icon-btn fav-btn ${fav?'on':''}">${fav?'⭐ Saved':'☆ Save'}</button>
        <button class="icon-btn visit-btn ${vis?'on':''}">${vis?'✅ Done':'○ Visit'}</button>
        <button class="hide-toggle-btn" title="Hide this pandal">👁️ </button>
      </div>
      <div class="nav-btns">
        <button class="nav-btn walk" data-mode="walking">🚶 Walk</button>
        <button class="nav-btn bike" data-mode="bicycling">🏍 Bike</button>
      </div>
    </div>`;
  }).join('');
}
function renderOthersList(others){
  const cont = document.getElementById('others-list');
  if (!others.length){ cont.innerHTML=''; return; }
  cont.innerHTML = others.map(p=>{
    /* ===== HIDE PANDAL FEATURE: collapsed row instead of the normal card ===== */
    if (isHidden(p.name)) {
      return `<div class="hidden-pandal-row" data-name="${esc(p.name)}">
        <span class="hidden-pandal-label">🙈 ${esc(p.name)} — Hidden</span>
        <button class="restore-btn" title="Show this pandal">👁️ Show</button>
      </div>`;
    }
    /* ===== END HIDE PANDAL FEATURE in this function ===== */
    const fav=isFav(p.name), vis=isVisited(p.name);
    const isExpanded = expandedOtherNearest === p.name;
    const walkMin = Math.round(p.dist/4.5*60), bikeMin = Math.round(p.dist/20*60);
    const nm = nearestMetroInfo(p.lat, p.lng);
    return `<div class="other-item ${isExpanded?'expanded':''}" data-name="${esc(p.name)}" data-lat="${p.lat}" data-lng="${p.lng}">
      <div class="other-item-row">
        <span class="other-name">${esc(p.name)}</span>
        <span class="other-dist">${p.dist.toFixed(1)} km</span>
        <button class="hide-toggle-btn" title="Hide this pandal">👁️</button>
      </div>
      ${isExpanded ? `
      <div class="other-expanded-body">
        <div class="other-meta">${nm ? `🚇 ${esc(nm.name)} · ${nm.dist.toFixed(1)} km from pandal` : 'No metro data yet'}</div>
        <div class="other-meta">🚶 ${walkMin} min · 🏍 ${bikeMin} min</div>
        <div class="other-actions">
          <button class="other-btn fav-btn ${fav?'on':''}">${fav?'⭐ Saved':'☆ Save'}</button>
          <button class="other-btn visit-btn ${vis?'on':''}">${vis?'✅ Visited':'○ Visit'}</button>
        </div>
        <div class="other-nav-row">
          <button class="other-nav-btn" data-mode="walking">🚶 Walk</button>
          <button class="other-nav-btn" data-mode="bicycling">🏍 Bike</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}
function renderAmenityListN(listId, sectionId, list, enabled){
  const section = document.getElementById(sectionId);
  section.style.display = enabled ? 'block':'none';
  if (!enabled) return;
  const cont = document.getElementById(listId);
  const sorted = list.map(p=>({...p, dist:haversine(userLat,userLng,p.lat,p.lng)})).sort((a,b)=>a.dist-b.dist);
  if (!sorted.length){ cont.innerHTML = `<div class="empty-state" style="padding:12px;">No data yet.</div>`; return; }
  cont.innerHTML = sorted.map(p=>`<div class="amenity-row" data-lat="${p.lat}" data-lng="${p.lng}">
    <span class="amenity-name">${esc(p.name)}${p.type?` (${esc(p.type)})`:''}</span>
    <span class="amenity-dist">${p.dist.toFixed(2)} km</span>
    <button class="amenity-nav-btn walk" data-mode="walking">🚶</button>
    <button class="amenity-nav-btn bike" data-mode="bicycling">🏍</button>
  </div>`).join('');
}

// ---------- PROFILE TAB ----------
function renderProfileList(){
  const master = dashboardCategory === 'all' ? DATA.all : (DATA[dashboardCategory] || []);
  const visitedNames = getVisitedNames(), favNames = getFavNames();
  let list;
  if (activeSubTab==='visited') list = master.filter(p=>visitedNames.includes(p.name));
  else if (activeSubTab==='saved') list = master.filter(p=>favNames.includes(p.name));
  else list = master.filter(p=>!visitedNames.includes(p.name));
  list = list.map(p=>({...p, dist:haversine(userLat,userLng,p.lat,p.lng)})).sort((a,b)=>a.dist-b.dist);
  const totalMatching = list.length;
const visibleList = list.slice(0, dashboardVisibleCount);
  const cont = document.getElementById('profile-list-container');
  if (!list.length){ cont.innerHTML = `<div class="empty-state" style="padding:20px;">Nothing here yet.</div>`; return; }
  cont.innerHTML = visibleList.map(p=>{
    const vis=isVisited(p.name), fav=isFav(p.name);
    return `<div class="visited-row" data-name="${esc(p.name)}">
      <div class="vr-info"><span class="vr-name">${esc(p.name)}</span><span class="vr-zone">${p.dist.toFixed(1)} km</span></div>
      <div class="vr-actions">
        <button class="vr-btn fav-btn ${fav?'on':''}">${fav?'⭐':'☆'}</button>
        <button class="vr-btn visit-btn ${vis?'on':''}">${vis?'✅':'○'}</button>
      </div>
    </div>`;
  }).join('');

    const remaining = totalMatching - dashboardVisibleCount;

  if (remaining > 0) {
    cont.innerHTML += `
      <button class="see-more-btn" id="dashboard-see-more">
        See More (${remaining})
      </button>
    `;
  }

  const seeMoreBtn = document.getElementById('dashboard-see-more');

  if (seeMoreBtn) { 
   seeMoreBtn.addEventListener('click', () => {
    dashboardVisibleCount += 50;
    renderProfileList();
   });
  }
}

// ---------- TABS ----------
function setTab(tab){ 
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.getElementById('tab-map').style.display = tab==='map' ? 'block':'none';
  document.getElementById('tab-nearest').style.display = tab==='nearest' ? 'block':'none';
  document.getElementById('tab-profile').style.display = tab==='profile' ? 'block':'none';
  closeSheet(); closeAllDropdowns(); closeAllSearchResults();
  if (tab==='map' && leafletMap) setTimeout(()=>leafletMap.invalidateSize(), 60);
  if (tab==='nearest') renderNearestTab();
  if (tab==='profile') renderProfileList();
}

// ---------- EVENT WIRING ----------
function wireClearButton(inputId, resultsId, clearBtnId) {
  const input = document.getElementById(inputId);
  const clearBtn = document.getElementById(clearBtnId);

  if (!input || !clearBtn) return;

  input.addEventListener('input', () => {
    clearBtn.classList.toggle(
      'visible',
      input.value.trim().length > 0
    );
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.remove('visible');
    input.dispatchEvent(new Event('input'));
    input.focus();
  });
}

function attachEventListeners(){
  document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click', ()=>setTab(btn.dataset.tab)));
  

  document.getElementById('category-boxes-map').addEventListener('click', e=>{
    const catEl = e.target.closest('[data-cat]'); if (!catEl) return;
    activeCategory = catEl.dataset.cat;
    updateCategoryBoxUI();
    drawMapLayers();
    closeAllDropdowns();
  });
    wireClearButton('search-input-map', 'search-results-map', 'search-clear-map');
  wireClearButton('search-input-nearest', 'search-results-nearest', 'search-clear-nearest');
  wireClearButton('search-input-visit', 'search-results-visit', 'search-clear-visit');
}

  document.getElementById('metro-toggle-btn').addEventListener('click', ()=>{
    metroOn = !metroOn;
    document.getElementById('metro-toggle-btn').classList.toggle('active', metroOn);
    drawMapLayers();
  });
  document.getElementById('toilet-toggle-btn').addEventListener('click', ()=>{
    toiletOn = !toiletOn;
    document.getElementById('toilet-toggle-btn').classList.toggle('active', toiletOn);
    drawMapLayers();
  });

  document.querySelectorAll('.dropdown').forEach(dd=>{
    const opener = dd.querySelector('.dropdown-toggle');
    if (!opener) return;
    opener.addEventListener('click', e=>{
      e.stopPropagation();
      const wasOpen = dd.classList.contains('open');
      closeAllDropdowns();
      if (!wasOpen) dd.classList.add('open');
    });
  });
  document.addEventListener('click', closeAllDropdowns);
  document.addEventListener('click', e=>{ if (!e.target.closest('.search-bar')) closeAllSearchResults(); });

  document.getElementById('search-input-map').addEventListener('input', handleSearch);
  document.getElementById('search-results-map').addEventListener('click', e=>{
  e.stopPropagation();
  const row = e.target.closest('.search-result-row'); if (!row) return;
    const name=row.dataset.name, lat=parseFloat(row.dataset.lat), lng=parseFloat(row.dataset.lng), kind=row.dataset.kind;
    if (e.target.closest('.fav-btn')) { toggleFav(name); handleSearch(); return; }
    if (e.target.closest('.visit-btn')) { toggleVisited(name); handleSearch(); renderDashboard(); return; }
    const nav = e.target.closest('.nav-btn'); if (nav) return openMaps(lat, lng, nav.dataset.mode);
    // Tapped the row itself -> jump to it on the Leaflet map and open its card
    if (leafletMap) leafletMap.setView([lat, lng], 16);
    const item = buildSearchIndex().find(p => p.name === name && p._kind === kind);
    if (item) openSheet(item, kind);
    document.getElementById('search-input-map').value = '';
    closeAllSearchResults();
  });

  document.getElementById('sheet-body').addEventListener('click', e=>{
    if (e.target.closest('#sheet-fav-btn')) { toggleFav(currentSheetItem.name); renderSheetContent(); return; }
    if (e.target.closest('#sheet-visit-btn')) { toggleVisited(currentSheetItem.name); renderSheetContent(); drawMapLayers(); renderDashboard(); return; }
    if (e.target.closest('#sheet-route-btn')) { showRoute(currentSheetItem.lat, currentSheetItem.lng); return; }
    if (e.target.closest('#sheet-gmap-btn')) { openMaps(currentSheetItem.lat, currentSheetItem.lng, 'walking'); return; }
  });
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  document.getElementById('sheet-handle').addEventListener('click', togglePeek);

  document.getElementById('map-fab').addEventListener('click', ()=>refreshLocation(true));

  // --- Nearest tab ---
  document.getElementById('category-boxes-nearest').addEventListener('click', e=>{
    const catEl = e.target.closest('[data-cat]'); if (!catEl) return;
    const cat = catEl.dataset.cat;
    activeCategoryNearest = (activeCategoryNearest === cat) ? null : cat; // tap again to deselect
    updateCategoryBoxUIN();
    renderNearestTab();
    closeAllDropdowns();
  });
  document.getElementById('metro-toggle-btn-n').addEventListener('click', ()=>{
    metroOnNearest = !metroOnNearest;
    document.getElementById('metro-toggle-btn-n').classList.toggle('active', metroOnNearest);
    renderNearestTab();
  });
  document.getElementById('toilet-toggle-btn-n').addEventListener('click', ()=>{
    toiletOnNearest = !toiletOnNearest;
    document.getElementById('toilet-toggle-btn-n').classList.toggle('active', toiletOnNearest);
    renderNearestTab();
  });
  document.getElementById('search-input-nearest').addEventListener('input', handleSearchNearest);
  document.getElementById('search-results-nearest').addEventListener('click', e=>{
  e.stopPropagation();
  const hiddenRow = e.target.closest('.sr-hidden-row');
    if (hiddenRow) { toggleHidden(hiddenRow.dataset.name); handleSearchNearest(); return; }
    /* ===== END ===== */
    const row = e.target.closest('.search-result-row'); if (!row) return;
    const name=row.dataset.name, lat=row.dataset.lat, lng=row.dataset.lng;
    if (e.target.closest('.fav-btn')) { toggleFav(name); handleSearchNearest(); return; }
    if (e.target.closest('.visit-btn')) { toggleVisited(name); handleSearchNearest(); renderDashboard(); return; }
    if (e.target.closest('.hide-toggle-btn')) { toggleHidden(name); handleSearchNearest(); return; } /* HIDE PANDAL FEATURE */
    const nav = e.target.closest('.nav-btn'); if (nav) return openMaps(parseFloat(lat), parseFloat(lng), nav.dataset.mode);
  });
  document.getElementById('top3-container').addEventListener('click', e=>{
    const card = e.target.closest('.medal-card'); if (!card) return;
    const name=card.dataset.name, lat=card.dataset.lat, lng=card.dataset.lng;
    if (e.target.closest('.fav-btn')) { toggleFav(name); renderNearestTab(); return; }
    if (e.target.closest('.visit-btn')) { toggleVisited(name); renderNearestTab(); renderDashboard(); return; }
    if (e.target.closest('.hide-toggle-btn')) { toggleHidden(name); renderNearestTab(); return; } /* HIDE PANDAL FEATURE */
    const nav = e.target.closest('.nav-btn'); if (nav) return openMaps(parseFloat(lat), parseFloat(lng), nav.dataset.mode);
  });
  document.getElementById('others-list').addEventListener('click', e=>{
    /* ===== HIDE PANDAL FEATURE: restore from a collapsed list row ===== */
    const hiddenRow = e.target.closest('.hidden-pandal-row');
    if (hiddenRow) { toggleHidden(hiddenRow.dataset.name); renderNearestTab(); return; }
    /* ===== END ===== */
    const item = e.target.closest('.other-item'); if (!item) return;
    const name=item.dataset.name, lat=item.dataset.lat, lng=item.dataset.lng;
    if (e.target.closest('.fav-btn')) { toggleFav(name); renderNearestTab(); return; }
    if (e.target.closest('.visit-btn')) { toggleVisited(name); renderNearestTab(); renderDashboard(); return; }
    if (e.target.closest('.hide-toggle-btn')) { toggleHidden(name); renderNearestTab(); return; } /* HIDE PANDAL FEATURE */
    const nav = e.target.closest('.other-nav-btn'); if (nav) return openMaps(parseFloat(lat), parseFloat(lng), nav.dataset.mode);
    if (e.target.closest('.other-item-row')) { expandedOtherNearest = (expandedOtherNearest===name)?null:name; renderNearestTab(); }
  });
  ['metro-list-n','toilet-list-n'].forEach(id=>{
    document.getElementById(id).addEventListener('click', e=>{
      const row = e.target.closest('.amenity-row'); if (!row) return;
      const nav = e.target.closest('.amenity-nav-btn'); if (!nav) return;
      openMaps(parseFloat(row.dataset.lat), parseFloat(row.dataset.lng), nav.dataset.mode);
    });
  });

  // --- Profile tab ---
  document.getElementById('dashboard-toggle').addEventListener('click', toggleDashboard);
  document.getElementById('download-list-btn').addEventListener('click', downloadMyList);
  document.getElementById('clear-all-btn').addEventListener('click', clearAllData);
  document.getElementById('dashboard-category-dropdown').addEventListener('click', e=>{
    const item = e.target.closest('[data-dcat]');
    if (!item) return;

    dashboardCategory = item.dataset.dcat;
    dashboardVisibleCount = 10;

    updateDashboardCategoryUI();

    renderDashboard();
    renderProfileList();

    closeAllDropdowns();
  });


document.getElementById('dashboard-info-btn').addEventListener('click', e => {
    e.stopPropagation();

    showInfoModal(
        '📊 Your Puja Journey',
        "English: <br> Your Saved and Visited data is stored only on this device. Clearing browser data or switching to another browser or device may cause this data to be lost.<br><br>বাংলা:<br>আপনার Saved এবং Visited ডেটা শুধুমাত্র এই ডিভাইসেই সংরক্ষিত থাকে। ব্রাউজারের ডেটা মুছে ফেললে অথবা অন্য ব্রাউজার বা ডিভাইসে পরিবর্তন করলে এই ডেটা হারিয়ে যেতে পারে।"
    );
});

document.querySelectorAll('[data-info="all-pandals"]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();

    showInfoModal(
    '🪔 Pandal Filter Info',
    'This section shows all the pandals in our list, both small and big. If you only want to see the important or notable ones, switch to Iconic.<br><br>এই বিভাগে আমাদের তালিকার সব ছোট-বড় প্যান্ডেল দেখানো হয়। আপনি যদি শুধু গুরুত্বপূর্ণ বা উল্লেখযোগ্য প্যান্ডেলগুলি দেখতে চান, তাহলে “Iconic” নির্বাচন করুন।'
    );
  });
});

  document.getElementById('modal-close-x').addEventListener('click', closeInfoModal);
  document.getElementById('info-modal').addEventListener('click', e=>{
    if (e.target.id === 'info-modal') closeInfoModal();
  });

  document.getElementById('emergency-toggle-btn').addEventListener('click', ()=>toggleCollapsibleSection('emergency-list','emergency-toggle-btn'));
  document.getElementById('routes-toggle-btn').addEventListener('click', ()=>toggleCollapsibleSection('routes-content','routes-toggle-btn'));
  document.getElementById('account-toggle-btn').addEventListener('click', ()=>toggleCollapsibleSection('account-content','account-toggle-btn'));
  document.getElementById('chai-toggle-btn').addEventListener('click', ()=>toggleCollapsibleSection('chai-content','chai-toggle-btn'));
  document.getElementById('share-page-btn').addEventListener('click', sharePage);
  


function payViaUpi() {

  const upiId = document.getElementById('upi-id-text').textContent.trim();

  const payeeName = 'Sankha';

  const upiUrl =
    'upi://pay' +
    '?pa=' + encodeURIComponent(upiId) +
    '&pn=' + encodeURIComponent(payeeName) +
    '&cu=INR';

  sessionStorage.setItem('upi-payment-attempted', 'true');

  window.location.href = upiUrl;
}

document.getElementById('upi-pay-btn').addEventListener('click', payViaUpi);


// Show the message when the user returns to the website
function checkUpiReturn() {
  if (sessionStorage.getItem('upi-payment-attempted') === 'true') {
    document.getElementById('chai-thanks').style.display = 'block';
    sessionStorage.removeItem('upi-payment-attempted');

    // setTimeout(function() {
    //   thanks.style.display = 'none';
    // }, 10 * 60 * 1000);
  }
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') {
    checkUpiReturn();
  }
});

window.addEventListener('pageshow', function () {
  checkUpiReturn();
});

document.getElementById('upi-copy-btn').addEventListener('click', copyUpiId);

document.querySelectorAll('.subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeSubTab = btn.dataset.subtab;

    document.querySelectorAll('.subtab-btn').forEach(b =>
      b.classList.toggle('active', b === btn)
    );

    renderProfileList();
  });
});

//   function payViaUpi() {
//   const upiId = document.getElementById('upi-id-text').textContent.trim();
//   const payeeName = 'Sankha';

//   const upiUrl =
//     'upi://pay' +
//     '?pa=' + encodeURIComponent(upiId) +
//     '&pn=' + encodeURIComponent(payeeName) +
//     '&cu=INR';

//   window.location.href = upiUrl;
// }

// document.getElementById('upi-copy-btn').addEventListener('click', copyUpiId);
// document.getElementById('upi-pay-btn').addEventListener('click', payViaUpi);

//   document.querySelectorAll('.subtab-btn').forEach(btn=>{
//     btn.addEventListener('click', ()=>{
//       activeSubTab = btn.dataset.subtab;
//       document.querySelectorAll('.subtab-btn').forEach(b=>b.classList.toggle('active', b===btn));
//       renderProfileList();
//     });
//   });


  document.getElementById('profile-list-container').addEventListener('click', e=>{
    const row = e.target.closest('.visited-row'); if (!row) return;
    const name = row.dataset.name;
    if (e.target.closest('.fav-btn')) { toggleFav(name); renderProfileList(); renderDashboard(); return; }
    if (e.target.closest('.visit-btn')) { toggleVisited(name); renderProfileList(); renderDashboard(); return; }
  });
  document.getElementById('search-input-visit').addEventListener('input', handleVisitSearch);
  document.getElementById('search-results-visit').addEventListener('click', e=>{
    const btn = e.target.closest('.mark-visit-btn'); if (!btn) return;
    const name = btn.closest('.search-result-row').dataset.name;
    toggleVisited(name);
    handleVisitSearch(); renderProfileList(); renderDashboard();
  });
  document.getElementById('dark-mode-toggle').addEventListener('change', e=>{
    document.body.classList.toggle('dark-mode', e.target.checked);
    try{ localStorage.setItem('dpg_dark_mode', e.target.checked?'1':'0'); }catch{}
  });
const dhakAudio = new Audio('dhak.mp3');
const dhakBtn = document.getElementById('dhak-btn');

dhakBtn.addEventListener('click', () => {

  if (!dhakAudio.paused) {
    // Stop the music
    dhakAudio.pause();
    dhakAudio.currentTime = 0;
    dhakBtn.classList.remove('playing');
    return;
  }

  // Play from the beginning
  dhakAudio.currentTime = 0;
  dhakAudio.play();
  dhakBtn.classList.add('playing');
});

// Return button to normal when the 16-second audio finishes
dhakAudio.addEventListener('ended', () => {
  dhakBtn.classList.remove('playing');
});

// ---------- INIT ----------
async function init(){
  await loadAllData();
  relocateInfoModal();
  attachEventListeners();
  renderEmergencyContacts();
  initMap();
  renderDashboard();
  updateDashboardCategoryUI();
  renderNearestTab();
  renderProfileList();
  if (localStorage.getItem('dpg_dark_mode')==='1'){
    document.body.classList.add('dark-mode');
    document.getElementById('dark-mode-toggle').checked = true;
  }
  refreshLocation(false);
  setInterval(()=>refreshLocation(false), 5000);
}
init();
