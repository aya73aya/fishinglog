const STORAGE_KEY = "fishlog_sessions_v1";
const OLD_STORAGE_KEY = "fishlog_catches";

const DIRECTIONS = [
  { label: "北", en: "N", deg: 0 },
  { label: "北東", en: "NE", deg: 45 },
  { label: "東", en: "E", deg: 90 },
  { label: "南東", en: "SE", deg: 135 },
  { label: "南", en: "S", deg: 180 },
  { label: "南西", en: "SW", deg: 225 },
  { label: "西", en: "W", deg: 270 },
  { label: "北西", en: "NW", deg: 315 },
];

const GRANULARITIES = [
  { label: "1時間", minutes: 60 },
  { label: "30分", minutes: 30 },
  { label: "10分", minutes: 10 },
];

// Cast direction relative to the direction the phone (= angler's facing) points.
// No "behind" option since casts are never thrown backward.
const RELATIVE_DIRECTIONS = [
  { key: "left", label: "左", offset: -90 },
  { key: "frontLeft", label: "斜め左前", offset: -45 },
  { key: "front", label: "正面", offset: 0 },
  { key: "frontRight", label: "斜め右前", offset: 45 },
  { key: "right", label: "右", offset: 90 },
];

let currentLiveHeading = null;
let headingHandler = null;

function stopHeadingListener() {
  if (headingHandler) {
    window.removeEventListener("deviceorientation", headingHandler, true);
    headingHandler = null;
  }
  currentLiveHeading = null;
}

// Continuously listens for compass heading while a direction picker is open.
// onUpdate(heading|null, status) is called on every reading; status is
// 'ok' | 'unsupported' | 'denied'.
function startHeadingListener(onUpdate) {
  stopHeadingListener();
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) {
    onUpdate(null, "unsupported");
    return;
  }

  const handler = (e) => {
    let heading = null;
    if (typeof e.webkitCompassHeading === "number") {
      heading = e.webkitCompassHeading;
    } else if (typeof e.alpha === "number") {
      heading = 360 - e.alpha;
    }
    if (heading !== null) {
      currentLiveHeading = heading;
      onUpdate(heading, "ok");
    }
  };

  if (typeof DOE.requestPermission === "function") {
    DOE.requestPermission()
      .then((state) => {
        if (state === "granted") {
          headingHandler = handler;
          window.addEventListener("deviceorientation", handler, true);
        } else {
          onUpdate(null, "denied");
        }
      })
      .catch(() => onUpdate(null, "denied"));
  } else {
    headingHandler = handler;
    window.addEventListener("deviceorientation", handler, true);
  }
}

function nearestDirection(deg) {
  const norm = ((deg % 360) + 360) % 360;
  let best = DIRECTIONS[0];
  let bestDiff = 360;
  for (const d of DIRECTIONS) {
    const diff = Math.min(Math.abs(norm - d.deg), 360 - Math.abs(norm - d.deg));
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  return best;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatShortTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}
function dateKey(iso) { return new Date(iso).toDateString(); }
function formatDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }

  // migrate from old flat-catch format if present
  try {
    const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldRaw) {
      const oldCatches = JSON.parse(oldRaw);
      if (Array.isArray(oldCatches) && oldCatches.length > 0) {
        const sorted = [...oldCatches].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const migrated = [{
          id: `migrated-${Date.now()}`,
          name: "以前の記録",
          startTime: sorted[0].timestamp,
          endTime: sorted[sorted.length - 1].timestamp,
          catches: oldCatches,
        }];
        return migrated;
      }
    }
  } catch (e) { /* ignore */ }

  return [];
}

function saveSessions() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.error("save failed", e);
  }
}

let sessions = loadSessions();
let expandedCatchId = null;
let expandedHistoryId = null;
const granularityBySession = {};

const appEl = document.getElementById("app");
const todayCountEl = document.getElementById("todayCount");
const totalCountEl = document.getElementById("totalCount");
const mainBtn = document.getElementById("mainBtn");
const modalOverlay = document.getElementById("modalOverlay");
const sessionNameInput = document.getElementById("sessionNameInput");

function getActiveSession() {
  return sessions.find((s) => !s.endTime) || null;
}
function allCatches() {
  return sessions.flatMap((s) => s.catches);
}

