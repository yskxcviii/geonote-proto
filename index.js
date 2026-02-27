let map;
var railwayLayer, railwayHitLayer, stationLayer;
var hitToVisualMap = new Map();
var useGrayStyle = true;
var hiddenRoutes = {}, hiddenStations = {};
var loadedCompanies = [];

var ZOOM_LABEL = 11;
var ZOOM_RAILWAY = 10;
var ZOOM_STATION = 12;

var COMPANY_ALIAS = {
  '東日本旅客鉄道': 'JR東日本',
  '東海旅客鉄道': 'JR東海',
  '西日本旅客鉄道': 'JR西日本',
  '北海道旅客鉄道': 'JR北海道',
  '四国旅客鉄道': 'JR四国',
  '九州旅客鉄道': 'JR九州',
  '日本貨物鉄道': 'JR貨物',
  '東京地下鉄': '東京メトロ',
  '東京都交通局': '都営',
  '首都圏新都市鉄道': 'つくばエクスプレス',
  '東京臨海高速鉄道': 'りんかい線',
  '東京臨海新交通': 'ゆりかもめ',
  '京浜急行電鉄': '京急',
  '京王電鉄': '京王',
  '小田急電鉄': '小田急',
  '東急電鉄': '東急',
  '東京急行電鉄': '東急',
  '東武鉄道': '東武',
  '西武鉄道': '西武',
  '京成電鉄': '京成',
  '相模鉄道': '相鉄',
  '新京成電鉄': '新京成',
  '北総鉄道': '北総',
  '東葉高速鉄道': '東葉高速',
  '横浜高速鉄道': 'みなとみらい線',
  '多摩都市モノレール': '多摩モノレール',
  '埼玉高速鉄道': 'SR',
  '横浜市交通局': '横浜市営地下鉄'
};

function displayCompanyName(name) {
  var alias = COMPANY_ALIAS[name];
  return alias ? alias + ' (' + name + ')' : name;
}

var COMPANY_COLORS = {
  '東日本旅客鉄道': '#008C3F',
  '東海旅客鉄道': '#FF7E1C',
  '東京地下鉄': '#009BBF',
  '東京都交通局': '#00A070',
  '東京臨海高速鉄道': '#4FC3F7',
  '京王電鉄': '#C9167E',
  '京成電鉄': '#1A3B8C',
  '京浜急行電鉄': '#E60012',
  '東急電鉄': '#D32D10',
  '東武鉄道': '#E8700E',
  '西武鉄道': '#003E92',
  '小田急電鉄': '#00A0DE',
  'ゆりかもめ': '#009E96',
  '東京モノレール': '#80489C',
  '多摩都市モノレール': '#B34886',
  '首都圏新都市鉄道': '#6A3093',
  '北総鉄道': '#64C8E8',
  '埼玉高速鉄道': '#57A058',
  '高尾登山電鉄': '#3A5F0B',
  '御岳登山鉄道': '#8B6914',
  '相模鉄道': '#2A6496'
};

function getRailwayColor(name) { return COMPANY_COLORS[name] || '#666666'; }

const COLORS = [
  '#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01', '#46BDC6',
  '#7B1FA2', '#C2185B', '#00897B', '#5C6BC0', '#F4511E', '#039BE5',
  '#7CB342', '#C0CA33', '#FFB300', '#8D6E63', '#78909C', '#D81B60',
  '#00ACC1', '#43A047', '#E53935', '#1E88E5', '#FDD835', '#6D4C41',
  '#546E7A', '#AB47BC', '#26A69A', '#EC407A', '#29B6F6', '#9CCC65',
  '#5E35B1', '#00838F', '#AD1457', '#2E7D32', '#EF6C00', '#4527A0',
  '#00695C', '#B71C1C', '#0277BD', '#558B2F', '#FF8F00', '#283593'
];
const colorMap = {};
let colorIdx = 0;
function getColor(code) {
  if (!code) return '#90A4AE';
  if (!colorMap[code]) { colorMap[code] = COLORS[colorIdx % COLORS.length]; colorIdx++; }
  return colorMap[code];
}

// --- Web Worker for JSON parsing ---
var parseWorker = null;
var workerCbs = {};
var workerSeq = 0;

function initWorker() {
  try {
    var src = 'self.onmessage=function(e){try{self.postMessage({i:e.data.i,r:JSON.parse(e.data.t)})}catch(x){self.postMessage({i:e.data.i,e:x.message})}};';
    parseWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
    parseWorker.onmessage = function (e) {
      var cb = workerCbs[e.data.i];
      if (!cb) return;
      delete workerCbs[e.data.i];
      if (e.data.e) cb.reject(new Error(e.data.e)); else cb.resolve(e.data.r);
    };
  } catch (ex) { parseWorker = null; }
}

function parseJson(text) {
  if (parseWorker) {
    return new Promise(function (resolve, reject) {
      var id = ++workerSeq;
      workerCbs[id] = { resolve: resolve, reject: reject };
      parseWorker.postMessage({ i: id, t: text });
    });
  }
  return new Promise(function (resolve, reject) {
    setTimeout(function () { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } }, 0);
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// --- IndexedDB Cache ---
var _cacheDB = null;
var CACHE_DB_NAME = 'tokyo-map-cache';
var CACHE_DB_VERSION = 1;
var CACHE_STORE = 'files';

function openCacheDB() {
  if (_cacheDB) return Promise.resolve(_cacheDB);
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        var store = db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        store.createIndex('category', 'category', { unique: false });
      }
    };
    req.onsuccess = function (e) { _cacheDB = e.target.result; resolve(_cacheDB); };
    req.onerror = function (e) { reject(e.target.error); };
  });
}

