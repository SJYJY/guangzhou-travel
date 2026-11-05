"use strict";
const { wgs2gcj, gcj2wgs, dist, esc } = window.GZ;
const $ = id => document.getElementById(id);

// ================= 配置 =================
const DISTRICTS = {
  "荔湾区": { color: "#e74c3c", adcode: 440103 },
  "越秀区": { color: "#2980b9", adcode: 440104 },
  "天河区": { color: "#27ae60", adcode: 440106 },
  "其他":   { color: "#7f8c8d" }
};
const MAIN3 = ["荔湾区", "越秀区", "天河区"];
const CATS = { "景点": "🏞️", "历史": "🏯", "博物馆": "🏛️", "公园": "🌳", "商圈": "🛍️", "地标": "🗼", "美食": "🍜" };
const STAY = { "景点": 60, "历史": 45, "博物馆": 90, "公园": 60, "商圈": 60, "地标": 30, "美食": 60 };
const MODES = {
  foot: { osrm: "routed-foot", label: "步行", speed: 1.2, amap: "walk" },
  bike: { osrm: "routed-bike", label: "骑行", speed: 4, amap: "ride" },
  car:  { osrm: "routed-car",  label: "驾车", speed: 8, amap: "car" }
};
const FAR = 2000; // 步行超过 2 公里建议地铁/打车
const LS = { spots: "gz_travel_spots_v1", seen: "gz_defaults_seen_v1", my: "gz_my_routes_v1", cur: "gz_cur_route_v1", cache: "gz_route_cache_v1" };
const PHOTOS = window.PHOTOS || [];
const ROUTES = window.ROUTES || [];
const INFO = window.SPOT_INFO || {};
let WXDAYS = []; // 10 天天气
const wxDay = date => WXDAYS.find(d => d.date === date);
const parseClock = s => { const [h, m] = String(s || "09:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const clock = min => { min = Math.round(min) % 1440; return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); };

function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn(e); } }
function toast(msg) { const t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = "none", 2200); }
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m"; }
function fmtMin(min) { min = Math.round(min); return min >= 60 ? Math.floor(min / 60) + " 小时 " + (min % 60 ? (min % 60) + " 分" : "") : min + " 分钟"; }
const colorOf = s => (DISTRICTS[s.district] || DISTRICTS["其他"]).color;
const stayOf = s => (s && (s.stay || STAY[s.cat])) || 45;

// ================= 地图 =================
const map = L.map("map", { minZoom: 9, maxZoom: 18 }).setView([23.125, 113.29], 13);
const gaodeVec = L.tileLayer("https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
  { subdomains: "1234", maxZoom: 18, crossOrigin: "anonymous", attribution: "© 高德地图 | 路线 © OpenStreetMap/OSRM" }).addTo(map);
const gaodeSat = L.layerGroup([
  L.tileLayer("https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}", { subdomains: "1234", maxZoom: 18, crossOrigin: "anonymous" }),
  L.tileLayer("https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}", { subdomains: "1234", maxZoom: 18, crossOrigin: "anonymous" })
]);
const boundaryLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);
const myLayer = L.layerGroup().addTo(map);
const routeLayers = {};
const overlays = { "区界": boundaryLayer, "景点 / 美食标记": markerLayer, "我的路线": myLayer };
ROUTES.forEach(r => { const g = L.layerGroup(); g._routeId = r.id; routeLayers[r.id] = g; overlays[`<span style="color:${r.color}">━</span> ${r.name}`] = g; });
L.control.layers({ "高德地图": gaodeVec, "高德卫星": gaodeSat }, overlays, { collapsed: true }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);
map.on("overlayadd", e => { if (e.layer._routeId && !e.layer._busy) showRoute(e.layer._routeId, false); });