function render() {
  const today = new Date().toDateString();
  const all = allCatches();
  todayCountEl.textContent = all.filter((c) => dateKey(c.timestamp) === today).length;
  totalCountEl.textContent = all.length;

  appEl.innerHTML = "";

  const active = getActiveSession();

  if (active) {
    mainBtn.textContent = "釣れた!";
    appEl.appendChild(buildActiveSessionBar(active));
    if (active.catches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = `<div class="empty-glyph">🎣</div>下のボタンで、このセッションの一匹目を記録しましょう。`;
      appEl.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "list";
      [...active.catches].reverse().forEach((c) => list.appendChild(buildCatchCard(c, active)));
      appEl.appendChild(list);
    }
  } else {
    mainBtn.textContent = "セッション開始";
    const empty = document.createElement("div");
    empty.className = "empty session-empty";
    empty.innerHTML = `<div class="empty-glyph">🎣</div>新しいセッションを開始して記録を始めましょう。`;
    appEl.appendChild(empty);
  }

  const past = sessions.filter((s) => s.endTime).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  if (past.length > 0) {
    const heading = document.createElement("div");
    heading.className = "section-heading";
    heading.textContent = "過去のセッション";
    appEl.appendChild(heading);
    past.forEach((s) => appEl.appendChild(buildHistoryRow(s)));
  }
}

function buildActiveSessionBar(session) {
  const bar = document.createElement("div");
  bar.className = "session-bar";

  const top = document.createElement("div");
  top.className = "session-top";

  const info = document.createElement("div");
  const name = document.createElement("div");
  name.className = "session-name";
  name.textContent = session.name;
  const meta = document.createElement("div");
  meta.className = "session-meta";
  meta.textContent = `${formatShortTime(session.startTime)} 開始 ・ 経過 ${formatDuration(Date.now() - new Date(session.startTime))} ・ ${session.catches.length}匹`;
  info.appendChild(name);
  info.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "session-actions";
  const endBtn = document.createElement("button");
  endBtn.className = "small-btn danger";
  endBtn.textContent = "終了";
  endBtn.onclick = () => {
    session.endTime = new Date().toISOString();
    saveSessions();
    render();
  };
  actions.appendChild(endBtn);

  top.appendChild(info);
  top.appendChild(actions);
  bar.appendChild(top);

  return bar;
}