function cacheGet(key) {
  return openCacheDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(CACHE_STORE, 'readonly');
      var req = tx.objectStore(CACHE_STORE).get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function cachePut(record) {
  return openCacheDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).put(record);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function cacheDeleteKey(key) {
  return openCacheDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).delete(key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function cacheListAll() {
  return openCacheDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(CACHE_STORE, 'readonly');
      var req = tx.objectStore(CACHE_STORE).getAll();
      req.onsuccess = function () {
        resolve((req.result || []).map(function (r) {
          return { key: r.key, name: r.name, category: r.category, source: r.source, cachedAt: r.cachedAt, size: (r.text || '').length };
        }));
      };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function cacheGetByCategory(category) {
  return openCacheDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(CACHE_STORE, 'readonly');
      var index = tx.objectStore(CACHE_STORE).index('category');
      var req = index.getAll(category);
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function formatCacheSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadFromCache() {
  try {
    var adminItems = await cacheGetByCategory('admin');
    if (adminItems.length > 0) {
      showLoader('キャッシュから行政区域を読み込み中...');
      var totalFeatures = 0;
      for (var i = 0; i < adminItems.length; i++) {
        var geojson = await parseJson(adminItems[i].text);
        map.data.addGeoJson(geojson);
        if (geojson.features) totalFeatures += geojson.features.length;
        buildLegend(geojson);
        addMunicipalityLabels(geojson);
      }
      map.setCenter({ lat: 35.68, lng: 139.69 });
      map.setZoom(11);
      document.getElementById('status').textContent = totalFeatures.toLocaleString() + ' 個のフィーチャー (キャッシュ)';
    }

    var railwayItems = await cacheGetByCategory('railway');
    if (railwayItems.length > 0) {
      showLoader('キャッシュから鉄道路線を読み込み中...');
      var rTotal = 0, seen = {};
      for (var i = 0; i < railwayItems.length; i++) {
        document.getElementById('loaderText').textContent = '鉄道路線 (キャッシュ ' + (i + 1) + '/' + railwayItems.length + ')';
        var geojson = await parseJson(railwayItems[i].text);
        var vf = railwayLayer.addGeoJson(geojson);
        var hf = railwayHitLayer.addGeoJson(geojson);
        for (var k = 0; k < hf.length; k++) hitToVisualMap.set(hf[k], vf[k]);
        if (geojson.features) {
          rTotal += geojson.features.length;
          for (var j = 0; j < geojson.features.length; j++) {
            var nm = geojson.features[j].properties && geojson.features[j].properties.name;
            if (nm && !seen[nm]) { seen[nm] = true; loadedCompanies.push(nm); }
          }
        }
        if (i % 4 === 3) await sleep(0);
      }
      document.getElementById('railwayStatus').textContent = railwayItems.length + ' ファイル (' + rTotal + ' 路線) (キャッシュ)';
      buildRailwayToggles();
    }

    var stationItems = await cacheGetByCategory('station');
    if (stationItems.length > 0) {
      showLoader('キャッシュから駅を読み込み中...');
      var sTotal = 0;
      var seenCo = {};
      for (var x = 0; x < loadedCompanies.length; x++) seenCo[loadedCompanies[x]] = true;
      for (var i = 0; i < stationItems.length; i++) {
        document.getElementById('loaderText').textContent = '駅 (キャッシュ ' + (i + 1) + '/' + stationItems.length + ')';
        var geojson = await parseJson(stationItems[i].text);
        stationLayer.addGeoJson(geojson);
        if (geojson.features) {
          sTotal += geojson.features.length;
          for (var j = 0; j < geojson.features.length; j++) {
            var co = geojson.features[j].properties && geojson.features[j].properties.company;
            if (co && !seenCo[co]) { seenCo[co] = true; loadedCompanies.push(co); }
          }
        }
        if (i % 4 === 3) await sleep(0);
      }
      document.getElementById('stationStatus').textContent = sTotal.toLocaleString() + ' 駅 (キャッシュ)';
      buildRailwayToggles();
    }
  } catch (e) {
    console.warn('Cache load failed:', e.message);
  }
  hideLoader();
}

async function populateCacheList() {
  var el = document.getElementById('cacheList');
  try {
    var list = await cacheListAll();
    if (list.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px 0;">キャッシュなし</div>';
      document.getElementById('clearAllCacheBtn').style.display = 'none';
      return;
    }
    document.getElementById('clearAllCacheBtn').style.display = '';
    var categories = { admin: [], railway: [], station: [] };
    var catNames = { admin: '行政区域', railway: '鉄道路線', station: '駅' };
    for (var i = 0; i < list.length; i++) {
      var cat = list[i].category || 'admin';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(list[i]);
    }
    var html = '', totalSize = 0;
    for (var cat in categories) {
      if (categories[cat].length === 0) continue;
      html += '<div class="cache-category">' + (catNames[cat] || cat) + ' (' + categories[cat].length + ' ファイル)</div>';
      for (var j = 0; j < categories[cat].length; j++) {
        var item = categories[cat][j];
        totalSize += item.size;
        html += '<div class="cache-item">'
          + '<span class="cache-name" title="' + item.name + '">' + item.name + '</span>'
          + '<span class="cache-meta">' + formatCacheSize(item.size) + '</span>'
          + '<button class="cache-del" onclick="deleteCacheItem(decodeURIComponent(\'' + encodeURIComponent(item.key) + '\'))" title="削除">&times;</button>'
          + '</div>';
      }
    }
    html += '<div style="font-size:10px;color:#aaa;margin-top:6px;text-align:right;">合計: ' + formatCacheSize(totalSize) + '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div style="font-size:12px;color:#d32f2f;">キャッシュ読み込み失敗</div>';
  }
}

async function deleteCacheItem(key) {
  try {
    await cacheDeleteKey(key);
    populateCacheList();
  } catch (e) { alert('削除失敗: ' + e.message); }
}

async function clearAllCache() {
  if (!confirm('全てのキャッシュを削除してよろしいですか？')) return;
  try {
    var list = await cacheListAll();
    for (var i = 0; i < list.length; i++) await cacheDeleteKey(list[i].key);
    populateCacheList();
  } catch (e) { alert('削除失敗: ' + e.message); }
}

var googleApiKey = '';

function extractDriveId(url) {
  if (!url) return '';
  url = url.trim();
  var m;
  m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]+$/.test(url)) return url;
  return '';
}

async function driveApiFetch(url) {
  var resp = await fetch(url);
  if (!resp.ok) {
    var detail = '';
    try {
      var errBody = await resp.json();
      if (errBody.error) {
        detail = errBody.error.message || '';
        if (errBody.error.errors && errBody.error.errors.length > 0) {
          detail += ' (' + errBody.error.errors[0].reason + ')';
        }
      }
    } catch (e) { /* not JSON */ }
    var msg = 'Drive API ' + resp.status;
    if (detail) msg += ' - ' + detail;
    console.error(msg, '\nURL:', url.replace(/key=[^&]+/, 'key=***'));
    throw new Error(msg);
  }
  return resp;
}

async function fetchDriveFile(fileId) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&key=' + encodeURIComponent(googleApiKey);
  var resp = await driveApiFetch(url);
  return resp.text();
}

async function listDriveFolder(folderId) {
  var q = encodeURIComponent("'" + folderId + "' in parents and trashed = false");
  var url = 'https://www.googleapis.com/drive/v3/files?q=' + q
    + '&key=' + encodeURIComponent(googleApiKey)
    + '&fields=files(id,name)&pageSize=1000';
  var resp = await driveApiFetch(url);
  var data = await resp.json();
  return (data.files || []).filter(function (f) { return f.name.endsWith('.geojson'); });
}

// --- UI ---
function loadMapsAPI() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key) { alert('API キーを入力してください。'); return; }
  googleApiKey = key;
  document.getElementById('apiOverlay').classList.add('hidden');
  showLoader('Google Maps を読み込み中...');
  const s = document.createElement('script');
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&callback=initMap';
  s.onerror = function () {
    hideLoader();
    alert('Google Maps の読み込みに失敗しました。API キーを確認してください。');
    document.getElementById('apiOverlay').classList.remove('hidden');
  };
  document.head.appendChild(s);
}

// --- Marker management ---
var MARKER_COLORS = [
  { name: 'レッド', value: '#FF3B30' },
  { name: 'オレンジ', value: '#FF9500' },
  { name: 'イエロー', value: '#FFCC00' },
  { name: 'グリーン', value: '#34C759' },
  { name: 'ブルー', value: '#007AFF' },
  { name: 'パープル', value: '#AF52DE' },
  { name: 'グレー', value: '#8E8E93' }
];
var userMarkers = [];
var gMapMarkers = {};
var markerSelectedColor = '#FF3B30';
var markerTempCoords = null;

