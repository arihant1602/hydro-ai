const $ = (id) => document.getElementById(id);
const fmtTime = (ts) => new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const CARDS = [
  // field, label, unit, stage-range key, decimals
  ["air_temp", "Air temperature", "°C", "air_temp_c", 1],
  ["humidity", "Humidity", "%", "humidity_pct", 0],
  ["water_level_pct", "Reservoir", "%", null, 0],
  ["ph", "pH", "", "ph", 2],
  ["ec", "EC", "mS/cm", "ec_ms_cm", 2],
  ["water_temp", "Water temp", "°C", null, 1],
  ["light_lux", "Light", "lux", null, 0],
  ["soil_raw", "Soil moisture", "raw", null, 0],
];
const SP_LABELS = { air_temp_c: ["Air temp", "°C"], humidity_pct: ["Humidity", "%"], light_hours: ["Light", "h/day"],
  ph: ["pH", ""], ec_ms_cm: ["EC", "mS/cm"] };

function cardState(v, range) {
  if (!range || v == null) return "";
  const [lo, hi] = range, pad = (hi - lo) * 0.25 || 0.5;
  if (v >= lo && v <= hi) return "ok";
  return v >= lo - pad && v <= hi + pad ? "warn" : "bad";
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function renderStatus(s) {
  $("crop").textContent = `· ${s.crop}`;
  $("stageline").textContent = `Day ${s.day} · ${s.stage.name.replace("_", " ")} stage` +
    (s.latest ? ` · last reading ${fmtTime(s.latest.ts)}` : "");
  const on = $("online");
  on.textContent = s.online ? "ESP32 online" : "ESP32 offline";
  on.className = "pill " + (s.online ? "on" : "off");

  $("alerts").innerHTML = s.alerts.map((a) => `<div class="alert ${a.severity}">${a.message}</div>`).join("");

  const L = s.latest || {};
  $("cards").innerHTML = CARDS.filter(([f]) => L[f] != null || f === "air_temp" || f === "humidity").map(([f, label, unit, key, dp]) => {
    const v = L[f], range = key ? s.stage[key] : f === "water_level_pct" ? [s.settings.refill_below_pct, 100] : null;
    const extra = f === "water_level_pct" && L.water_liters != null ? ` · ${L.water_liters.toFixed(1)} L` : "";
    return `<div class="card ${cardState(v, range)}">
      <div class="label">${label}</div>
      <div class="value">${v == null ? "—" : v.toFixed(dp)}<span class="muted small"> ${unit}</span></div>
      <div class="target">${range ? `target ${range[0]}–${range[1]}${unit}` : "&nbsp;"}${extra}</div></div>`;
  }).join("");

  const r = s.recommendation;
  $("rec").innerHTML = `<table><tr><th>Variable</th><th>Setpoint</th><th>Safe range</th><th>Explore</th></tr>` +
    Object.entries(r.setpoints).map(([k, v]) => {
      const [name, unit] = SP_LABELS[k];
      const b = r.bounds[k], off = r.explore_offset[k];
      return `<tr><td>${name}</td><td><b>${v}</b> ${unit}</td><td>${b[0]}–${b[1]}</td><td>${off ? (off > 0 ? "+" : "") + off : ""}</td></tr>`;
    }).join("") + `</table>`;
  $("recnote").textContent = !r.r2 && r.r2 !== 0
    ? `Using biology targets only: ${r.n_days} complete day(s) logged, the model starts after 7.`
    : `Model weight ${Math.round(r.model_weight * 100)}% after ${r.n_days} days (fit R² ${r.r2}, cross-validated R² ${r.cv_r2}), learning ${r.learned_vars.join(", ")}.` +
      (r.model_weight === 0 ? " The model can't yet predict unseen days, so the biology targets stay in charge." : "");

  const acts = s.actuators;
  $("acts").innerHTML = ["fan", "heater", "mister", "light", "refill_pump"].map((a) =>
    `<span class="act ${acts[a] ? "on" : ""}">${a.replace("_", " ")}</span>`).join("") +
    ["ph_down_ms", "ph_up_ms", "nutrient_ms"].filter((a) => acts[a]).map((a) =>
      `<span class="act on">${a.replace("_ms", "")} dose</span>`).join("");

  const su = s.suitability;
  $("suit").innerHTML = su.score == null ? `<span class="muted">${su.note}</span>` :
    `<div class="row"><span>How typical are current conditions for maize in the Kaggle data</span><b>${Math.round(su.score * 100)}%</b></div>
     <div class="bar"><div style="width:${su.score * 100}%"></div></div>
     <span class="muted small">${su.note}</span>`;

  $("bio").textContent = s.stage.biology;
  $("spectrum").textContent = `Light spectrum: ${s.stage.spectrum}`;
  $("obs").innerHTML = s.observations.map((o) =>
    `<li>${fmtTime(o.ts)}: ${o.height_cm ?? "—"} cm ${o.notes ? "· " + o.notes : ""}</li>`).join("");
}

const charts = {};
function lineChart(id, datasets, yAxes) {
  const grid = { color: css("--line") }, ticks = { color: css("--muted") };
  const scales = { x: { type: "category", ticks: { ...ticks, maxTicksLimit: 6 }, grid } };
  for (const [axis, opts] of Object.entries(yAxes)) scales[axis] = { ...opts, ticks, grid: axis === "y" ? grid : { display: false } };
  if (charts[id]) {
    charts[id].data.datasets.forEach((d, i) => Object.assign(d, datasets[i]));
    charts[id].data.labels = datasets.labels;
    charts[id].update("none");
    return;
  }
  charts[id] = new Chart($(id), {
    type: "line",
    data: { labels: datasets.labels, datasets },
    options: { animation: false, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.25 } },
      plugins: { legend: { labels: { color: css("--muted"), boxWidth: 12 } } }, scales },
  });
}