function buildCatchCard(c, session) {
  const card = document.createElement("div");
  card.className = "card";

  const top = document.createElement("div");
  top.className = "card-top";
  const time = document.createElement("div");
  time.className = "time";
  time.textContent = formatTime(c.timestamp);
  const del = document.createElement("button");
  del.className = "del-btn";
  del.textContent = "削除";
  del.onclick = () => {
    session.catches = session.catches.filter((x) => x.id !== c.id);
    saveSessions();
    render();
  };
  top.appendChild(time);
  top.appendChild(del);
  card.appendChild(top);

  const metaRow = document.createElement("div");
  metaRow.className = "meta-row";

  if (c.locStatus === "loading") {
    const p = document.createElement("span");
    p.className = "pill";
    p.textContent = "位置情報を取得中…";
    metaRow.appendChild(p);
  } else if (c.locStatus === "denied") {
    const p = document.createElement("span");
    p.className = "pill";
    p.textContent = "位置情報なし";
    metaRow.appendChild(p);
  } else if (c.locStatus === "unsupported") {
    const p = document.createElement("span");
    p.className = "pill";
    p.textContent = "この端末はGPS非対応";
    metaRow.appendChild(p);
  } else if (c.locStatus === "ok") {
    const a = document.createElement("a");
    a.className = "pill brass";
    a.href = `https://maps.apple.com/?ll=${c.lat},${c.lng}&q=${encodeURIComponent("釣果ポイント")}`;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = `📍 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
    metaRow.appendChild(a);
  }

  const dirPill = document.createElement("span");
  dirPill.className = "pill";
  const dirBtn = document.createElement("button");
  dirBtn.textContent = pillLabelForCatch(c);
  dirBtn.onclick = () => {
    if (expandedCatchId === c.id) {
      expandedCatchId = null;
      stopHeadingListener();
    } else {
      expandedCatchId = c.id;
    }
    render();
  };
  dirPill.appendChild(dirBtn);
  metaRow.appendChild(dirPill);

  card.appendChild(metaRow);

  if (expandedCatchId === c.id) {
    card.appendChild(buildCompass(c));
  }

  return card;
}

function pillLabelForCatch(c) {
  if (!c.direction) return "方向を設定";
  const rel = RELATIVE_DIRECTIONS.find((r) => r.key === c.direction);
  if (rel) {
    if (typeof c.absoluteDeg === "number") {
      const abs = nearestDirection(c.absoluteDeg);
      return `↗ ${rel.label}(${abs.label} ${Math.round(c.absoluteDeg)}°)`;
    }
    return `↗ ${rel.label}`;
  }
  // legacy data from the absolute 8-direction picker
  const old = DIRECTIONS.find((d) => d.en === c.direction);
  if (old) return `↗ ${old.label}方向`;
  return "方向を設定";
}

function buildCompass(c) {
  const wrap = document.createElement("div");
  wrap.className = "compass-toggle";

  const label = document.createElement("div");
  label.className = "compass-label";
  label.textContent = "スマホを自分の正面に向けたまま、投げた方向をタップ";
  wrap.appendChild(label);

  const statusId = `heading-status-${c.id}`;
  const status = document.createElement("div");
  status.className = "heading-status";
  status.id = statusId;
  status.textContent = "コンパスを確認中…";
  wrap.appendChild(status);

  const fan = document.createElement("div");
  fan.className = "fan";

  RELATIVE_DIRECTIONS.forEach((d) => {
    const rad = (d.offset * Math.PI) / 180;
    const r = 85;
    const cx = 120;
    const cy = 130;
    const x = cx + r * Math.sin(rad);
    const y = cy - r * Math.cos(rad);
    const btn = document.createElement("button");
    btn.className = "fan-btn" + (c.direction === d.key ? " active" : "");
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    btn.textContent = d.label;
    btn.onclick = () => {
      c.direction = d.key;
      c.absoluteDeg = typeof currentLiveHeading === "number"
        ? (currentLiveHeading + d.offset + 360) % 360
        : null;
      saveSessions();
      expandedCatchId = null;
      stopHeadingListener();
      render();
    };
    fan.appendChild(btn);
  });

  const ref = document.createElement("div");
  ref.className = "fan-ref";
  ref.textContent = "📱 自分の正面";
  fan.appendChild(ref);

  wrap.appendChild(fan);

  startHeadingListener((heading, statusKind) => {
    const el = document.getElementById(statusId);
    if (!el) return; // card no longer in DOM
    if (statusKind === "unsupported") {
      el.textContent = "この端末ではコンパスが使えません。方向だけ記録されます。";
    } else if (statusKind === "denied") {
      el.textContent = "コンパスへのアクセスが許可されませんでした。方向だけ記録されます。";
    } else {
      const label = nearestDirection(heading).label;
      el.textContent = `現在の向き: ${Math.round(heading)}°(${label})`;
    }
  });

  return wrap;
}

function buildHistoryRow(session) {
  const row = document.createElement("div");
  row.className = "hist-row";

  const top = document.createElement("div");
  top.className = "hist-row-top";
  const left = document.createElement("div");
  const name = document.createElement("div");
  name.className = "hist-row-name";
  name.textContent = session.name;
  const meta = document.createElement("div");
  meta.className = "hist-row-meta";
  meta.textContent = `${formatDate(session.startTime)} ・ ${formatShortTime(session.startTime)}〜${formatShortTime(session.endTime)} ・ 所要 ${formatDuration(new Date(session.endTime) - new Date(session.startTime))}`;
  left.appendChild(name);
  left.appendChild(meta);

  const count = document.createElement("div");
  count.className = "hist-row-count";
  count.textContent = `${session.catches.length}匹`;

  top.appendChild(left);
  top.appendChild(count);
  top.onclick = () => {
    expandedHistoryId = expandedHistoryId === session.id ? null : session.id;
    render();
  };
  row.appendChild(top);

  if (expandedHistoryId === session.id) {
    const detail = document.createElement("div");
    detail.className = "hist-detail";

    const granRow = document.createElement("div");
    granRow.className = "gran-row";
    const currentGran = granularityBySession[session.id] || 30;
    GRANULARITIES.forEach((g) => {
      const btn = document.createElement("button");
      btn.className = "small-btn" + (currentGran === g.minutes ? " active" : "");
      btn.textContent = g.label;
      btn.onclick = () => {
        granularityBySession[session.id] = g.minutes;
        render();
      };
      granRow.appendChild(btn);
    });
    detail.appendChild(granRow);

    const chartWrap = document.createElement("div");
    chartWrap.className = "chart-wrap";
    let canvas = null;
    if (session.catches.length === 0) {
      const ce = document.createElement("div");
      ce.className = "chart-empty";
      ce.textContent = "このセッションには記録がありません";
      chartWrap.appendChild(ce);
    } else {
      canvas = document.createElement("canvas");
      chartWrap.appendChild(canvas);
    }
    detail.appendChild(chartWrap);

    if (session.catches.length > 0) {
      const list = document.createElement("div");
      list.style.marginTop = "14px";
      [...session.catches].reverse().forEach((c) => list.appendChild(buildCatchCard(c, session)));
      detail.appendChild(list);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "small-btn danger";
    delBtn.style.marginTop = "14px";
    delBtn.textContent = "このセッションを削除";
    delBtn.onclick = () => {
      sessions = sessions.filter((s) => s.id !== session.id);
      saveSessions();
      render();
    };
    detail.appendChild(delBtn);

    row.appendChild(detail);

    if (canvas) drawChart(canvas, session, currentGran);
  }

  return row;
}

function drawChart(canvas, session, bucketMinutes) {
  const start = new Date(session.startTime);
  const end = session.endTime ? new Date(session.endTime) : new Date();
  const durationMin = Math.max(1, (end - start) / 60000);
  const bucketCount = Math.max(1, Math.ceil(durationMin / bucketMinutes));
  const counts = new Array(bucketCount).fill(0);

  session.catches.forEach((c) => {
    const mins = (new Date(c.timestamp) - start) / 60000;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(mins / bucketMinutes)));
    counts[idx]++;
  });

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth - 4;
  const cssHeight = 150;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.height = cssHeight + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const maxCount = Math.max(1, ...counts);
  const chartTop = 10;
  const chartBottom = cssHeight - 26;
  const chartHeight = chartBottom - chartTop;
  const gap = bucketCount > 20 ? 1 : 3;
  const barWidth = Math.max(1, (cssWidth - gap * (bucketCount - 1)) / bucketCount);

  ctx.strokeStyle = "#2f5d5f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, chartBottom + 0.5);
  ctx.lineTo(cssWidth, chartBottom + 0.5);
  ctx.stroke();

  const labelEvery = Math.max(1, Math.ceil(bucketCount / 6));

  counts.forEach((count, i) => {
    const x = i * (barWidth + gap);
    const h = (count / maxCount) * chartHeight;
    const y = chartBottom - h;

    ctx.fillStyle = count > 0 ? "#c69a5c" : "#20444a";
    ctx.fillRect(x, y, barWidth, Math.max(h, count > 0 ? 3 : 1));

    if (count > 0 && barWidth > 10) {
      ctx.fillStyle = "#f1ecde";
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(count), x + barWidth / 2, y - 4 < 10 ? y + 12 : y - 4);
    }

    if (i % labelEvery === 0) {
      const bucketStart = new Date(start.getTime() + i * bucketMinutes * 60000);
      ctx.fillStyle = "#9fb8b6";
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(formatShortTime(bucketStart.toISOString()), x + barWidth / 2, cssHeight - 10);
    }
  });
}

function logCatch(session) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry = {
    id,
    timestamp: new Date().toISOString(),
    lat: null,
    lng: null,
    accuracy: null,
    locStatus: "geolocation" in navigator ? "loading" : "unsupported",
    direction: null,
  };

  mainBtn.classList.add("flash");
  setTimeout(() => mainBtn.classList.remove("flash"), 350);

  session.catches.push(entry);
  saveSessions();
  expandedCatchId = id;
  render();

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        entry.lat = pos.coords.latitude;
        entry.lng = pos.coords.longitude;
        entry.accuracy = pos.coords.accuracy;
        entry.locStatus = "ok";
        saveSessions();
        render();
      },
      () => {
        entry.locStatus = "denied";
        saveSessions();
        render();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }
}

function openModal() {
  sessionNameInput.value = "";
  modalOverlay.hidden = false;
  setTimeout(() => sessionNameInput.focus(), 50);
}
function closeModal() {
  modalOverlay.hidden = true;
}
function startSession() {
  const name = sessionNameInput.value.trim() || `セッション ${new Date().toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}`;
  const session = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    startTime: new Date().toISOString(),
    endTime: null,
    catches: [],
  };
  sessions.push(session);
  saveSessions();
  closeModal();
  render();
}

mainBtn.addEventListener("click", () => {
  const active = getActiveSession();
  if (active) {
    logCatch(active);
  } else {
    openModal();
  }
});
document.getElementById("modalCancel").addEventListener("click", closeModal);
document.getElementById("modalStart").addEventListener("click", startSession);
sessionNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startSession();
});

render();
setInterval(() => {
  if (getActiveSession()) render();
}, 30000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