function generateMarkerId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function loadUserMarkers() {
  try {
    var raw = localStorage.getItem('map_userMarkers');
    userMarkers = raw ? JSON.parse(raw) : [];
  } catch (e) { userMarkers = []; }
  syncMapMarkers();
  renderMarkerList();
}

function saveUserMarkers() {
  localStorage.setItem('map_userMarkers', JSON.stringify(userMarkers));
}

var selectedMarkerId = null;

function createPinIcon(color) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="28" viewBox="0 0 20 28">'
    + '<path d="M10 0C4.5 0 0 4.5 0 10c0 7.5 10 18 10 18s10-10.5 10-18C20 4.5 15.5 0 10 0z" fill="' + color + '" stroke="#fff" stroke-width="1.5"/>'
    + '<circle cx="10" cy="10" r="3.5" fill="#fff" opacity="0.85"/>'
    + '</svg>';
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(20, 28),
    anchor: new google.maps.Point(10, 28)
  };
}

function createPinIconSelected(color) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="28" viewBox="0 0 20 28">'
    + '<path d="M10 0C4.5 0 0 4.5 0 10c0 7.5 10 18 10 18s10-10.5 10-18C20 4.5 15.5 0 10 0z" fill="' + color + '" stroke="#FFD600" stroke-width="2.5"/>'
    + '<circle cx="10" cy="10" r="3.5" fill="#fff" opacity="0.85"/>'
    + '</svg>';
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(20, 28),
    anchor: new google.maps.Point(10, 28)
  };
}

function clearMarkerSelection() {
  if (!selectedMarkerId) return;
  var m = userMarkers.find(function(x) { return x.id === selectedMarkerId; });
  if (m && gMapMarkers[m.id]) {
    gMapMarkers[m.id].setIcon(createPinIcon(m.color));
  }
  selectedMarkerId = null;
}

function selectMarker(id) {
  clearMarkerSelection();
  var m = userMarkers.find(function(x) { return x.id === id; });
  if (m && gMapMarkers[m.id]) {
    gMapMarkers[m.id].setIcon(createPinIconSelected(m.color));
    selectedMarkerId = id;
  }
}

function syncMapMarkers() {
  var idSet = {};
  for (var i = 0; i < userMarkers.length; i++) idSet[userMarkers[i].id] = true;
  for (var id in gMapMarkers) {
    if (!idSet[id]) { gMapMarkers[id].setMap(null); delete gMapMarkers[id]; }
  }
  for (var i = 0; i < userMarkers.length; i++) {
    var m = userMarkers[i];
    if (gMapMarkers[m.id]) {
      gMapMarkers[m.id].setPosition({ lat: m.lat, lng: m.lng });
      gMapMarkers[m.id].setIcon(createPinIcon(m.color));
      gMapMarkers[m.id].setTitle(m.title);
    } else {
      var gm = new google.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map: map,
        icon: createPinIcon(m.color),
        title: m.title,
        zIndex: 999999
      });
      (function(mid) {
        gm.addListener('click', function() {
          clearSelection();
          selectMarker(mid);
          var cur = userMarkers.find(function(x) { return x.id === mid; });
          if (cur) {
            document.getElementById('infoName').textContent = cur.title;
            document.getElementById('infoDetail').textContent = '';
            var memoEl = document.getElementById('infoMemo');
            if (cur.memo) {
              memoEl.textContent = cur.memo;
              memoEl.style.display = 'block';
            } else {
              memoEl.style.display = 'none';
            }
            document.getElementById('info-bar').style.display = 'block';
          }
        });
      })(m.id);
      gMapMarkers[m.id] = gm;
    }
  }
}

function renderMarkerList() {
  var el = document.getElementById('markerList');
  var titleEl = document.getElementById('markerSectionTitle');
  titleEl.textContent = 'マーカー' + (userMarkers.length > 0 ? ' (' + userMarkers.length + '件)' : '');
  if (userMarkers.length === 0) {
    el.innerHTML = '<div style="font-size:11px;color:#aaa;padding:6px 0;">マーカーなし</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < userMarkers.length; i++) {
    var m = userMarkers[i];
    var esc = m.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    html += '<div class="marker-item" onclick="panToMarker(\'' + m.id + '\')">'
      + '<span class="m-dot" style="background:' + m.color + '"></span>'
      + '<span class="m-title" title="' + esc + '">' + esc + '</span>'
      + '<span class="m-actions">'
      + '<button onclick="event.stopPropagation();openMarkerModal(\'' + m.id + '\')" title="編集">&#9998;</button>'
      + '<button onclick="event.stopPropagation();deleteUserMarker(\'' + m.id + '\')" title="削除">&times;</button>'
      + '</span></div>';
  }
  el.innerHTML = html;
}

function panToMarker(id) {
  var m = userMarkers.find(function(x) { return x.id === id; });
  if (!m) return;
  map.panTo({ lat: m.lat, lng: m.lng });
  if (map.getZoom() < 14) map.setZoom(14);
  clearSelection();
  document.getElementById('infoName').textContent = m.title;
  document.getElementById('infoDetail').textContent = '';
  var memoEl = document.getElementById('infoMemo');
  if (m.memo) {
    memoEl.textContent = m.memo;
    memoEl.style.display = 'block';
  } else {
    memoEl.style.display = 'none';
  }
  document.getElementById('info-bar').style.display = 'block';
}

function deleteUserMarker(id) {
  if (!confirm('このマーカーを削除しますか？')) return;
  userMarkers = userMarkers.filter(function(m) { return m.id !== id; });
  saveUserMarkers();
  syncMapMarkers();
  renderMarkerList();
}

function openMarkerModal(id) {
  var editing = id ? userMarkers.find(function(m) { return m.id === id; }) : null;
  document.getElementById('mEditId').value = editing ? editing.id : '';
  document.getElementById('mAddress').value = editing ? editing.lat + ', ' + editing.lng : '';
  document.getElementById('mTitle').value = editing ? editing.title : '';
  document.getElementById('mMemo').value = editing ? (editing.memo || '') : '';
  document.getElementById('mCoordResult').textContent = editing
    ? '座標: ' + editing.lat.toFixed(6) + ', ' + editing.lng.toFixed(6) : '';
  markerTempCoords = editing ? { lat: editing.lat, lng: editing.lng } : null;
  markerSelectedColor = editing ? editing.color : MARKER_COLORS[0].value;
  document.getElementById('markerModalTitle').textContent = editing ? 'マーカーを編集' : 'マーカーを追加';
  renderColorPicker();
  document.getElementById('markerModal').classList.remove('hidden');
}

function closeMarkerModal() {
  document.getElementById('markerModal').classList.add('hidden');
}

function renderColorPicker() {
  var html = '';
  for (var i = 0; i < MARKER_COLORS.length; i++) {
    var c = MARKER_COLORS[i];
    var sel = c.value === markerSelectedColor ? ' selected' : '';
    html += '<div class="m-color-opt' + sel + '" style="background:' + c.value + ';" title="' + c.name + '" onclick="selectMarkerColor(\'' + c.value + '\')"></div>';
  }
  document.getElementById('mColorPicker').innerHTML = html;
}

function selectMarkerColor(v) {
  markerSelectedColor = v;
  renderColorPicker();
}