async function refreshSeries() {
  const rows = await getJSON(`/api/readings?hours=${$("hours").value}`);
  const labels = rows.map((r) => fmtTime(r.ts));
  const col = (f) => rows.map((r) => r[f]);
  const climate = [
    { label: "Air °C", data: col("air_temp"), borderColor: "#d1495b", yAxisID: "y" },
    { label: "Humidity %", data: col("humidity"), borderColor: "#2a9d8f", yAxisID: "y1" },
  ];
  climate.labels = labels;
  lineChart("c_climate", climate, { y: { position: "left" }, y1: { position: "right" } });

  const water = [{ label: "Reservoir %", data: col("water_level_pct"), borderColor: "#3d7ab8", fill: true,
    backgroundColor: "rgba(61,122,184,.12)" }];
  water.labels = labels;
  lineChart("c_water", water, { y: { min: 0, max: 100 } });

  const hasChem = rows.some((r) => r.ph != null || r.ec != null);
  $("chem_wrap").hidden = !hasChem;
  if (hasChem) {
    const chem = [
      { label: "pH", data: col("ph"), borderColor: "#8a5cc2", yAxisID: "y" },
      { label: "EC mS/cm", data: col("ec"), borderColor: "#e9a23b", yAxisID: "y1" },
    ];
    chem.labels = labels;
    lineChart("c_chem", chem, { y: { position: "left" }, y1: { position: "right" } });
  }
}

async function refreshDaily() {
  const days = await getJSON("/api/history/daily");
  const ds = [
    { type: "bar", label: "Water uptake L/day", data: days.map((d) => d.uptake_l), backgroundColor: "rgba(42,157,143,.55)", yAxisID: "y" },
    { label: "Mean air °C", data: days.map((d) => d.air_temp_c), borderColor: "#d1495b", yAxisID: "y1" },
    { label: "Light h", data: days.map((d) => d.light_hours), borderColor: "#e9a23b", yAxisID: "y1" },
  ];
  ds.labels = days.map((d) => `d${d.day}`);
  lineChart("c_daily", ds, { y: { position: "left", min: 0 }, y1: { position: "right" } });
}