// 区界（阿里 DataV，GCJ02；离线时跳过）
const districtBounds = {};
const districtGeo = {};
Object.entries(DISTRICTS).forEach(([name, d]) => {
  if (!d.adcode) return;
  fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${d.adcode}.json`).then(r => r.json()).then(geo => {
    const layer = L.geoJSON(geo, { style: { color: d.color, weight: 2, fillColor: d.color, fillOpacity: 0.05, dashArray: "5 4" }, interactive: false });
    layer.addTo(boundaryLayer); districtBounds[name] = layer.getBounds(); districtGeo[name] = geo;
  }).catch(() => {});
});
const FALLBACK_BOUNDS = { "荔湾区": [[23.04, 113.17], [23.17, 113.27]], "越秀区": [[23.10, 113.23], [23.17, 113.32]], "天河区": [[23.10, 113.30], [23.25, 113.44]] };
function flyDistrict(name) { const b = districtBounds[name] || (FALLBACK_BOUNDS[name] && L.latLngBounds(FALLBACK_BOUNDS[name])); if (b) map.flyToBounds(b, { padding: [20, 20] }); }

// 我的位置
let myLoc = null, myLocMarker = null;
const LocCtl = L.Control.extend({ options: { position: "topleft" }, onAdd() {
  const d = L.DomUtil.create("div", "locbtn"); d.title = "我的位置"; d.innerHTML = "◎";
  L.DomEvent.on(d, "click", e => { L.DomEvent.stop(e); locate(); }); return d; } });
map.addControl(new LocCtl());
function locate(cb) {
  if (!navigator.geolocation) return toast("浏览器不支持定位");
  toast("正在定位…");
  navigator.geolocation.getCurrentPosition(p => {
    const [lng, lat] = wgs2gcj(p.coords.longitude, p.coords.latitude);
    myLoc = { name: "我的位置", lng, lat };
    if (myLocMarker) map.removeLayer(myLocMarker);
    myLocMarker = L.marker([lat, lng], { icon: L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map).bindTooltip("我的位置");
    map.flyTo([lat, lng], 15); toast("定位成功"); cb && cb(myLoc);
  }, () => toast("定位失败（需允许定位权限；部署到 https 后更稳定）"), { enableHighAccuracy: true, timeout: 10000 });
}

// ================= 数据 =================
const clone = o => JSON.parse(JSON.stringify(o));
const newId = () => "s" + Math.random().toString(36).slice(2, 10);
function withIds(arr) { arr.forEach(s => { if (!s.id) s.id = newId(); }); return arr; }
function loadSpots() {
  const defs = withIds(clone(window.DEFAULT_SPOTS));
  const stored = lsGet(LS.spots, null);
  if (!Array.isArray(stored)) { lsSet(LS.seen, defs.map(d => d.name)); return defs; }
  const seen = lsGet(LS.seen, null) || stored.map(s => s.name);
  const byName = Object.fromEntries(defs.map(d => [d.name, d]));
  stored.forEach(s => { const d = byName[s.name]; if (d) ["top", "stay", "dish", "price"].forEach(k => { if (s[k] === undefined && d[k] !== undefined) s[k] = d[k]; }); });
  defs.forEach(d => { if (!seen.includes(d.name) && !stored.some(s => s.name === d.name)) stored.push(d); }); // 新增的默认景点自动补上
  lsSet(LS.seen, [...new Set([...seen, ...defs.map(d => d.name)])]);
  return withIds(stored);
}
let spots = loadSpots();
function save() { lsSet(LS.spots, spots); }
function spotByName(n) { return spots.find(s => s.name === n) || (window.DEFAULT_SPOTS || []).find(s => s.name === n); }
function photoOf(name) { return PHOTOS.find(p => p.spot === name); }

// ================= 筛选 & 景点列表 =================
const filterD = new Set(Object.keys(DISTRICTS));
const filterC = new Set(Object.keys(CATS));
let onlyFav = false, onlyTop = false, keyword = "";
function chip(text, on, color, onclick, title) {
  const c = document.createElement("span"); c.className = "chip" + (on ? " on" : ""); if (on) c.style.background = color;
  c.textContent = text; c.onclick = onclick; if (title) c.title = title; return c;
}
function renderChips() {
  const dBox = $("districtChips"); dBox.innerHTML = "";
  Object.entries(DISTRICTS).forEach(([name, d]) => {
    const c = chip(name, filterD.has(name), d.color, () => { filterD.has(name) ? filterD.delete(name) : filterD.add(name); renderChips(); render(); }, "单击筛选，双击定位到该区");
    c.ondblclick = () => flyDistrict(name); dBox.appendChild(c);
  });
  const cBox = $("catChips"); cBox.innerHTML = "";
  Object.entries(CATS).forEach(([name, icon]) => cBox.appendChild(chip(icon + " " + name, filterC.has(name), name === "美食" ? "#f39c12" : "#e67e22",
    () => { filterC.has(name) ? filterC.delete(name) : filterC.add(name); renderChips(); render(); })));
  cBox.appendChild(chip("⭐ 只看想去", onlyFav, "#f1c40f", () => { onlyFav = !onlyFav; renderChips(); render(); }));
  cBox.appendChild(chip("🔥 只看必去", onlyTop, "#c0392b", () => { onlyTop = !onlyTop; renderChips(); render(); }));
}
function visible(s) {
  return filterD.has(s.district in DISTRICTS ? s.district : "其他") && filterC.has(s.cat in CATS ? s.cat : "景点")
    && (!onlyFav || s.fav) && (!onlyTop || s.top)
    && (!keyword || s.name.includes(keyword) || (s.desc || "").includes(keyword) || (s.dish || "").includes(keyword));
}
function icon(s) {
  const food = s.cat === "美食";
  return L.divIcon({ className: "", html: `<div class="pin${food ? " food" : ""}${s.fav ? " fav" : ""}" style="background:${food ? "#fff" : colorOf(s)}"><span>${CATS[s.cat] || "📍"}</span></div>`,
    iconSize: [26, 26], iconAnchor: food ? [12, 12] : [13, 30], popupAnchor: [0, food ? -12 : -28] });
}
function popupHtml(s) {
  const ph = photoOf(s.name), inf = INFO[s.name] || {};
  const amap = `https://uri.amap.com/marker?position=${s.lng},${s.lat}&name=${encodeURIComponent(s.name)}&coordinate=gaode&callnative=1`;
  return `<div class="pop">
    ${ph ? `<img src="${ph.file.replace("photos/", "photos/thumb/")}" title="点击查看图集" onclick="location.href='gallery.html#${encodeURIComponent(s.name)}'">` : ""}
    <h4>${s.fav ? "⭐ " : ""}${esc(s.name)}${s.top ? ' <span style="color:#c0392b;font-size:12px">🔥必去</span>' : ""}</h4>
    <span class="tag" style="background:${colorOf(s)}">${esc(s.district)}</span><span class="tag" style="background:${s.cat === "美食" ? "#f39c12" : "#e67e22"}">${esc(s.cat)}</span>
    <span class="muted">建议停留 ${stayOf(s)} 分钟</span>
    ${s.dish ? `<p>🍽️ <b>推荐：</b>${esc(s.dish)}</p>` : ""}${s.price ? `<p>💰 人均约 ${esc(s.price)} 元</p>` : ""}
    <p>${esc(s.desc) || "（暂无简介）"}</p>
    ${inf.metro ? `<p>🚇 ${esc(inf.metro)}</p>` : ""}${inf.ticket ? `<p>🎫 ${esc(inf.ticket)}</p>` : ""}${inf.hours ? `<p>🕘 ${esc(inf.hours)}</p>` : ""}${inf.tip ? `<p>💡 ${esc(inf.tip)}</p>` : ""}
    ${inf.indoor ? '<p style="color:#2980b9">☔ 雨天也适合</p>' : ""}
    <div class="ops">
      <button onclick="addToMy('${s.id}')">➕ 加入我的路线</button>
      <button onclick="toggleFav('${s.id}')">${s.fav ? "取消想去" : "⭐ 想去"}</button>
      <button onclick="window.open('${amap}')">高德导航</button>
      <button onclick="editSpot('${s.id}')">编辑</button>
      <button onclick="delSpot('${s.id}')" style="color:#c0392b">删除</button>
    </div>
    <p style="font-size:10px;color:#aaa;margin:6px 0 0">可直接拖动标记微调位置</p></div>`;
}
const markers = {};
function render() {
  markerLayer.clearLayers();
  const list = $("list"); list.innerHTML = "";
  const vis = spots.filter(visible);
  vis.forEach(s => {
    const m = L.marker([s.lat, s.lng], { icon: icon(s), draggable: true, title: s.name, riseOnHover: true })
      .bindPopup(popupHtml(s), { maxWidth: 280 })
      .bindTooltip(s.name, { permanent: true, direction: "right", offset: [10, s.cat === "美食" ? 0 : -16], className: "label" });
    m.on("dragend", e => { const p = e.target.getLatLng(); s.lat = +p.lat.toFixed(6); s.lng = +p.lng.toFixed(6); save(); m.setPopupContent(popupHtml(s)); toast("位置已更新"); });
    m.addTo(markerLayer); markers[s.id] = m;
    const it = document.createElement("div"); it.className = "item";
    it.innerHTML = `<span class="dot" style="background:${colorOf(s)}"></span>${CATS[s.cat] || "📍"} ${s.fav ? "⭐" : ""}${esc(s.name)}${s.top ? " 🔥" : ""}
      <span class="meta">${esc(s.district)}</span><button class="mini add" title="加入我的路线">＋</button>`;
    it.onclick = () => focusSpot(s);
    it.querySelector(".add").onclick = e => { e.stopPropagation(); addToMy(s.id); };
    list.appendChild(it);
  });
  $("count").textContent = `共 ${spots.length} 个地点（美食 ${spots.filter(s => s.cat === "美食").length}），当前显示 ${vis.length} 个`;
  updateLabels();
}
function focusSpot(s) {
  if (!markers[s.id] || !markerLayer.hasLayer(markers[s.id])) { filterD.add(s.district in DISTRICTS ? s.district : "其他"); filterC.add(s.cat); onlyFav = onlyTop = false; keyword = ""; renderChips(); render(); }
  map.flyTo([s.lat, s.lng], 16); setTimeout(() => markers[s.id] && markers[s.id].openPopup(), 650);
}
function updateLabels() { const show = map.getZoom() >= 15; markerLayer.eachLayer(m => show ? m.openTooltip() : m.closeTooltip()); }
map.on("zoomend", updateLabels);