async function searchMarkerAddress() {
  var input = document.getElementById('mAddress').value.trim();
  if (!input) return;
  var resultEl = document.getElementById('mCoordResult');
  var parts = input.split(/[,\s]+/).map(function(s) { return parseFloat(s); });
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])
      && Math.abs(parts[0]) <= 90 && Math.abs(parts[1]) <= 180) {
    markerTempCoords = { lat: parts[0], lng: parts[1] };
    resultEl.textContent = '座標: ' + parts[0].toFixed(6) + ', ' + parts[1].toFixed(6);
    return;
  }
  resultEl.textContent = '検索中...';
  try {
    var geocoder = new google.maps.Geocoder();
    var res = await new Promise(function(resolve, reject) {
      geocoder.geocode({ address: input }, function(results, status) {
        if (status === 'OK' && results[0]) {
          var loc = results[0].geometry.location;
          resolve({ lat: loc.lat(), lng: loc.lng(), addr: results[0].formatted_address });
        } else { reject(new Error('住所が見つかりませんでした')); }
      });
    });
    markerTempCoords = { lat: res.lat, lng: res.lng };
    resultEl.textContent = res.addr + ' (' + res.lat.toFixed(6) + ', ' + res.lng.toFixed(6) + ')';
  } catch (e) {
    resultEl.textContent = e.message;
    markerTempCoords = null;
  }
}

function saveMarkerForm() {
  var editId = document.getElementById('mEditId').value;
  var title = document.getElementById('mTitle').value.trim();
  var memo = document.getElementById('mMemo').value.trim();
  if (!markerTempCoords) { alert('住所を検索するか座標を入力してください。'); return; }
  if (!title) { alert('タイトルを入力してください。'); return; }
  if (editId) {
    var idx = userMarkers.findIndex(function(m) { return m.id === editId; });
    if (idx >= 0) {
      userMarkers[idx].lat = markerTempCoords.lat;
      userMarkers[idx].lng = markerTempCoords.lng;
      userMarkers[idx].title = title;
      userMarkers[idx].color = markerSelectedColor;
      userMarkers[idx].memo = memo;
    }
  } else {
    userMarkers.push({
      id: generateMarkerId(),
      lat: markerTempCoords.lat,
      lng: markerTempCoords.lng,
      title: title,
      color: markerSelectedColor,
      memo: memo,
      createdAt: Date.now()
    });
  }
  saveUserMarkers();
  syncMapMarkers();
  renderMarkerList();
  closeMarkerModal();
}

function showLoader(msg) {
  document.getElementById('loaderText').textContent = msg || '読み込み中...';
  document.getElementById('loader').classList.add('active');
}
function hideLoader() { document.getElementById('loader').classList.remove('active'); }

function toggleAccordion(header) { header.classList.toggle('collapsed'); }

function refreshLayers() {
  railwayLayer.setStyle(railwayLayer.getStyle());
  if (railwayHitLayer) railwayHitLayer.setStyle(railwayHitLayer.getStyle());
  if (stationLayer) stationLayer.setStyle(stationLayer.getStyle());
}

// --- Settings ---
function openSettings() {
  document.getElementById('sAdminUrl').value = localStorage.getItem('map_adminDriveUrl') || '';
  document.getElementById('sRailwayUrl').value = localStorage.getItem('map_railwayDriveUrl') || '';
  document.getElementById('sStationUrl').value = localStorage.getItem('map_stationDriveUrl') || '';
  populateCacheList();
  document.getElementById('settingsModal').classList.remove('hidden');
}
function closeSettings() { document.getElementById('settingsModal').classList.add('hidden'); }

function saveSettings() {
  var a = document.getElementById('sAdminUrl').value.trim();
  var r = document.getElementById('sRailwayUrl').value.trim();
  var s = document.getElementById('sStationUrl').value.trim();
  if (a) localStorage.setItem('map_adminDriveUrl', a); else localStorage.removeItem('map_adminDriveUrl');
  if (r) localStorage.setItem('map_railwayDriveUrl', r); else localStorage.removeItem('map_railwayDriveUrl');
  if (s) localStorage.setItem('map_stationDriveUrl', s); else localStorage.removeItem('map_stationDriveUrl');
  closeSettings();
  fetchAllFromDrive();
}

async function fetchAllFromDrive() {
  var a = localStorage.getItem('map_adminDriveUrl');
  var r = localStorage.getItem('map_railwayDriveUrl');
  var s = localStorage.getItem('map_stationDriveUrl');
  if (!a && !r && !s) return;
  if (a) await fetchAdminFromDrive();
  if (r) await fetchRailwayFromDrive();
  if (s) await fetchStationFromDrive();
}

// --- Google Drive fetch ---
function checkDriveReady(urlKey) {
  if (!googleApiKey) {
    alert('先に Google Maps API キーを入力してください。');
    return null;
  }
  var url = localStorage.getItem(urlKey);
  if (!url) {
    alert('設定画面で Google Drive の URL を保存してください。');
    openSettings();
    return null;
  }
  var id = extractDriveId(url);
  if (!id) {
    alert('保存されたURLからIDを取得できません。設定を確認してください。');
    openSettings();
    return null;
  }
  return id;
}

async function fetchAdminFromDrive() {
  var fileId = checkDriveReady('map_adminDriveUrl');
  if (!fileId) return;
  showLoader('行政区域を読み込み中...');
  try {
    var text = await fetchDriveFile(fileId);
    cachePut({ key: 'drive:admin:' + fileId, name: 'admin_' + fileId.substring(0, 8) + '.geojson', category: 'admin', source: 'drive', text: text, cachedAt: Date.now() }).catch(function () { });
    await sleep(0);
    var geojson = await parseJson(text);
    map.data.addGeoJson(geojson);
    map.setCenter({ lat: 35.68, lng: 139.69 });
    map.setZoom(11);
    var count = geojson.features ? geojson.features.length : 0;
    document.getElementById('status').textContent = count.toLocaleString() + ' 個のフィーチャー (Drive)';
    buildLegend(geojson);
    addMunicipalityLabels(geojson);
  } catch (e) {
    document.getElementById('status').textContent = '読み込み失敗: ' + e.message;
    console.warn('Admin Drive fetch failed:', e.message);
  }
  hideLoader();
}

async function fetchRailwayFromDrive() {
  var folderId = checkDriveReady('map_railwayDriveUrl');
  if (!folderId) return;
  showLoader('鉄道路線フォルダを読み込み中...');
  try {
    var files = await listDriveFolder(folderId);
    var rLoaded = 0, rTotal = 0, seen = {};
    for (var i = 0; i < files.length; i++) {
      try {
        document.getElementById('loaderText').textContent = '鉄道路線 (' + (i + 1) + '/' + files.length + ') ' + files[i].name;
        var text = await fetchDriveFile(files[i].id);
        cachePut({ key: 'drive:railway:' + files[i].id, name: files[i].name, category: 'railway', source: 'drive', text: text, cachedAt: Date.now() }).catch(function () { });
        var geojson = await parseJson(text);
        var vf = railwayLayer.addGeoJson(geojson);
        var hf = railwayHitLayer.addGeoJson(geojson);
        for (var k = 0; k < hf.length; k++) hitToVisualMap.set(hf[k], vf[k]);
        if (geojson.features) {
          rTotal += geojson.features.length;
          for (var j = 0; j < geojson.features.length; j++) {
            var nm = geojson.features[j].properties && geojson.features[j].properties.name;
            if (nm && !seen[nm]) { seen[nm] = true; loadedCompanies.push(nm); }
          }
        }
        rLoaded++;
      } catch (e) { /* skip */ }
      if (i % 4 === 3) await sleep(0);
    }
    if (rLoaded > 0) {
      document.getElementById('railwayStatus').textContent = rLoaded + ' ファイル (' + rTotal + ' 路線) (Drive)';
      buildRailwayToggles();
    } else {
      document.getElementById('railwayStatus').textContent = '該当ファイルなし';
    }
  } catch (e) {
    document.getElementById('railwayStatus').textContent = '読み込み失敗: ' + e.message;
    console.warn('Railway Drive fetch failed:', e.message);
  }
  hideLoader();
}