async function tick() {
  try { renderStatus(await getJSON("/api/status")); } catch (e) { $("stageline").textContent = "server unreachable"; }
}

// ---- ESP32 link panel ----
let link = null, linkFetchedAt = 0, lastPackets = null;
const fmtAge = (s) => s < 60 ? `${s.toFixed(0)} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`;
const fmtUptime = (s) => s == null ? "—" : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min`;
function signal(rssi) {
  if (rssi == null) return "—";
  const n = rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -75 ? 2 : 1;
  const label = ["", "weak", "fair", "good", "excellent"][n];
  return `<span class="bars">${[4, 7, 10, 13].map((h, i) => `<b style="height:${h}px" class="${i < n ? "on" : ""}"></b>`).join("")}</span>${rssi} dBm · ${label}`;
}
function replay(el) { el.classList.remove("go", "beat"); void el.offsetWidth; el.classList.add(el.id === "linkdot" ? "beat" : "go"); }
function compact(o) {
  return Object.entries(o).map(([k, v]) => `${k}:${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ");
}

function renderLink() {
  if (!link) return;
  const age = link.age_s == null ? null : link.age_s + (Date.now() - linkFetchedAt) / 1000;
  const up = age != null && age < 30;
  $("linkpanel").className = "panel link " + (age == null ? "" : up ? "up" : "down");
  $("linktitle").textContent = age == null ? "Waiting for ESP32…" : up ? `ESP32 connected · ${link.device_id}` : `ESP32 not responding · ${link.device_id}`;
  $("linkage").textContent = age == null ? "no packets since the server started" :
    `last packet ${fmtAge(age)}` + (up ? ` · reports every 10 s` : " · check power / WiFi hotspot");
}

async function refreshLink() {
  try {
    link = await getJSON("/api/link");
    linkFetchedAt = Date.now();
  } catch (e) { return; }
  if (lastPackets != null && link.packets > lastPackets) {
    replay($("linkdot")); replay($("pkt-up")); replay($("pkt-down"));
  }
  const isNew = lastPackets != null && link.packets > lastPackets;
  lastPackets = link.packets ?? 0;
  const stats = [
    ["Signal", signal(link.rssi)],
    ["Board IP", link.ip || link.client || "—"],
    ["Packets / min", link.packets_last_min],
    ["Total packets", link.packets ?? 0],
    ["Board uptime", fmtUptime(link.uptime_s)],
    ["Server reply", link.handled_ms != null ? `${link.handled_ms} ms` : "—"],
    ["Firmware", link.fw || "—"],
  ];
  if (link.failed_posts) stats.push(["Recovered after", `${link.failed_posts} failed posts`]);
  $("linkstats").innerHTML = stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  $("traffic").innerHTML = (link.traffic || []).map((x, i) => {
    const sent = Object.fromEntries(Object.entries(x.sent).filter(([k]) => !["device_id", "fw", "ip"].includes(k)));
    const on = Object.entries(x.reply).filter(([, v]) => v).map(([k]) => k);
    return `<tr class="${i === 0 && isNew ? "fresh" : ""}"><td>${new Date(x.t * 1000).toLocaleTimeString()}</td>` +
      `<td>${compact(sent) || "(heartbeat)"}</td><td>${on.length ? "ON: " + on.join(", ") : "all off"}</td></tr>`;
  }).join("");
  renderLink();
}

$("ledbtn").addEventListener("click", async () => {
  const btn = $("ledbtn"), msg = $("ledmsg");
  btn.disabled = true;
  msg.textContent = "sending…";
  try {
    const r = await fetch("/api/led", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blink: 5 }) }).then((x) => x.json());
    msg.textContent = r.via === "direct" ? `✓ board blinked (round trip ${r.rtt_ms} ms)`
      : `queued: board will blink on its next report (≤ ${r.eta_s} s)`;
  } catch (e) {
    msg.textContent = "server unreachable";
  }
  btn.disabled = false;
  refreshLink();
});