// ================= 增删改 =================
const dlg = $("dlg");
$("fCat").innerHTML = Object.keys(CATS).map(c => `<option>${c}</option>`).join("");
$("fCat").onchange = () => { $("foodFields").style.display = $("fCat").value === "美食" ? "block" : "none"; };
function openDialog(init, onOk) {
  $("dlgTitle").textContent = init.id ? "编辑地点" : "添加地点";
  $("fName").value = init.name || ""; $("fDistrict").value = init.district || guessDistrict(init.lng, init.lat);
  $("fCat").value = init.cat || "景点"; $("fDesc").value = init.desc || ""; $("fStay").value = init.stay || "";
  $("fDish").value = init.dish || ""; $("fPrice").value = init.price || ""; $("fTop").checked = !!init.top;
  $("fCat").onchange();
  dlg.returnValue = ""; dlg.showModal();
  dlg.onclose = () => {
    if (dlg.returnValue !== "ok" || !$("fName").value.trim()) return;
    const v = { name: $("fName").value.trim(), district: $("fDistrict").value, cat: $("fCat").value, desc: $("fDesc").value.trim(),
      stay: +$("fStay").value || undefined, top: $("fTop").checked || undefined };
    if (v.cat === "美食") { v.dish = $("fDish").value.trim() || undefined; v.price = $("fPrice").value.trim() || undefined; }
    onOk(v);
  };
}
function inPoly(pt, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
  const [xi, yi] = ring[i], [xj, yj] = ring[j];
  if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
function guessDistrict(lng, lat) {
  for (const [n, geo] of Object.entries(districtGeo)) for (const f of geo.features || []) {
    const g = f.geometry; const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    if (polys.some(p => inPoly([lng, lat], p[0]))) return n;
  }
  return "其他";
}
function addSpot(lng, lat, preset = {}) {
  openDialog({ ...preset, lng, lat }, v => {
    const s = { id: newId(), ...v, lng: +lng.toFixed(6), lat: +lat.toFixed(6), user: true };
    spots.push(s); save(); filterD.add(s.district in DISTRICTS ? s.district : "其他"); filterC.add(s.cat); renderChips(); render(); focusSpot(s);
  });
}
window.editSpot = id => { const s = spots.find(x => x.id === id); if (!s) return; map.closePopup();
  openDialog(s, v => { Object.assign(s, v); save(); renderChips(); render(); }); };
window.delSpot = id => { const s = spots.find(x => x.id === id); if (!s || !confirm(`确定删除「${s.name}」？`)) return;
  spots = spots.filter(x => x.id !== id); save(); render(); };
window.toggleFav = id => { const s = spots.find(x => x.id === id); if (!s) return; s.fav = !s.fav; save(); render(); toast(s.fav ? "已加入想去 ⭐" : "已取消"); focusSpot(s); };

let addMode = false;
$("btnAddMode").onclick = () => { addMode = !addMode; $("btnAddMode").classList.toggle("active", addMode); $("tip").style.display = addMode ? "block" : "none"; map.getContainer().style.cursor = addMode ? "crosshair" : ""; };
map.on("click", e => { if (addMode) addSpot(e.latlng.lng, e.latlng.lat); });

// ================= 搜索 =================
const q = $("q"), results = $("results");
q.addEventListener("input", () => { keyword = q.value.trim(); results.innerHTML = ""; render(); });
q.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
$("btnSearch").onclick = doSearch;
let tempMarker = null;
async function doSearch() {
  const k = q.value.trim(); if (!k) return;
  results.innerHTML = "<div>搜索中…</div>";
  try {
    const url = "https://photon.komoot.io/api/?limit=8&lat=23.125&lon=113.29&bbox=113.0,22.8,113.7,23.5&q=" + encodeURIComponent(k);
    const fc = await (await fetch(url)).json();
    results.innerHTML = "";
    if (!(fc.features || []).length) { results.innerHTML = "<div>没有找到，可换个叫法，或用「点地图添加」手动标注</div>"; return; }
    fc.features.forEach(f => {
      const p = f.properties || {}; const name = p.name || p.street || k;
      const addr = [p.street, p.district, p.city].filter(Boolean).join(", ");
      const [lng, lat] = wgs2gcj(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      const d = document.createElement("div"); d.innerHTML = `🔍 <b>${esc(name)}</b> <span style="color:#999">${esc(addr)}</span>`;
      d.onclick = () => {
        if (tempMarker) map.removeLayer(tempMarker);
        tempMarker = L.marker([lat, lng], { icon: L.divIcon({ className: "", html: '<div class="pin" style="background:#8e44ad"><span>🔍</span></div>', iconSize: [26, 26], iconAnchor: [13, 30], popupAnchor: [0, -28] }) }).addTo(map);
        const box = document.createElement("div"); box.innerHTML = `<b>${esc(name)}</b><br>`;
        const b = document.createElement("button"); b.textContent = "➕ 加入我的地点"; box.appendChild(b);
        b.onclick = () => { map.removeLayer(tempMarker); tempMarker = null; addSpot(lng, lat, { name }); };
        tempMarker.bindPopup(box).openPopup(); map.flyTo([lat, lng], 16);
      };
      results.appendChild(d);
    });
  } catch (e) { results.innerHTML = "<div>在线搜索失败（网络问题），可用「点地图添加」手动标注</div>"; }
}

// ================= 路线计算（OSRM，失败时直线估算） =================
const routeCache = lsGet(LS.cache, {});
async function computeLegs(stops, mode) {
  if (stops.length < 2) return [];
  const key = mode + "|" + stops.map(s => s.lng.toFixed(5) + "," + s.lat.toFixed(5)).join(";");
  if (routeCache[key]) return routeCache[key];
  try {
    const coords = stops.map(s => gcj2wgs(s.lng, s.lat).map(v => v.toFixed(6)).join(",")).join(";");
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`https://routing.openstreetmap.de/${MODES[mode].osrm}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson`, { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await res.json(); if (j.code !== "Ok") throw new Error(j.code);
    const legs = j.routes[0].legs.map(l => {
      const g = []; l.steps.forEach(st => st.geometry.coordinates.forEach(([x, y]) => {
        const [a, b] = wgs2gcj(x, y); const p = [+b.toFixed(5), +a.toFixed(5)];
        const last = g[g.length - 1]; if (!last || last[0] !== p[0] || last[1] !== p[1]) g.push(p); }));
      return { d: Math.round(l.distance), t: Math.round(l.duration), g, ok: true };
    });
    routeCache[key] = legs;
    if (JSON.stringify(routeCache).length > 3e6) for (const k in routeCache) delete routeCache[k];
    lsSet(LS.cache, routeCache);
    return legs;
  } catch (e) {
    toast("在线路线服务暂不可用，已用直线距离估算");
    return stops.slice(1).map((s, i) => { const a = stops[i]; const d = Math.round(dist(a, s) * 1.3);
      return { d, t: Math.round(d / MODES[mode].speed), g: [[a.lat, a.lng], [s.lat, s.lng]], ok: false }; });
  }
}
// 一段路的实际耗时（分钟）：步行过远时按地铁/打车估算
function legMinutes(leg, mode) { return (mode === "foot" && leg.d > FAR) ? 15 + leg.d / 400 : leg.t / 60; }
function legHtml(leg, mode, a, b) {
  const far = mode === "foot" && leg.d > FAR;
  const amode = far ? "bus" : MODES[mode].amap;
  const nav = `https://uri.amap.com/navigation?from=${a.lng},${a.lat},${encodeURIComponent(a.name)}&to=${b.lng},${b.lat},${encodeURIComponent(b.name)}&mode=${amode}&coordinate=gaode&callnative=1`;
  const txt = far ? `🚇 ${fmtDist(leg.d)} · 建议地铁/打车 约 ${fmtMin(legMinutes(leg, mode))}` : `${mode === "foot" ? "🚶" : mode === "bike" ? "🚲" : "🚗"} ${fmtDist(leg.d)} · ${fmtMin(leg.t / 60)}${leg.ok ? "" : "（估算）"}`;
  return `<div class="leg${far ? " far" : ""}">${txt} <a href="${nav}" target="_blank">导航</a></div>`;
}
function drawLegs(layer, stops, legs, color, mode, clickable) {
  layer.clearLayers();
  legs.forEach(leg => {
    const far = mode === "foot" && leg.d > FAR;
    L.polyline(leg.g, { color: "#fff", weight: 8, opacity: .8, interactive: false }).addTo(layer);
    L.polyline(leg.g, { color, weight: 5, opacity: .9, dashArray: far ? "2 9" : (leg.ok ? null : "8 6"), lineCap: "round" })
      .bindTooltip(far ? `${fmtDist(leg.d)}，建议地铁/打车` : `${fmtDist(leg.d)} · ${fmtMin(leg.t / 60)}`, { sticky: true }).addTo(layer);
  });
  stops.forEach((s, i) => {
    const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: "", html: `<div class="num" style="background:${color}">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 1000 })
      .bindTooltip(`${i + 1}. ${s.name}`, { direction: "top", offset: [0, -10] }).addTo(layer);
    if (clickable) m.on("click", () => { const sp = spotByName(s.name); if (sp && sp.id && spots.includes(sp)) focusSpot(sp); });
  });
}
function summaryHtml(stops, legs, mode) {
  const d = legs.reduce((a, l) => a + l.d, 0), travel = legs.reduce((a, l) => a + legMinutes(l, mode), 0);
  const stay = stops.reduce((a, s) => a + stayOf(spotByName(s.name) || s), 0);
  const far = legs.filter(l => mode === "foot" && l.d > FAR).length;
  return `<div class="summary">📍 ${stops.length} 站 · 总路程 ${fmtDist(d)}<br>🕒 路上约 ${fmtMin(travel)} + 游玩约 ${fmtMin(stay)} = <b>约 ${fmtMin(travel + stay)}</b>
    ${far ? `<br>🚇 其中 ${far} 段距离较远，建议地铁/打车` : ""}</div>`;
}

// 时间表：每站到达 / 离开时间（分钟数）
function timesFor(stops, legs, mode, start) {
  let t = start; return stops.map((s, i) => {
    const arr = t, dep = t + stayOf(spotByName(s.name) || s);
    t = dep + (legs[i] ? legMinutes(legs[i], mode) : 0); return { arr, dep };
  });
}
// 某天天气 + 穿衣 + 针对路线的提醒
function wxAdvice(day, stops, times) {
  if (!day) return null;
  const c = GZW.clothing(day), warn = [];
  if (GZW.isRainy(day)) {
    const out = stops.filter(s => { const sp = spotByName(s.name); return !(INFO[s.name] || {}).indoor && !(sp && sp.cat === "美食"); }).map(s => s.name);
    if (out.length) warn.push(`🌧️ 可能下雨，这些户外点会淋雨：${out.slice(0, 5).join("、")}${out.length > 5 ? " 等" : ""}，可换成博物馆 / 商场 / 茶楼`);
  }
  if (day.week === "周一") {
    const closed = stops.filter(s => /周一闭馆/.test((INFO[s.name] || {}).hours || "")).map(s => s.name);
    if (closed.length) warn.push(`🚫 这天是周一，${closed.join("、")} 可能闭馆`);
  }
  const tower = stops.findIndex(s => s.name.includes("广州塔"));
  if (tower >= 0 && times && day.sunset) {
    const sun = parseClock(day.sunset), at = times[tower].arr;
    if (at > sun + 30) warn.push(`🌇 日落约 ${day.sunset}，到广州塔已是夜景；想看日落请提前出发`);
    else if (at < sun - 150) warn.push(`🌇 日落约 ${day.sunset}，到广州塔偏早，可以把它往后排`);
  }
  return { day, c, warn, line: `${day.wd} ${day.md} ${day.icon} ${day.text} ${day.tmin}–${day.tmax}°C · 降雨 ${day.rain}%` };
}
function wxAdviceHtml(a) {
  if (!a) return "";
  return `<div class="summary" style="background:#eaf5fd"><b>${a.line}</b><br>👕 ${a.c.wear}
    ${a.c.items.slice(0, 3).map(t => "<br>" + t).join("")}<br>${GZW.activity(a.day)}
    ${a.warn.map(w => `<br><b style="color:#c0392b">${w}</b>`).join("")}</div>`;
}
// 把路线导出成一张长图（方便发微信群）
function exportImage({ title, sub, stops, legs, times, mode, wx }) {
  const W = 750, rowH = 62, legH = 30, head = 150, wxH = wx ? 50 + (wx.c.items.slice(0, 3).length + 2) * 26 + wx.warn.length * 52 : 0;
  const H = head + wxH + stops.length * rowH + legs.length * legH + 90;
  const cv = document.createElement("canvas"); const k = 2; cv.width = W * k; cv.height = H * k;
  const g = cv.getContext("2d"); g.scale(k, k);
  const F = (s, w = "normal") => `${w} ${s}px "PingFang SC","Microsoft YaHei",sans-serif`;
  g.fillStyle = "#fffaf3"; g.fillRect(0, 0, W, H);
  const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, "#c0392b"); gr.addColorStop(1, "#e67e22");
  g.fillStyle = gr; g.fillRect(0, 0, W, head - 20);
  g.fillStyle = "#fff"; g.font = F(16); g.fillText("💕 和宝宝的100天旅游", 32, 40);
  g.font = F(32, "bold"); g.fillText(title.slice(0, 20), 32, 84);
  g.font = F(16); g.fillText(sub, 32, 114);
  let y = head;
  const wrap = (text, x, maxW, lh) => { let line = ""; for (const ch of text) { if (g.measureText(line + ch).width > maxW) { g.fillText(line, x, y); y += lh; line = ch; } else line += ch; } if (line) { g.fillText(line, x, y); y += lh; } };
  if (wx) {
    g.fillStyle = "#eaf5fd"; g.fillRect(20, y - 10, W - 40, wxH - 10);
    g.fillStyle = "#1b4f72"; g.font = F(17, "bold"); y += 18; g.fillText(wx.line, 36, y); y += 26; g.font = F(15);
    wrap("👕 " + wx.c.wear, 36, W - 80, 26); wx.c.items.slice(0, 3).forEach(t => wrap(t, 36, W - 80, 26));
    g.fillStyle = "#c0392b"; wx.warn.forEach(t => wrap(t, 36, W - 80, 26)); y = head + wxH;
  }
  stops.forEach((s, i) => {
    g.fillStyle = "#d35400"; g.beginPath(); g.arc(48, y + 22, 16, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.font = F(15, "bold"); g.textAlign = "center"; g.fillText(i + 1, 48, y + 27); g.textAlign = "left";
    g.fillStyle = "#222"; g.font = F(20, "bold"); g.fillText(s.name.slice(0, 22), 80, y + 22);
    g.fillStyle = "#888"; g.font = F(14);
    const inf = INFO[s.name] || {};
    g.fillText(`${times ? clock(times[i].arr) + "–" + clock(times[i].dep) + "  " : ""}${inf.metro ? "🚇 " + inf.metro : ""}`.slice(0, 46), 80, y + 46);
    y += rowH;
    if (legs[i]) {
      const l = legs[i], far = mode === "foot" && l.d > FAR;
      g.strokeStyle = "#ccc"; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(48, y - 22); g.lineTo(48, y + legH - 4); g.stroke(); g.setLineDash([]);
      g.fillStyle = far ? "#d35400" : "#999"; g.font = F(13);
      g.fillText(far ? `🚇 ${fmtDist(l.d)} · 建议地铁/打车 约 ${fmtMin(legMinutes(l, mode))}` : `${MODES[mode].label} ${fmtDist(l.d)} · ${fmtMin(l.t / 60)}`, 80, y + 12);
      y += legH;
    }
  });
  const d = legs.reduce((a, l) => a + l.d, 0);
  g.fillStyle = "#555"; g.font = F(15); g.fillText(`共 ${stops.length} 站 · 总路程 ${fmtDist(d)}${times ? " · 预计 " + clock(times[times.length - 1].dep) + " 结束" : ""}`, 32, y + 30);
  g.fillStyle = "#aaa"; g.font = F(12); g.fillText("地点与时间为估算，仅供参考 · 地图 © 高德 · 路线 © OpenStreetMap", 32, y + 58);
  cv.toBlob(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = title.replace(/[\\/:*?"<>|]/g, "") + ".png"; a.click(); toast("图片已导出"); });
}

// ================= 推荐路线（攻略） =================
function routeStops(r) { return r.stops.map(n => spotByName(n)).filter(Boolean).map(s => ({ name: s.name, lng: s.lng, lat: s.lat })); }
let openRoute = null;
function renderRouteCards() {
  const box = $("routeList"); box.innerHTML = "";
  ROUTES.forEach(r => {
    const c = document.createElement("div"); c.className = "rcard"; c.style.borderLeftColor = r.color; c.id = "rc_" + r.id;
    c.innerHTML = `<h4 style="color:${r.color}">${esc(r.name)}</h4><div class="dur">🕒 ${esc(r.duration)} · 📍 ${esc(r.area)} · ${r.stops.length} 站</div>
      <p>${esc(r.summary)}</p><div class="detail"></div>
      <div class="row"><button class="primary b-show">${openRoute === r.id ? "收起" : "在地图上查看"}</button><button class="b-copy">复制到我的路线修改</button>
      <button class="b-hide">隐藏图层</button></div>`;
    c.querySelector("h4").onclick = c.querySelector(".b-show").onclick = () => { if (openRoute === r.id) { openRoute = null; renderRouteCards(); } else showRoute(r.id, true); };
    c.querySelector(".b-copy").onclick = () => { setCur({ name: r.name + "（我的版本）", mode: "foot", stops: routeStops(r), date: cur.date, start: r.start || cur.start }); switchTab("my"); toast("已复制，可以自由增删调整"); };
    c.querySelector(".b-hide").onclick = () => { map.removeLayer(routeLayers[r.id]); if (openRoute === r.id) { openRoute = null; renderRouteCards(); } };
    box.appendChild(c);
  });
}
async function showRoute(id, focus) {
  const r = ROUTES.find(x => x.id === id); if (!r) return;
  const stops = routeStops(r), layer = routeLayers[id];
  layer._busy = true;
  if (!map.hasLayer(layer)) layer.addTo(map);
  if (focus) { openRoute = id; renderRouteCards(); switchTab("routes"); document.getElementById("rc_" + id).scrollIntoView({ behavior: "smooth", block: "start" }); }
  const det = focus && document.querySelector(`#rc_${id} .detail`); if (det) det.innerHTML = '<p class="muted">正在规划路线…</p>';
  const legs = await computeLegs(stops, "foot");
  drawLegs(layer, stops, legs, r.color, "foot", true);
  layer._busy = false;
  if (focus) {
    map.flyToBounds(L.latLngBounds(stops.map(s => [s.lat, s.lng])), { padding: [40, 40] });
    const times = timesFor(stops, legs, "foot", parseClock(r.start));
    let h = `<p class="muted">按 ${r.start || "09:00"} 出发估算的时间表：</p><div class="stops">`;
    stops.forEach((s, i) => { h += `<div class="stop"><span class="n" style="background:${r.color}">${i + 1}</span><span class="nm" data-n="${esc(s.name)}">${esc(s.name)}</span><span class="muted">${clock(times[i].arr)}–${clock(times[i].dep)}</span></div>`;
      if (legs[i]) h += legHtml(legs[i], "foot", s, stops[i + 1]); });
    h += "</div>" + summaryHtml(stops, legs, "foot") + `<ul>${r.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul><button class="b-img">🖼️ 导出成图片</button>`;
    const d2 = document.querySelector(`#rc_${id} .detail`); if (!d2) return; d2.innerHTML = h;
    d2.querySelector(".b-img").onclick = () => exportImage({ title: r.name, sub: `${r.duration} · ${r.start || "09:00"} 出发`, stops, legs, times, mode: "foot", wx: null });
    d2.querySelectorAll(".nm").forEach(el => el.onclick = () => { const sp = spotByName(el.dataset.n); if (sp && spots.includes(sp)) focusSpot(sp); else if (sp) map.flyTo([sp.lat, sp.lng], 16); });
  }
}
$("btnAllRoutes").onclick = () => ROUTES.forEach(r => showRoute(r.id, false));
$("btnNoRoutes").onclick = () => { ROUTES.forEach(r => map.removeLayer(routeLayers[r.id])); openRoute = null; renderRouteCards(); };

// ================= 我的路线 =================
let cur = lsGet(LS.cur, null) || { name: "我的广州路线", mode: "foot", stops: [] };
let curLegs = [];
function setCur(r) { cur = r; lsSet(LS.cur, cur); renderMy(); planMy(); }
window.addToMy = id => {
  const s = spots.find(x => x.id === id); if (!s) return;
  cur.stops.push({ name: s.name, lng: s.lng, lat: s.lat }); lsSet(LS.cur, cur); renderMy(); planMy();
  toast(`已加入「${cur.name}」（共 ${cur.stops.length} 站）`);
};
let planTimer = null, planSeq = 0;
function planMy() {
  clearTimeout(planTimer);
  planTimer = setTimeout(async () => {
    const seq = ++planSeq;
    if (cur.stops.length < 2) { curLegs = []; myLayer.clearLayers(); if (cur.stops.length === 1) drawLegs(myLayer, cur.stops, [], "#d35400", cur.mode); renderMy(); return; }
    $("myStatus").textContent = "正在规划…";
    const legs = await computeLegs(cur.stops, cur.mode);
    if (seq !== planSeq) return;
    curLegs = legs; if (!map.hasLayer(myLayer)) myLayer.addTo(map);
    drawLegs(myLayer, cur.stops, legs, "#d35400", cur.mode, true); renderMy();
  }, 400);
}
function renderMy() {
  $("myName").value = cur.name; $("myMode").value = cur.mode; $("myStart").value = cur.start || "09:00";
  if (cur.date && !wxDay(cur.date) && WXDAYS.length) cur.date = "";
  $("myDate").value = cur.date || "";
  const ready = cur.stops.length === 1 || (curLegs.length && curLegs.length === cur.stops.length - 1);
  const times = ready ? timesFor(cur.stops, curLegs, cur.mode, parseClock(cur.start)) : null;
  const box = $("myStops"); box.innerHTML = "";
  if (!cur.stops.length) box.innerHTML = '<p class="muted">还没有站点：在「景点」列表点 ＋，或在地图弹窗点「加入我的路线」，也可以用上面的一键生成。</p>';
  cur.stops.forEach((s, i) => {
    const d = document.createElement("div"); d.className = "stop";
    d.innerHTML = `<span class="n" style="background:#d35400">${i + 1}</span><span class="nm">${esc(s.name)}</span>
      ${times ? `<span class="muted">${clock(times[i].arr)}–${clock(times[i].dep)}</span>` : ""}
      <button class="mini" data-a="up" title="上移">↑</button><button class="mini" data-a="down" title="下移">↓</button><button class="mini" data-a="del" title="移除">✕</button>`;
    d.querySelector(".nm").onclick = () => map.flyTo([s.lat, s.lng], 16);
    d.querySelectorAll("button").forEach(b => b.onclick = () => {
      const a = b.dataset.a, st = cur.stops;
      if (a === "up" && i > 0) [st[i - 1], st[i]] = [st[i], st[i - 1]];
      if (a === "down" && i < st.length - 1) [st[i + 1], st[i]] = [st[i], st[i + 1]];
      if (a === "del") st.splice(i, 1);
      lsSet(LS.cur, cur); renderMy(); planMy();
    });
    box.appendChild(d);
    if (curLegs[i] && cur.stops[i + 1]) box.insertAdjacentHTML("beforeend", legHtml(curLegs[i], cur.mode, s, cur.stops[i + 1]));
  });
  const wx = cur.stops.length ? wxAdvice(wxDay(cur.date), cur.stops, times) : null;
  $("mySummary").innerHTML = (curLegs.length && curLegs.length === cur.stops.length - 1 ? summaryHtml(cur.stops, curLegs, cur.mode) : "")
    + (times && times.length ? `<div class="muted" style="margin-top:4px">⏰ ${clock(times[0].arr)} 出发，预计 ${clock(times[times.length - 1].dep)} 结束</div>` : "")
    + wxAdviceHtml(wx);
  renderMy._last = { times, wx };
  $("myStatus").textContent = "";
  renderSaved();
}
$("myName").oninput = () => { cur.name = $("myName").value; lsSet(LS.cur, cur); };
$("myMode").onchange = () => { cur.mode = $("myMode").value; lsSet(LS.cur, cur); planMy(); };
$("myStart").onchange = () => { cur.start = $("myStart").value || "09:00"; lsSet(LS.cur, cur); renderMy(); };
$("myDate").onchange = () => { cur.date = $("myDate").value; lsSet(LS.cur, cur); renderMy(); };
$("btnMyImg").onclick = () => {
  if (!cur.stops.length) return toast("路线还是空的");
  const { times, wx } = renderMy._last || {}; const d = wxDay(cur.date);
  exportImage({ title: cur.name, sub: `${d ? d.md + " " + d.week + " · " : ""}${cur.start || "09:00"} 出发 · ${MODES[cur.mode].label}`, stops: cur.stops, legs: curLegs, times, mode: cur.mode, wx });
};
// 天气：填充日期下拉 + 顶部小组件
GZW.getForecast().then(data => {
  WXDAYS = GZW.days(data);
  $("myDate").innerHTML = '<option value="">不指定日期</option>' + WXDAYS.map(d => `<option value="${d.date}">${d.wd} ${d.md} ${d.icon} ${d.tmin}–${d.tmax}° 💧${d.rain}%</option>`).join("");
  const t = WXDAYS[0];
  $("wxMini").innerHTML = `${t.icon} ${t.tmin}–${t.tmax}°C`; $("wxMini").title = `今天${t.text}，降雨概率 ${t.rain}%，${GZW.clothing(t).wear}。点击查看 10 天天气`;
  renderMy();
}).catch(() => { $("wxMini").textContent = "🌤️ 天气"; });
$("btnMyClear").onclick = () => { if (cur.stops.length && !confirm("清空当前路线的所有站点？")) return; cur.stops = []; curLegs = []; lsSet(LS.cur, cur); myLayer.clearLayers(); renderMy(); };
$("btnMyFit").onclick = () => { if (cur.stops.length) map.flyToBounds(L.latLngBounds(cur.stops.map(s => [s.lat, s.lng])), { padding: [40, 40] }); };
$("btnMyOpt").onclick = () => { if (cur.stops.length < 3) return toast("至少 3 个站点才需要优化"); cur.stops = optimizeOrder(cur.stops, $("optKeepEnd").checked); lsSet(LS.cur, cur); renderMy(); planMy(); toast("已按最短路程重新排序（起点不变）"); };

// 路线顺序优化：最近邻 + 2-opt（起点固定，可选终点固定）
function optimizeOrder(stops, keepEnd) {
  const first = stops[0], last = keepEnd ? stops[stops.length - 1] : null;
  let rest = stops.slice(1, keepEnd ? -1 : undefined), path = [first];
  while (rest.length) { const c = path[path.length - 1]; let bi = 0;
    rest.forEach((s, i) => { if (dist(c, s) < dist(c, rest[bi])) bi = i; }); path.push(rest.splice(bi, 1)[0]); }
  if (last) path.push(last);
  const len = p => p.slice(1).reduce((a, s, i) => a + dist(p[i], s), 0);
  let improved = true, guard = 0;
  while (improved && guard++ < 200) { improved = false;
    for (let i = 1; i < path.length - 2; i++) for (let k = i + 1; k < path.length - (last ? 1 : 0); k++) {
      const np = path.slice(0, i).concat(path.slice(i, k + 1).reverse(), path.slice(k + 1));
      if (len(np) < len(path) - 1) { path = np; improved = true; } } }
  return path;
}

// 一键自动规划
function travelMin(a, b) { const d = dist(a, b) * 1.3; return d <= FAR ? d / 70 : 15 + d / 400; }
function autoPlan() {
  const area = $("apArea").value, budget = +$("apTime").value, withFood = $("apFood").checked, topOnly = $("apTop").checked;
  const inArea = s => area === "all" ? MAIN3.includes(s.district) || s.district === "其他" : s.district === area;
  const day = wxDay(cur.date), rainy = day && GZW.isRainy(day), monday = day && day.week === "周一";
  const indoor = s => !!(INFO[s.name] || {}).indoor;
  let sights = spots.filter(s => inArea(s) && s.cat !== "美食" && stayOf(s) < 150 && (!topOnly || s.top)
    && !(monday && /周一闭馆/.test((INFO[s.name] || {}).hours || "")) && !(rainy && s.cat === "公园"));
  const foods = spots.filter(s => inArea(s) && s.cat === "美食");
  if (!sights.length) return toast("这个区域没有可选的景点");
  const meals = withFood ? (budget >= 360 ? 2 : 1) : 0;
  let left = budget - meals * 60;
  // 起点：我的位置 / 最靠边的必去景点（这样路线是“扫过去”而不是来回跑）
  let start;
  if ($("apStart").value === "me" && myLoc) start = myLoc;
  else {
    let pool = sights.filter(s => s.top).length ? sights.filter(s => s.top) : sights;
    if (rainy && pool.some(indoor)) pool = pool.filter(indoor);
    if (pool.length > 1) pool = pool.filter(s => !s.name.includes("广州塔")); // 广州塔留到傍晚
    const cx = pool.reduce((a, s) => a + s.lng, 0) / pool.length, cy = pool.reduce((a, s) => a + s.lat, 0) / pool.length;
    start = pool.reduce((b, s) => dist(s, { lng: cx, lat: cy }) > dist(b, { lng: cx, lat: cy }) ? s : b, pool[0]);
  }
  const path = []; let curP = start, rest = sights.slice();
  if (start !== myLoc) { path.push(start); left -= stayOf(start); rest = rest.filter(s => s !== start); }
  while (rest.length) {
    let best = null, bestCost = Infinity;
    rest.forEach(s => { const t = travelMin(curP, s); const cost = t - (s.top ? 12 : 0) - (rainy && indoor(s) ? 20 : 0); if (t + stayOf(s) <= left && cost < bestCost) { best = s; bestCost = cost; } });
    if (!best) break;
    left -= travelMin(curP, best) + stayOf(best); path.push(best); curP = best; rest = rest.filter(s => s !== best);
  }
  // 广州塔适合傍晚看日落和夜景，挪到最后
  const ti = path.findIndex(s => s.name.includes("广州塔"));
  if (ti >= 0 && ti < path.length - 1) path.push(path.splice(ti, 1)[0]);
  // 插入餐饮：午饭放在约 40% 处，晚饭/甜品放在最后
  const used = new Set();
  const nearestFood = p => { let b = null; foods.forEach(f => { if (!used.has(f) && (!b || dist(p, f) < dist(p, b))) b = f; }); if (b) used.add(b); return b; };
  if (meals >= 1 && path.length) { const i = Math.max(1, Math.round(path.length * 0.4)); const f = nearestFood(path[i - 1]); if (f) path.splice(i, 0, f); }
  if (meals >= 2 && path.length) { const f = nearestFood(path[path.length - 1]); if (f) path.push(f); }
  const stops = (start === myLoc ? [myLoc] : []).concat(path).map(s => ({ name: s.name, lng: s.lng, lat: s.lat }));
  const label = { all: "三区精华", "荔湾区": "荔湾", "越秀区": "越秀", "天河区": "天河" }[area];
  setCur({ name: `自动规划 · ${label} ${budget / 60} 小时${day ? " · " + day.md : ""}`, mode: "foot", stops, date: cur.date, start: cur.start });
  setTimeout(() => $("btnMyFit").click(), 500);
  toast(`已生成 ${stops.length} 站路线${rainy ? "（雨天，已优先室内）" : ""}${monday ? "（周一，已避开闭馆场馆）" : ""}`);
}
$("btnAuto").onclick = () => { if ($("apStart").value === "me" && !myLoc) locate(() => autoPlan()); else autoPlan(); };

// 保存 / 分享
function getSaved() { return lsGet(LS.my, []); }
$("btnMySave").onclick = () => {
  if (!cur.stops.length) return toast("路线还是空的");
  const arr = getSaved().filter(r => r.name !== cur.name); arr.unshift(clone(cur)); lsSet(LS.my, arr); renderSaved(); toast("已保存：" + cur.name);
};
$("btnMyNew").onclick = () => { setCur({ name: "新路线 " + new Date().toLocaleDateString(), mode: "foot", stops: [], date: cur.date, start: cur.start }); };
function shareUrl(r) {
  const data = { n: r.name, m: r.mode, d: r.date || "", t: r.start || "", s: r.stops.map(s => [s.name, +s.lng.toFixed(5), +s.lat.toFixed(5)]) };
  return location.href.split("#")[0] + "#share=" + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(data)))));
}
function copyText(t) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast("分享链接已复制")).catch(() => prompt("复制下面的链接：", t)); }
$("btnMyShare").onclick = () => { if (!cur.stops.length) return toast("路线还是空的"); copyText(shareUrl(cur)); };
function renderSaved() {
  const box = $("savedList"), arr = getSaved(); box.innerHTML = arr.length ? "" : '<p class="muted">暂无已保存路线</p>';
  arr.forEach((r, i) => {
    const d = document.createElement("div"); d.className = "saved";
    d.innerHTML = `<span>${esc(r.name)} <span class="muted">${r.stops.length} 站 · ${MODES[r.mode]?.label || ""}</span></span>
      <button class="mini" data-a="load">打开</button><button class="mini" data-a="share">分享</button><button class="mini" data-a="del">删除</button>`;
    d.querySelectorAll("button").forEach(b => b.onclick = () => {
      if (b.dataset.a === "load") { setCur(clone(r)); setTimeout(() => $("btnMyFit").click(), 500); }
      if (b.dataset.a === "share") copyText(shareUrl(r));
      if (b.dataset.a === "del" && confirm(`删除「${r.name}」？`)) { arr.splice(i, 1); lsSet(LS.my, arr); renderSaved(); }
    });
    box.appendChild(d);
  });
}