async function fetchStationFromDrive() {
  var folderId = checkDriveReady('map_stationDriveUrl');
  if (!folderId) return;
  showLoader('駅フォルダを読み込み中...');
  try {
    var files = await listDriveFolder(folderId);
    var sLoaded = 0, sTotal = 0;
    var seenCo = {};
    for (var x = 0; x < loadedCompanies.length; x++) seenCo[loadedCompanies[x]] = true;
    for (var i = 0; i < files.length; i++) {
      try {
        document.getElementById('loaderText').textContent = '駅 (' + (i + 1) + '/' + files.length + ') ' + files[i].name;
        var text = await fetchDriveFile(files[i].id);
        cachePut({ key: 'drive:station:' + files[i].id, name: files[i].name, category: 'station', source: 'drive', text: text, cachedAt: Date.now() }).catch(function () { });
        var geojson = await parseJson(text);
        stationLayer.addGeoJson(geojson);
        if (geojson.features) {
          sTotal += geojson.features.length;
          for (var j = 0; j < geojson.features.length; j++) {
            var co = geojson.features[j].properties && geojson.features[j].properties.company;
            if (co && !seenCo[co]) { seenCo[co] = true; loadedCompanies.push(co); }
          }
        }
        sLoaded++;
      } catch (e) { /* skip */ }
      if (i % 4 === 3) await sleep(0);
    }
    if (sLoaded > 0) {
      document.getElementById('stationStatus').textContent = sTotal.toLocaleString() + ' 駅 (Drive)';
      buildRailwayToggles();
    } else {
      document.getElementById('stationStatus').textContent = '該当ファイルなし';
    }
  } catch (e) {
    document.getElementById('stationStatus').textContent = '読み込み失敗: ' + e.message;
    console.warn('Station Drive fetch failed:', e.message);
  }
  hideLoader();
}

// --- Tooltip ---
var tooltipEl = null;
var tooltipTimer = null;
var tooltipText = '';
var mouseClientX = 0, mouseClientY = 0;

document.addEventListener('mousemove', function (e) {
  mouseClientX = e.clientX;
  mouseClientY = e.clientY;
  if (tooltipEl) tooltipEl.style.display = 'none';
  if (tooltipText) {
    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(function () {
      if (!tooltipEl || !tooltipText) return;
      tooltipEl.textContent = tooltipText;
      tooltipEl.style.left = (mouseClientX + 14) + 'px';
      tooltipEl.style.top = (mouseClientY + 14) + 'px';
      tooltipEl.style.display = 'block';
    }, 500);
  }
});

function scheduleTooltip(text) {
  tooltipText = text;
  if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
  if (tooltipEl) tooltipEl.style.display = 'none';
  tooltipTimer = setTimeout(function () {
    if (!tooltipEl || !tooltipText) return;
    tooltipEl.textContent = tooltipText;
    tooltipEl.style.left = (mouseClientX + 14) + 'px';
    tooltipEl.style.top = (mouseClientY + 14) + 'px';
    tooltipEl.style.display = 'block';
  }, 500);
}