// ---- Plant camera ----
let camShown = null, camOverlay = false;
const VERDICT_CLASS = { "healthy": "ok", "needs attention": "bad", "no plant in view": "", "analysis failed": "bad" };
function showPhoto(p) {
  camShown = p.file;
  const a = p.analysis;
  const src = camOverlay && a && a.overlay ? a.overlay : p.url;
  const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
  const analysis = !a ? `<div class="muted small">Analysing on this PC…</div>` : `
    <div class="verdict ${VERDICT_CLASS[a.verdict] ?? "warn"}">${a.verdict}</div>
    ${a.canopy_pct != null ? `<div class="vstats">
      <span>Canopy <b>${a.canopy_pct.toFixed(1)}%</b> of frame</span>
      <span>Yellow/tan <b>${pct(a.yellow_frac)}</b></span>
      <span>Brown <b>${pct(a.brown_frac)}</b></span>
      <span>Purple <b>${pct(a.purple_frac)}</b></span>
      <span title="Dark Green Colour Index: higher = darker green = more nitrogen">DGCI <b>${a.dgci ?? "—"}</b></span>
    </div>` : ""}
    ${a.issues.length ? `<ul class="issues">${a.issues.map(([, m]) => `<li>${m}</li>`).join("")}</ul>` : ""}
    <label class="small overlaytoggle"><input type="checkbox" id="ovl" ${camOverlay ? "checked" : ""}> Show what the AI sees
      <span class="muted">(green leaf · yellow · brown · purple)</span></label>`;
  $("camlatest").innerHTML = `<a href="${src}" target="_blank"><img src="${src}" alt="plant photo"></a>
    <div class="cap muted small">${fmtTime(p.ts)} · day ${p.day.toFixed(1)} (${p.stage.replace("_", " ")}) · ${p.source}</div>
    ${analysis}`;
  const box = $("ovl");
  if (box) box.onchange = () => { camOverlay = box.checked; showPhoto(p); };
}
async function refreshCamera() {
  let photos;
  try { photos = await getJSON("/api/photos?limit=24"); } catch (e) { return; }
  $("camcount").textContent = photos.length ? `${photos.length}${photos.length === 24 ? "+" : ""} photos` : "";
  // Re-render when a new photo arrives or the newest one finishes analysing.
  const head = photos[0];
  const key = head ? head.file + (head.analysis ? "+a" : "") : null;
  if (head && camShown !== key) { showPhoto(head); camShown = key; }
  refreshCanopy();
  $("camstrip").innerHTML = photos.map((p, i) =>
    `<figure><img src="${p.url}" loading="lazy" data-i="${i}" alt="day ${p.day}"><figcaption>d${p.day.toFixed(1)}</figcaption></figure>`).join("");
  $("camstrip").querySelectorAll("img").forEach((img) => (img.onclick = () => showPhoto(photos[img.dataset.i])));
}
async function refreshCanopy() {
  const g = await getJSON("/api/vision/growth").catch(() => []);
  $("canopywrap").hidden = g.length < 2;
  if (g.length < 2) return;
  const ds = [
    { label: "Canopy % of frame", data: g.map((x) => x.canopy_pct), borderColor: "#2a9d8f", yAxisID: "y" },
    { label: "DGCI (leaf N proxy)", data: g.map((x) => x.dgci), borderColor: "#3a7d44", borderDash: [4, 3], yAxisID: "y1" },
  ];
  ds.labels = g.map((x) => fmtTime(x.ts));
  lineChart("c_canopy", ds, { y: { position: "left", min: 0 }, y1: { position: "right", min: 0, max: 1 } });
}

getJSON("/api/camera-url").then((u) => {
  if (!u.https) { $("camqr").hidden = true; $("camlink").textContent = "start with `python -m hydro.run` for phone camera"; return; }
  $("camqr").src = "/api/qr.svg";
  $("camlink").href = u.https;
  $("camlink").textContent = u.https;
}).catch(() => {});