// ================= 导入导出 =================
$("btnExport").onclick = () => {
  const blob = new Blob([JSON.stringify({ spots, myRoutes: getSaved() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "guangzhou_travel_backup.json"; a.click();
};
$("btnImport").onclick = () => $("fileInput").click();
$("fileInput").onchange = () => {
  const f = $("fileInput").files[0]; if (!f) return;
  f.text().then(t => { const o = JSON.parse(t); const arr = Array.isArray(o) ? o : o.spots; if (!Array.isArray(arr)) throw 0;
    spots = withIds(arr); save(); if (Array.isArray(o.myRoutes)) lsSet(LS.my, o.myRoutes);
    renderChips(); render(); renderSaved(); alert(`已导入 ${arr.length} 个地点`); }).catch(() => alert("文件格式不正确"));
  $("fileInput").value = "";
};
$("btnReset").onclick = () => {
  if (!confirm("恢复默认地点？你新增/删除/修改的地点会被清除（已保存的路线保留），建议先导出备份")) return;
  localStorage.removeItem(LS.spots); localStorage.removeItem(LS.seen); spots = loadSpots(); save(); renderChips(); render();
};

// ================= 离线地图：预先缓存三区核心范围的瓦片 =================
$("btnOffline").onclick = async () => {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return toast("离线功能需要部署成网站（https）后使用，本地双击打开时不可用");
  const [W, S, E, N] = [113.22, 23.095, 113.38, 23.165];
  const tx = (lng, z) => Math.floor((lng + 180) / 360 * 2 ** z);
  const ty = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
  const urls = [];
  for (let z = 11; z <= 16; z++) for (let x = tx(W, z); x <= tx(E, z); x++) for (let y = ty(N, z); y <= ty(S, z); y++)
    urls.push(`https://webrd0${"1234"[Math.abs(x + y) % 4]}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`);
  if (!confirm(`将下载约 ${urls.length} 张地图瓦片（约 ${Math.round(urls.length * 0.015)} MB），覆盖荔湾、越秀、天河核心区域，继续？`)) return;
  let done = 0; const btn = $("btnOffline");
  const worker = async () => { while (urls.length) { const u = urls.pop(); try { await fetch(u, { mode: "cors" }); } catch (e) {} done++; if (done % 20 === 0) btn.textContent = `📥 已缓存 ${done}…`; } };
  await Promise.all(Array.from({ length: 6 }, worker));
  btn.textContent = "📥 离线地图已缓存"; toast("完成！没网时也能看三区地图、攻略、图集和最近一次的天气");
};

// ================= 标签页 & 启动 =================
function switchTab(name) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("on", p.id === "panel_" + name));
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));

renderChips(); render(); renderRouteCards(); renderMy(); planMy();

// 链接参数：#route=yuexiu / #spot=陈家祠 / #share=...
(function handleHash() {
  const h = decodeURIComponent(location.hash.slice(1)); if (!h) return;
  const [k, ...rest] = h.split("="); const v = rest.join("=");
  if (k === "route") setTimeout(() => showRoute(v, true), 300);
  if (k === "date") { cur.date = v; lsSet(LS.cur, cur); switchTab("my"); renderMy(); toast("已选择出行日期，可一键生成路线"); }
  if (k === "spot") { const s = spots.find(x => x.name === v); if (s) setTimeout(() => focusSpot(s), 300); }
  if (k === "share") {
    try { const d = JSON.parse(decodeURIComponent(escape(atob(v))));
      setCur({ name: d.n || "分享的路线", mode: d.m || "foot", date: d.d || "", start: d.t || "09:00", stops: d.s.map(([name, lng, lat]) => ({ name, lng, lat })) });
      switchTab("my"); setTimeout(() => $("btnMyFit").click(), 600); toast("已打开分享的路线，可点「保存」收藏");
    } catch (e) { toast("分享链接无效"); }
  }
})();