function hideTooltip() {
  tooltipText = '';
  if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// --- Selection ---
var selectedFeature = null;
var selectedLayer = null;

function applySelectionStyle(feature, layer) {
  if (layer === 'admin') {
    map.data.overrideStyle(feature, { fillOpacity: 0.5, strokeColor: '#1a73e8', strokeWeight: 3, strokeOpacity: 1 });
  } else if (layer === 'railway') {
    railwayLayer.overrideStyle(feature, { strokeWeight: 5, strokeOpacity: 1 });
  } else if (layer === 'station') {
    var co = feature.getProperty('company') || '';
    stationLayer.overrideStyle(feature, {
      icon: {
        path: google.maps.SymbolPath.CIRCLE, fillColor: getRailwayColor(co),
        fillOpacity: 1, strokeColor: '#FFD600', strokeWeight: 3, scale: 8
      }
    });
  }
}

function clearSelection() {
  if (selectedFeature) {
    if (selectedLayer === 'admin') map.data.revertStyle(selectedFeature);
    else if (selectedLayer === 'railway') railwayLayer.revertStyle(selectedFeature);
    else if (selectedLayer === 'station') stationLayer.revertStyle(selectedFeature);
    selectedFeature = null;
    selectedLayer = null;
  }
  clearMarkerSelection();
}

function selectFeature(feature, layer) {
  clearSelection();
  selectedFeature = feature;
  selectedLayer = layer;
  applySelectionStyle(feature, layer);
}

// --- Map init ---
window.initMap = function () {
  hideLoader();
  initWorker();
  tooltipEl = document.getElementById('mapTooltip');

  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 35.6762, lng: 139.6503 },
    zoom: 10,
    mapTypeControl: true,
    mapTypeControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
    styles: [
      { elementType: 'geometry', stylers: [{ color: '#f0f0f0' }] },
      { elementType: 'labels', stylers: [{ visibility: 'off' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d4e4f1' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#e0e0e0' }] },
      { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
      { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] }
    ]
  });

  initLabelOverlay();

  var prevZoomVis = { label: true, railway: true, station: true };
  map.addListener('zoom_changed', function () {
    var z = map.getZoom();
    var showLabel = z >= ZOOM_LABEL;
    var showRailway = z >= ZOOM_RAILWAY;
    var showStation = z >= ZOOM_STATION;
    if (showLabel !== prevZoomVis.label) {
      prevZoomVis.label = showLabel;
      for (var i = 0; i < labelOverlays.length; i++) {
        if (labelOverlays[i].div) labelOverlays[i].div.style.display = showLabel ? '' : 'none';
      }
    }
    if (showRailway !== prevZoomVis.railway) {
      prevZoomVis.railway = showRailway;
      railwayLayer.setStyle(railwayLayer.getStyle());
      railwayHitLayer.setStyle(railwayHitLayer.getStyle());
    }
    if (showStation !== prevZoomVis.station) {
      prevZoomVis.station = showStation;
      stationLayer.setStyle(stationLayer.getStyle());
    }
  });

  document.getElementById('panel').style.display = 'flex';

  map.data.setStyle(function (feature) {
    if (useGrayStyle) {
      return { fillColor: '#a0a0a0', fillOpacity: 0.3, strokeColor: '#888888', strokeOpacity: 0.7, strokeWeight: 0.8 };
    }
    var c = getColor(feature.getProperty('N03_007') || '');
    return { fillColor: c, fillOpacity: 0.3, strokeColor: c, strokeOpacity: 0.85, strokeWeight: 1.2 };
  });
  map.data.addListener('mouseover', function (e) {
    if (!(selectedFeature === e.feature && selectedLayer === 'admin')) {
      map.data.overrideStyle(e.feature, { fillOpacity: 0.55, strokeWeight: 2.5 });
    }
    var parts = [e.feature.getProperty('N03_003'), e.feature.getProperty('N03_004')].filter(Boolean);
    if (parts.length === 0) parts = [e.feature.getProperty('N03_001')].filter(Boolean);
    if (parts.length > 0) scheduleTooltip(parts.join(' '));
  });
  map.data.addListener('mouseout', function (e) {
    if (selectedFeature === e.feature && selectedLayer === 'admin') {
      applySelectionStyle(e.feature, 'admin');
    } else {
      map.data.revertStyle(e.feature);
    }
    hideTooltip();
  });
  map.data.addListener('click', function (e) {
    selectFeature(e.feature, 'admin');
    var f = e.feature;
    var parts = [f.getProperty('N03_001'), f.getProperty('N03_002'), f.getProperty('N03_003'), f.getProperty('N03_004')].filter(Boolean);
    document.getElementById('infoName').textContent = parts.join(' ');
    document.getElementById('infoDetail').textContent = '行政区域コード: ' + (f.getProperty('N03_007') || '-');
    document.getElementById('infoMemo').style.display = 'none';
    document.getElementById('info-bar').style.display = 'block';
  });
  map.addListener('click', function () {
    clearSelection();
    document.getElementById('infoMemo').style.display = 'none';
    document.getElementById('info-bar').style.display = 'none';
  });

  railwayLayer = new google.maps.Data();
  railwayLayer.setMap(map);
  railwayLayer.setStyle(function (feature) {
    var name = feature.getProperty('name') || '';
    if (hiddenRoutes[name] || map.getZoom() < ZOOM_RAILWAY) return { visible: false };
    var c = getRailwayColor(name);
    return { strokeColor: c, strokeOpacity: 0.9, strokeWeight: 2, zIndex: 10, clickable: false };
  });

  railwayHitLayer = new google.maps.Data();
  railwayHitLayer.setMap(map);
  railwayHitLayer.setStyle(function (feature) {
    var name = feature.getProperty('name') || '';
    if (hiddenRoutes[name] || map.getZoom() < ZOOM_RAILWAY) return { visible: false };
    return { strokeColor: 'transparent', strokeOpacity: 0, strokeWeight: 16, zIndex: 11 };
  });
  railwayHitLayer.addListener('mouseover', function (e) {
    var vf = hitToVisualMap.get(e.feature);
    if (vf && !(selectedFeature === vf && selectedLayer === 'railway')) {
      railwayLayer.overrideStyle(vf, { strokeWeight: 4, strokeOpacity: 1 });
    }
    var label = e.feature.getProperty('name') || '';
    if (label) scheduleTooltip(displayCompanyName(label));
  });
  railwayHitLayer.addListener('mouseout', function (e) {
    var vf = hitToVisualMap.get(e.feature);
    if (vf && selectedFeature === vf && selectedLayer === 'railway') {
      applySelectionStyle(vf, 'railway');
    } else if (vf) {
      railwayLayer.revertStyle(vf);
    }
    hideTooltip();
  });
  railwayHitLayer.addListener('click', function (e) {
    var vf = hitToVisualMap.get(e.feature);
    if (vf) selectFeature(vf, 'railway');
    var rn = e.feature.getProperty('name') || '';
    document.getElementById('infoName').textContent = displayCompanyName(rn);
    document.getElementById('infoDetail').textContent = '鉄道路線';
    document.getElementById('infoMemo').style.display = 'none';
    document.getElementById('info-bar').style.display = 'block';
  });

  stationLayer = new google.maps.Data();
  stationLayer.setMap(map);
  stationLayer.setStyle(function (feature) {
    var co = feature.getProperty('company') || '';
    if (hiddenStations[co] || map.getZoom() < ZOOM_STATION) return { visible: false };
    return {
      icon: {
        path: google.maps.SymbolPath.CIRCLE, fillColor: getRailwayColor(co),
        fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5, scale: 4
      },
      zIndex: 20
    };
  });
  stationLayer.addListener('mouseover', function (e) {
    if (!(selectedFeature === e.feature && selectedLayer === 'station')) {
      var co = e.feature.getProperty('company') || '';
      stationLayer.overrideStyle(e.feature, {
        icon: {
          path: google.maps.SymbolPath.CIRCLE, fillColor: getRailwayColor(co),
          fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 7
        }
      });
    }
    var stName = e.feature.getProperty('name') || '';
    if (stName) scheduleTooltip(stName + ' 駅');
  });
  stationLayer.addListener('mouseout', function (e) {
    if (selectedFeature === e.feature && selectedLayer === 'station') {
      applySelectionStyle(e.feature, 'station');
    } else {
      stationLayer.revertStyle(e.feature);
    }
    hideTooltip();
  });
  stationLayer.addListener('click', function (e) {
    selectFeature(e.feature, 'station');
    document.getElementById('infoName').textContent = (e.feature.getProperty('name') || '') + ' 駅';
    document.getElementById('infoDetail').textContent = displayCompanyName(e.feature.getProperty('company') || '') + ' ' + (e.feature.getProperty('line') || '');
    document.getElementById('infoMemo').style.display = 'none';
    document.getElementById('info-bar').style.display = 'block';
  });

  document.getElementById('fileInput').addEventListener('change', handleFile);
  document.getElementById('railwayInput').addEventListener('change', handleRailwayFiles);
  document.getElementById('stationInput').addEventListener('change', handleStationFiles);
  loadFromCache();
  loadUserMarkers();
};

// --- File handlers ---
function handleFile(e) {
  var file = e.target.files[0];
  if (!file) return;
  showLoader('GeoJSON を解析中... (大きなファイルは数秒かかります)');
  document.getElementById('status').textContent = '読み込み中: ' + file.name;
  var reader = new FileReader();
  reader.onload = function (ev) {
    var rawText = ev.target.result;
    cachePut({ key: 'file:admin:' + file.name, name: file.name, category: 'admin', source: 'file', text: rawText, cachedAt: Date.now() }).catch(function () { });
    parseJson(rawText).then(function (geojson) {
      map.data.addGeoJson(geojson);
      map.setCenter({ lat: 35.68, lng: 139.69 });
      map.setZoom(11);
      var count = geojson.features ? geojson.features.length : 0;
      document.getElementById('status').textContent = file.name + ' - ' + count.toLocaleString() + ' 個のフィーチャー';
      buildLegend(geojson);
      addMunicipalityLabels(geojson);
    }).catch(function (err) {
      alert('GeoJSON の解析に失敗しました:\n' + err.message);
      document.getElementById('status').textContent = 'エラーが発生しました';
    }).finally(function () { hideLoader(); });
  };
  reader.readAsText(file);
}