// ---- Crop advisor ----
let askAnswers = {};
function askBody() {
  return {
    text: $("asktext").value.trim(), crop: $("askcrop").value || null,
    day: $("askday").value ? parseInt($("askday").value) : null,
    weather: [...document.querySelectorAll(".wx:checked")].map((x) => x.value),
    rain_forecast: $("askrain").checked, use_photo: $("askphoto").checked, use_sensors: $("asksensors").checked,
    answers: askAnswers, lang: $("asklang").value,
  };
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
async function ask() {
  $("askresult").innerHTML = `<div class="muted small">thinking…</div>`;
  let r;
  try {
    r = await fetch("/api/advise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(askBody()) }).then((x) => x.json());
  } catch (e) { $("askresult").innerHTML = `<div class="banner">server unreachable</div>`; return; }
  const lang = $("asklang").value;
  let h = "";
  if (r.safety) h += `<div class="banner">${esc(r.safety.message)}</div>`;
  if (r.safety && r.safety.halt) { $("askresult").innerHTML = `<div class="ans">${h}</div>`; return; }
  if (r.needs) { $("askresult").innerHTML = `<div class="ans"><div class="banner info">${esc(r.needs[lang] || r.needs.en)}</div></div>`; return; }
  if (r.unrelated) { $("askresult").innerHTML = `<div class="ans"><div class="banner info">${esc(r.message)}</div></div>`; return; }
  h += `<div class="causes">${(r.likely || []).map((l, i) => `<div class="cause ${i === 0 ? "top" : ""}"><b>${esc(l.name)}</b><div class="s">${esc(l.agreement)}</div></div>`).join("") || `<span class="muted">No clear match.</span>`}</div>`;
  h += `<div class="metaline">confidence: <b>${r.confidence}</b> · ${r.crop}${r.stage ? ", " + r.stage + " stage" : ""} · evidence: ${(r.evidence_used || []).join(", ")} · router: ${r.router} (${r.router_calls} calls, ${r.latency_ms} ms)</div>`;
  if (r.questions && r.questions.length) {
    h += r.questions.map((q) => `<div class="qbox">${esc(q[lang] || q.en)} <button type="button" data-q="${q.id}" data-v="1">Yes</button><button type="button" class="no" data-q="${q.id}" data-v="0">No</button></div>`).join("");
  }
  if (r.actions && r.actions.length) h += `<div><b>What to do</b><ol class="acts-list">${r.actions.map((a) => `<li><span class="kind">${a.kind}</span>${esc(a.text)}</li>`).join("")}</ol></div>`;
  if (r.avoid && r.avoid.length) h += `<div><b>Avoid</b><ul class="acts-list avoid">${r.avoid.map((a) => `<li>${esc(a.text)}: ${esc(a.reason)}</li>`).join("")}</ul></div>`;
  if (r.notifiable) h += `<div class="banner info">This problem spreads between farms. Tell your KVK so neighbours are warned.</div>`;
  $("askresult").innerHTML = `<div class="ans">${h}</div>`;
  $("askresult").querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { askAnswers[b.dataset.q] = b.dataset.v === "1"; ask(); }));
}
$("askform").addEventListener("submit", (e) => { e.preventDefault(); askAnswers = {}; ask(); });
// Shareable questions: /?ask=...&crop=wheat&day=45
{
  const u = new URLSearchParams(location.search);
  if (u.get("ask")) {
    $("asktext").value = u.get("ask");
    if (u.get("crop")) $("askcrop").value = u.get("crop");
    if (u.get("day")) $("askday").value = u.get("day");
    if (u.get("sensors") === "0") $("asksensors").checked = false;
    ask().then(() => $("advisorpanel").scrollIntoView());
  }
}

$("hours").addEventListener("change", refreshSeries);
$("obsform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  await fetch("/api/observations", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ height_cm: parseFloat(f.get("height_cm")), notes: f.get("notes") }) });
  e.target.reset();
  tick();
});

tick(); refreshSeries(); refreshDaily(); refreshLink();
setInterval(refreshLink, 2000);
refreshCamera();
setInterval(refreshCamera, 10000);
setInterval(renderLink, 500);
setInterval(tick, 5000);
setInterval(refreshSeries, 15000);
setInterval(refreshDaily, 60000);