function handleRailwayFiles(e) {
  var files = e.target.files;
  if (!files || files.length === 0) return;
  showLoader('鉄道路線を読み込み中...');
  var statusEl = document.getElementById('railwayStatus');
  statusEl.textContent = files.length + ' ファイルを読み込み中...';
  var loaded = 0, totalFeatures = 0, errors = 0, seen = {};

  for (var i = 0; i < files.length; i++) {
    (function (file) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var rawText = ev.target.result;
        cachePut({ key: 'file:railway:' + file.name, name: file.name, category: 'railway', source: 'file', text: rawText, cachedAt: Date.now() }).catch(function () { });
        parseJson(rawText).then(function (geojson) {
          var vf = railwayLayer.addGeoJson(geojson);
          var hf = railwayHitLayer.addGeoJson(geojson);
          for (var k = 0; k < hf.length; k++) hitToVisualMap.set(hf[k], vf[k]);
          if (geojson.features) {
            totalFeatures += geojson.features.length;
            for (var j = 0; j < geojson.features.length; j++) {
              var nm = geojson.features[j].properties && geojson.features[j].properties.name;
              if (nm && !seen[nm]) { seen[nm] = true; loadedCompanies.push(nm); }
            }
          }
        }).catch(function () { errors++; }).finally(function () {
          loaded++;
          if (loaded === files.length) {
            statusEl.textContent = loaded + ' ファイル (' + totalFeatures + ' 路線)' + (errors > 0 ? ' / ' + errors + ' エラー' : '');
            buildRailwayToggles();
            hideLoader();
          }
        });
      };
      reader.readAsText(file);
    })(files[i]);
  }
}

function handleStationFiles(e) {
  var files = e.target.files;
  if (!files || files.length === 0) return;
  showLoader('駅データを読み込み中...');
  var statusEl = document.getElementById('stationStatus');
  statusEl.textContent = files.length + ' ファイルを読み込み中...';
  var loaded = 0, totalFeatures = 0, errors = 0;
  var seenCo = {};
  for (var x = 0; x < loadedCompanies.length; x++) seenCo[loadedCompanies[x]] = true;

  for (var i = 0; i < files.length; i++) {
    (function (file) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var rawText = ev.target.result;
        cachePut({ key: 'file:station:' + file.name, name: file.name, category: 'station', source: 'file', text: rawText, cachedAt: Date.now() }).catch(function () { });
        parseJson(rawText).then(function (geojson) {
          stationLayer.addGeoJson(geojson);
          if (geojson.features) {
            totalFeatures += geojson.features.length;
            for (var j = 0; j < geojson.features.length; j++) {
              var co = geojson.features[j].properties && geojson.features[j].properties.company;
              if (co && !seenCo[co]) { seenCo[co] = true; loadedCompanies.push(co); }
            }
          }
        }).catch(function () { errors++; }).finally(function () {
          loaded++;
          if (loaded === files.length) {
            statusEl.textContent = totalFeatures.toLocaleString() + ' 駅' + (errors > 0 ? ' / ' + errors + ' エラー' : '');
            buildRailwayToggles();
            hideLoader();
          }
        });
      };
      reader.readAsText(file);
    })(files[i]);
  }
}

// --- Build UI ---
function buildRailwayToggles() {
  var el = document.getElementById('railwayArea');
  var items = loadedCompanies.map(function (name) {
    return { name: name, color: getRailwayColor(name) };
  });
  items.sort(function (a, b) { return a.name.localeCompare(b.name); });

  var html = '<div class="accordion">'
    + '<div class="accordion-header" onclick="toggleAccordion(this)">'
    + '<span class="accordion-arrow">&#9660;</span>'
    + '<span>鉄道路線 (全' + items.length + '社)</span>'
    + '</div>'
    + '<div class="accordion-content"><div class="accordion-content-inner">'
    + '<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;">'
    + '<span id="toggleAllRoutes" style="cursor:pointer;color:#e8511a;font-size:10px;font-weight:500;padding:2px 6px;border:1px solid #ddd;border-radius:4px;" onclick="event.stopPropagation()">路線を一括切り替え</span>'
    + '<span id="toggleAllStations" style="cursor:pointer;color:#2e7d32;font-size:10px;font-weight:500;padding:2px 6px;border:1px solid #ddd;border-radius:4px;" onclick="event.stopPropagation()">駅を一括切り替え</span>'
    + '</div>';

  for (var i = 0; i < items.length; i++) {
    var rC = hiddenRoutes[items[i].name] ? '' : ' checked';
    var sC = hiddenStations[items[i].name] ? '' : ' checked';
    var dn = displayCompanyName(items[i].name);
    html += '<div class="company-row">'
      + '<span class="co-toggles">'
      + '<label title="路線図"><input type="checkbox"' + rC + ' data-company="' + items[i].name + '" class="route-toggle">線</label>'
      + '<label title="駅"><input type="checkbox"' + sC + ' data-company="' + items[i].name + '" class="station-toggle">駅</label>'
      + '</span>'
      + '<span class="co-color" style="background:' + items[i].color + '"></span>'
      + '<span class="co-name" data-company="' + items[i].name + '" title="' + dn + '">' + dn + '</span>'
      + '</div>';
  }
  html += '</div></div></div>';
  el.innerHTML = html;

  var routeCbs = el.querySelectorAll('.route-toggle');
  var stationCbs = el.querySelectorAll('.station-toggle');
  for (var j = 0; j < routeCbs.length; j++) {
    routeCbs[j].addEventListener('change', function () {
      var name = this.getAttribute('data-company');
      if (this.checked) delete hiddenRoutes[name]; else hiddenRoutes[name] = true;
      refreshLayers();
    });
  }
  for (var j = 0; j < stationCbs.length; j++) {
    stationCbs[j].addEventListener('change', function () {
      var name = this.getAttribute('data-company');
      if (this.checked) delete hiddenStations[name]; else hiddenStations[name] = true;
      refreshLayers();
    });
  }

  document.getElementById('toggleAllRoutes').addEventListener('click', function () {
    var allR = Object.keys(hiddenRoutes).length >= items.length;
    for (var k = 0; k < routeCbs.length; k++) {
      var name = routeCbs[k].getAttribute('data-company');
      routeCbs[k].checked = allR;
      if (allR) delete hiddenRoutes[name]; else hiddenRoutes[name] = true;
    }
    refreshLayers();
  });

  document.getElementById('toggleAllStations').addEventListener('click', function () {
    var allS = Object.keys(hiddenStations).length >= items.length;
    for (var k = 0; k < stationCbs.length; k++) {
      var name = stationCbs[k].getAttribute('data-company');
      stationCbs[k].checked = allS;
      if (allS) delete hiddenStations[name]; else hiddenStations[name] = true;
    }
    refreshLayers();
  });

  var coNames = el.querySelectorAll('.co-name');
  for (var j = 0; j < coNames.length; j++) {
    coNames[j].addEventListener('mouseenter', function () {
      var co = this.getAttribute('data-company');
      railwayLayer.forEach(function (f) {
        if (f.getProperty('name') === co) railwayLayer.overrideStyle(f, { strokeWeight: 4, strokeOpacity: 1 });
      });
    });
    coNames[j].addEventListener('mouseleave', function () {
      var co = this.getAttribute('data-company');
      railwayLayer.forEach(function (f) {
        if (f.getProperty('name') === co) {
          if (selectedFeature === f && selectedLayer === 'railway') applySelectionStyle(f, 'railway');
          else railwayLayer.revertStyle(f);
        }
      });
    });
    coNames[j].addEventListener('click', function () {
      var co = this.getAttribute('data-company');
      var first = null;
      railwayLayer.forEach(function (f) {
        if (f.getProperty('name') === co && !first) first = f;
      });
      if (first) selectFeature(first, 'railway');
      document.getElementById('infoName').textContent = displayCompanyName(co);
      document.getElementById('infoDetail').textContent = '鉄道路線';
      document.getElementById('infoMemo').style.display = 'none';
      document.getElementById('info-bar').style.display = 'block';
    });
  }
}

function buildLegend(geojson) {
  var seen = {}, items = [];
  if (!geojson.features) return;
  for (var i = 0; i < geojson.features.length; i++) {
    var p = geojson.features[i].properties || {};
    var code = p.N03_007 || '';
    if (seen[code]) continue;
    seen[code] = true;
    items.push({ code: code, label: [p.N03_003, p.N03_004].filter(Boolean).join(' ') || code, color: getColor(code) });
  }
  items.sort(function (a, b) { return a.code.localeCompare(b.code); });

  var el = document.getElementById('legendArea');
  var grayChecked = useGrayStyle ? ' checked' : '';
  var html = '<div class="accordion">'
    + '<div class="accordion-header collapsed" onclick="toggleAccordion(this)">'
    + '<span class="accordion-arrow">&#9660;</span>'
    + '<span>行政区域 (' + items.length + '区域)</span>'
    + '</div>'
    + '<div class="accordion-content"><div class="accordion-content-inner">'
    + '<label style="display:flex;align-items:center;cursor:pointer;font-size:12px;color:#555;user-select:none;margin-bottom:6px;">'
    + '<input type="checkbox" id="grayToggle"' + grayChecked + ' style="margin-right:4px;cursor:pointer;">グレーで表示</label>';
  for (var j = 0; j < items.length; j++) {
    html += '<div class="legend-item" data-code="' + items[j].code + '">'
      + '<span class="legend-swatch" style="background:' + items[j].color + '"></span>'
      + '<span>' + items[j].label + '</span></div>';
  }
  html += '</div></div></div>';
  el.innerHTML = html;
  document.getElementById('grayToggle').addEventListener('change', function () {
    useGrayStyle = this.checked;
    map.data.setStyle(map.data.getStyle());
  });

  var legendItems = el.querySelectorAll('.legend-item');
  for (var k = 0; k < legendItems.length; k++) {
    legendItems[k].addEventListener('mouseenter', function () {
      var code = this.getAttribute('data-code');
      map.data.forEach(function (f) {
        if (f.getProperty('N03_007') === code) {
          map.data.overrideStyle(f, { fillOpacity: 0.55, strokeWeight: 2.5 });
        }
      });
    });
    legendItems[k].addEventListener('mouseleave', function () {
      var code = this.getAttribute('data-code');
      map.data.forEach(function (f) {
        if (f.getProperty('N03_007') === code) {
          if (selectedFeature === f && selectedLayer === 'admin') applySelectionStyle(f, 'admin');
          else map.data.revertStyle(f);
        }
      });
    });
    legendItems[k].addEventListener('click', function () {
      var code = this.getAttribute('data-code');
      var first = null;
      map.data.forEach(function (f) {
        if (f.getProperty('N03_007') === code && !first) first = f;
      });
      if (first) {
        selectFeature(first, 'admin');
        var p = first;
        var parts = [p.getProperty('N03_001'), p.getProperty('N03_002'), p.getProperty('N03_003'), p.getProperty('N03_004')].filter(Boolean);
        document.getElementById('infoName').textContent = parts.join(' ');
        document.getElementById('infoDetail').textContent = '行政区域コード: ' + (p.getProperty('N03_007') || '-');
        document.getElementById('infoMemo').style.display = 'none';
        document.getElementById('info-bar').style.display = 'block';
      }
    });
  }
}

// --- Label overlay ---
var labelOverlays = [];

function LabelOverlay(position, text, mapRef) {
  this.position = position;
  this.text = text;
  this.div = null;
  this.setMap(mapRef);
}

function initLabelOverlay() {
  LabelOverlay.prototype = Object.create(google.maps.OverlayView.prototype);
  LabelOverlay.prototype.constructor = LabelOverlay;
  LabelOverlay.prototype.onAdd = function () {
    var div = document.createElement('div');
    div.className = 'map-label';
    div.textContent = this.text;
    if (map.getZoom() < ZOOM_LABEL) div.style.display = 'none';
    this.div = div;
    this.getPanes().overlayLayer.appendChild(div);
  };
  LabelOverlay.prototype.draw = function () {
    var proj = this.getProjection();
    if (!proj) return;
    var pos = proj.fromLatLngToDivPixel(this.position);
    if (pos) { this.div.style.left = pos.x + 'px'; this.div.style.top = pos.y + 'px'; }
  };
  LabelOverlay.prototype.onRemove = function () {
    if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
    this.div = null;
  };
}

function addMunicipalityLabels(geojson) {
  labelOverlays.forEach(function (o) { o.setMap(null); });
  labelOverlays = [];
  var groups = {};
  for (var i = 0; i < geojson.features.length; i++) {
    var f = geojson.features[i];
    var code = (f.properties && f.properties.N03_007) || '';
    if (!code) continue;
    if (!groups[code]) { groups[code] = { name: (f.properties.N03_004 || f.properties.N03_003 || ''), rings: [] }; }
    extractOuterRings(f.geometry, groups[code].rings);
  }
  for (var code in groups) {
    var g = groups[code];
    if (!g.name || g.rings.length === 0) continue;
    var largest = g.rings[0];
    for (var k = 1; k < g.rings.length; k++) { if (g.rings[k].length > largest.length) largest = g.rings[k]; }
    var center = findVisualCenter(largest);
    labelOverlays.push(new LabelOverlay(new google.maps.LatLng(center[1], center[0]), g.name, map));
  }
}

function extractOuterRings(geometry, rings) {
  if (geometry.type === 'Polygon') { rings.push(geometry.coordinates[0]); }
  else if (geometry.type === 'MultiPolygon') {
    for (var i = 0; i < geometry.coordinates.length; i++) rings.push(geometry.coordinates[i][0]);
  }
}

function findVisualCenter(ring) {
  if (!ring || ring.length < 3) return [0, 0];
  var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (var i = 0; i < ring.length; i++) {
    var lng = ring[i][0], lat = ring[i][1];
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  }
  var bestX = (minLng + maxLng) / 2, bestY = (minLat + maxLat) / 2, bestWidth = -1, steps = 24;
  for (var s = 1; s < steps; s++) {
    var y = minLat + (maxLat - minLat) * s / steps;
    var xs = [];
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var yi = ring[i][1], yj = ring[j][1];
      if ((yi > y) !== (yj > y)) xs.push(ring[j][0] + (y - yj) / (yi - yj) * (ring[i][0] - ring[j][0]));
    }
    xs.sort(function (a, b) { return a - b; });
    for (var k = 0; k < xs.length - 1; k += 2) {
      var w = xs[k + 1] - xs[k];
      if (w > bestWidth) { bestWidth = w; bestX = (xs[k] + xs[k + 1]) / 2; bestY = y; }
    }
  }
  return [bestX, bestY];
}

document.getElementById('apiKeyInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') loadMapsAPI();
});

(function () {
  var params = new URLSearchParams(window.location.search);
  var key = params.get('api-key');
  if (key) {
    document.getElementById('apiKeyInput').value = key;
    loadMapsAPI();
  }
})();

