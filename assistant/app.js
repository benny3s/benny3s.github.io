/* 베니 비서 공용 웹앱 (v1.04 — 집 PC·폰 직통 / 회사 PC 안전 중계 자동 전환) */
(function () {
  "use strict";

  const TS_BASE = "https://desktop-ijcbddr.tail4df4c9.ts.net:8766";
  const TS_HOST = "https://desktop-ijcbddr.tail4df4c9.ts.net";
  const FB = {
    apiKey: "AIzaSyCSueePQfiHaRxUSZxoropiFjiq9arAaTs",
    authDomain: "benny-meeting.firebaseapp.com",
    projectId: "benny-meeting",
    storageBucket: "benny-meeting.firebasestorage.app",
    messagingSenderId: "925758544707",
    appId: "1:925758544707:web:a0c55e596ae0b15e7fadf6",
  };
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  const FS = "https://firestore.googleapis.com/v1/projects/" + FB.projectId + "/databases/(default)/documents/";
  const ADMIN_COL = "adminOnly";
  const SNAP_DOC = "assistant_snap";

  const Native = window.BennyNative || null;
  const $ = (id) => document.getElementById(id);

  const state = {
    mode: "init", // "direct" | "relay" | "off"
    directBase: "",
    snap: null,
    lastSyncAt: 0,
    page: "summary",
    todoBox: "me",
    campusTab: "today",
    selectedTopic: "",
    showNews: false,
    quickIdx: 0,
    revealedKey: null,
    reviewAnswers: {},
    sureByKey: {},
    kbQuery: "",
    kbResults: [],
    kbSearched: "",
    kbLoading: false,
    chat: [
      { role: "bot", text: "안녕하세요, 베니 님! 일정·할 일·카톡·설계 사전·PC 상태 무엇이든 편하게 물어보세요." },
    ],
    chatBusy: false,
    meetQuery: "",
    meetPickMode: false,
    meetPicked: new Set(),
  };

  let fbP = null;
  let kitP = null;
  let readyP = null;
  const scripts = {};
  let toastTimer = null;

  /* ── 공통 유틸 */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function toast(msg, ms = 2600) {
    const t = $("toast");
    if (!t) return;
    t.textContent = String(msg || "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function copyText(text, label) {
    const val = String(text || "");
    if (!val) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(() => toast((label || "내용") + "을 복사했어요")).catch(() => {
        if (Native && Native.copyText) { Native.copyText(label || "복사", val); toast((label || "내용") + "을 복사했어요"); }
        else toast("복사하지 못했어요");
      });
    } else if (Native && Native.copyText) {
      Native.copyText(label || "복사", val);
      toast((label || "내용") + "을 복사했어요");
    } else {
      toast("이 브라우저에서는 자동 복사를 지원하지 않아요");
    }
  }

  function openUrl(url) {
    const u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u)) return;
    if (Native && Native.openExternal) {
      Native.openExternal(u);
    } else {
      window.open(u, "_blank", "noopener,noreferrer");
    }
  }

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDaysIso(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function nextWeekendIso() {
    const d = new Date();
    const wd = d.getDay(); // 0=일, 6=토
    const add = wd === 6 ? 1 : (wd === 0 ? 6 : 6 - wd);
    return addDaysIso(add);
  }

  function nextMondayIso() {
    const d = new Date();
    const wd = d.getDay();
    const add = wd === 0 ? 1 : (8 - wd);
    return addDaysIso(add);
  }

  function weekdayKo(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()] || "";
  }

  function shortDate(iso) {
    const s = String(iso || "").slice(0, 10);
    if (!s) return "";
    const td = todayIso();
    if (s === td) return "오늘";
    const d1 = new Date(td + "T00:00:00");
    const d2 = new Date(s + "T00:00:00");
    const diff = Math.round((d2 - d1) / 86400000);
    if (diff === 1) return "내일";
    if (diff === -1) return "어제";
    return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}(${weekdayKo(s)})`;
  }

  function setConn(kind, text, tip) {
    const pill = $("connPill");
    const lbl = $("connLabel");
    if (pill) {
      pill.className = "conn-pill " + kind;
      if (tip) pill.title = tip;
    }
    if (lbl) lbl.textContent = text;
  }

  /* ── 모달 다이얼로그 (light-dismiss closedby="any" + 구형 브라우저 bounding-rect 폴백) */
  const modalDlg = $("modalDlg");
  const dlgTitle = $("dlgTitle");
  const dlgBody = $("dlgBody");

  function openModal(title, html, onReady) {
    dlgTitle.textContent = title || "상세";
    dlgBody.innerHTML = html || "";
    if (!modalDlg.open) modalDlg.showModal();
    if (typeof onReady === "function") onReady(dlgBody);
  }

  function closeModal() {
    if (modalDlg && modalDlg.open) modalDlg.close();
  }

  $("dlgClose").addEventListener("click", closeModal);
  if (modalDlg && !("closedBy" in HTMLDialogElement.prototype)) {
    modalDlg.addEventListener("click", (e) => {
      if (e.target !== modalDlg) return;
      const r = modalDlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) modalDlg.close();
    });
  }

  /* ── Firebase Auth & Firestore REST (회사 PC 안전 중계 전용) */
  function loadOnce(src) {
    return scripts[src] || (scripts[src] = new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => { delete scripts[src]; s.remove(); bad(new Error("스크립트를 불러오지 못했어요")); };
      document.head.appendChild(s);
    }));
  }

  function ensureFirebase() {
    if (!fbP) {
      fbP = loadOnce(SDK + "firebase-app-compat.js")
        .then(() => loadOnce(SDK + "firebase-auth-compat.js"))
        .then(() => {
          if (!window.firebase) throw new Error("Firebase 초기화 실패");
          return firebase.apps.length ? firebase.app() : firebase.initializeApp(FB);
        });
      fbP.catch(() => { fbP = null; });
    }
    return fbP;
  }

  function ensureLoginKit() {
    if (!kitP) {
      kitP = ensureFirebase().then((app) =>
        Promise.all([
          loadOnce(SDK + "firebase-functions-compat.js"),
          loadOnce("../admin-login.js?v=20261118a"),
        ]).then(() => app)
      );
      kitP.catch(() => { kitP = null; });
    }
    return kitP;
  }

  function authReady() {
    if (!readyP) {
      readyP = ensureFirebase().then((app) => new Promise((ok, bad) => {
        const t = setTimeout(() => bad(new Error("인증 확인 시간 초과")), 8000);
        const off = app.auth().onAuthStateChanged(() => { clearTimeout(t); off(); ok(app); }, () => { clearTimeout(t); bad(new Error("인증 오류")); });
      }));
      readyP.catch(() => { readyP = null; });
    }
    return readyP;
  }

  async function fsReq(docPath, opts = {}, retry = false) {
    const app = await authReady();
    const user = app.auth().currentUser;
    if (!user) {
      const err = new Error("로그인이 필요해요");
      err.kind = "auth";
      throw err;
    }
    const tok = await user.getIdToken(retry);
    const url = FS + docPath + (opts.qs || "");
    const headers = { Authorization: "Bearer " + tok };
    let body;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const r = await fetch(url, { method: opts.method || "GET", headers, body });
    if (r.status === 401 && !retry) return fsReq(docPath, opts, true);
    if (r.status === 401 || r.status === 403) {
      const err = new Error("관리자 권한이 필요해요");
      err.kind = "auth";
      throw err;
    }
    if (!r.ok) {
      const err = new Error("서버 오류 (" + r.status + ")");
      err.status = r.status;
      throw err;
    }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : {};
  }

  /* ── 직통 / 중계 공용 통신 계층 */
  async function directFetchJson(path, opts = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), opts.timeout || 90000);
    try {
      const headers = Object.assign({}, opts.headers || {});
      let body = opts.body;
      if (body !== undefined && typeof body !== "string") {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
      }
      const r = await fetch(state.directBase + path, {
        method: opts.method || "GET",
        headers,
        body,
        cache: "no-store",
        signal: ac.signal,
      });
      const txt = await r.text();
      const j = txt ? JSON.parse(txt) : {};
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      return j;
    } finally {
      clearTimeout(t);
    }
  }

  async function detectTransport() {
    const h = location.hostname;
    if (h === "127.0.0.1" || h === "localhost" || h.endsWith(".ts.net")) {
      state.mode = "direct";
      state.directBase = location.origin;
      setConn("direct", "직통", "집 PC·폰 직통 연결 (전체 기능)");
      return "direct";
    }
    // 11-25: benny3s.github.io 에서 집 PC 다리로 직통 승격하던 길은 없앴다 — 다리가 github.io 전체(소개팅 · 게임 등)를
    // 믿게 돼 그 중 한 페이지만 뚫려도 회의록 · 승인을 건드릴 수 있었다. 직통은 집 PC 다리 주소(…ts.net:8766/web/)로만.
    state.mode = "relay";
    setConn("relay", "🔒 보안 모드 적용중", "회사 PC 보안 중계 · 회의록·회사 할 일 원문 제외");
    return "relay";
  }

  async function loadSnapshot(silent = false) {
    if (!silent) {
      const btn = $("btnRefresh");
      if (btn) btn.disabled = true;
    }
    try {
      let snap = null;
      if (state.mode === "direct") {
        snap = await directFetchJson("/web/snapshot", { timeout: 15000 });
        setConn("direct", "직통", "집 PC·폰 직통 연결 (전체 기능)");
      } else {
        const doc = await fsReq(`${ADMIN_COL}/${SNAP_DOC}`);
        const raw = doc && doc.fields && doc.fields.json && doc.fields.json.stringValue;
        if (!raw) throw new Error("집 PC 스냅샷이 아직 도착하지 않았어요. 집 PC 가 켜져 있는지 확인해 주세요.");
        snap = JSON.parse(raw);
        setConn("relay", "🔒 보안 모드 적용중", "회사 PC 보안 중계 · 회의록·회사 할 일 원문 제외");
      }
      state.snap = snap;
      state.lastSyncAt = Date.now();
      showAppView();
      renderAll();
      return snap;
    } catch (e) {
      if (e && e.kind === "auth") {
        showLoginView();
      } else if (!silent) {
        setConn("off", "연결 지연");
        toast(e.message || "현황을 불러오지 못했어요", 3500);
      }
      return null;
    } finally {
      const btn = $("btnRefresh");
      if (btn) btn.disabled = false;
    }
  }

  const MUTATING_OPS = new Set([
    "refresh", "todo_add", "todo_done", "todo_delete", "todo_update", "todo_apply",
    "calendar_write", "access_decide", "campus_habit", "campus_grade", "campus_done",
  ]);

  async function sendCmd(op, payload = {}, timeoutMs = 45000) {
    if (state.mode === "direct") {
      const res = await directFetchJson("/web/cmd", {
        method: "POST",
        body: { op, payload },
        timeout: Math.max(timeoutMs, 90000),
      });
      if (MUTATING_OPS.has(op) && res && res.ok !== false) {
        loadSnapshot(true);
      }
      return res;
    }
    // Relay 모드: adminOnly/assistant_req_<id> 작성 후 집 PC 회신 폴링
    const reqId = "assistant_req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    await fsReq(`${ADMIN_COL}/${reqId}`, {
      method: "PATCH",
      qs: "?updateMask.fieldPaths=op&updateMask.fieldPaths=payload&updateMask.fieldPaths=status",
      body: {
        fields: {
          op: { stringValue: String(op) },
          payload: { stringValue: JSON.stringify(payload || {}) },
          status: { stringValue: "pending" },
        },
      },
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1200));
      const d = await fsReq(`${ADMIN_COL}/${reqId}`);
      const f = (d && d.fields) || {};
      const st = (f.status && f.status.stringValue) || "";
      if (st === "done" || st === "error") {
        const raw = (f.res && f.res.stringValue) || "{}";
        const parsed = JSON.parse(raw);
        if (MUTATING_OPS.has(op) && parsed.ok !== false) {
          setTimeout(() => loadSnapshot(true), 700);
        }
        return parsed;
      }
      if (st === "expired") {
        throw new Error("집 PC 응답 시간이 만료되었어요");
      }
    }
    throw new Error("집 PC가 응답하지 않았어요. 잠시 후 다시 시도해 주세요.");
  }

  /* ── 화면 전환 */
  function showLoginView() {
    $("loginView").hidden = false;
    $("appPages").hidden = true;
    setConn("relay", "로그인 필요");
  }

  function showAppView() {
    $("loginView").hidden = true;
    $("appPages").hidden = false;
    const isDirect = state.mode === "direct";
    $("navMeetingsSide").hidden = !isDirect;
    $("navMeetingsBottom").hidden = !isDirect;
    if (Native) {
      $("btnLiveMeet").hidden = false;
      $("btnNativeSettings").hidden = false;
    }
  }

  function switchPage(page) {
    if (page === "meetings" && state.mode !== "direct") return;
    state.page = page;
    ["summary", "todo", "chat", "campus", "meetings"].forEach((p) => {
      const sec = $("page-" + p);
      if (sec) sec.hidden = p !== page;
    });
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      if (btn.dataset.page === page) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    renderCurrentPage();
  }

  function renderAll() {
    updateTopBadges();
    renderCurrentPage();
  }

  function renderCurrentPage() {
    if (!state.snap && state.page !== "chat") return;
    if (state.page === "summary") renderSummary();
    else if (state.page === "todo") renderTodo();
    else if (state.page === "chat") renderChat();
    else if (state.page === "campus") renderCampus();
    else if (state.page === "meetings") renderMeetings();
  }

  function updateTopBadges() {
    const s = state.snap;
    if (!s) return;
    const alertsN = (s.alerts || []).length;
    const apprN = (s.approvals || []).length;
    const ac = $("alertCount");
    if (ac) ac.textContent = String(alertsN);
    const sumBadge = apprN + ((s.briefing && s.briefing.conflicts && s.briefing.conflicts.length) || 0);
    document.querySelectorAll('[data-badge="summary"]').forEach((el) => {
      el.textContent = String(sumBadge);
      el.hidden = sumBadge <= 0;
    });
  }

  /* ════════════════════════════════════════════════════════════════
     1. 요약 페이지 (Summary)
     ════════════════════════════════════════════════════════════════ */
  function renderSummary() {
    const host = $("page-summary");
    const s = state.snap;
    if (!s) { host.innerHTML = '<div class="card">불러오는 중…</div>'; return; }
    const br = s.briefing || {};
    const cats = br.categories || {};
    const today = todayIso();
    const todayEvents = (s.calendar || []).filter((e) => e.date === today);
    const meTodos = s.todos_me || [];
    const wkTodos = s.todos_work || [];
    const meetings = s.meetings || [];
    const approvals = s.approvals || [];

    const linesHtml = (br.lines || []).map((ln) => `<div style="margin-top:4px;">· ${esc(ln)}</div>`).join("");
    const impHtml = (br.important || []).length
      ? `<div class="must-box">
           <div class="must-box-title">비서가 먼저 보시라고 챙긴 것</div>
           ${(br.important || []).map((x) => `<div style="font-size:13.5px;margin-top:2px;">• ${esc(x)}</div>`).join("")}
         </div>`
      : "";
    const actsHtml = (br.actions || []).length
      ? `<div class="pill-row">
           ${(br.actions || []).map((a, idx) =>
             `<button type="button" class="btn ${idx === 0 ? "primary" : "tonal"} sm" data-br-act="${idx}">${esc(a.label)}</button>`
           ).join("")}
         </div>`
      : "";

    // 11-25 베니 님 "승인 처리가 안 되는데?": 목록이 늘 비어 있었고(PC 가 다른 이름표를 찾음) 단추 값도 승인 모듈과 달랐다.
    // 단추는 관제판 ✅ 승인 탭과 같게 — 기기: 하루 · 1주 · 1달 · 계속 · 거절, 노래 만들기: 지금 · 오늘 밤 · 거절.
    const SVC_NAME = { music: "Music Lab", musicgen: "Music Lab · 노래 만들기", game: "아케이드" };
    const PERIODS = [["day", "하루"], ["week", "1주"], ["month", "1달"], ["always", "계속"]];
    const apprBtns = (ap, i) => {
      const b = (act, label, primary) =>
        `<button type="button" class="btn ${primary ? "primary" : "tonal"} sm" data-appr-i="${i}" data-appr-act="${act}" data-appr-label="${esc(label)}">${esc(label)}</button>`;
      const deny = `<button type="button" class="btn danger sm" data-appr-i="${i}" data-appr-act="deny" data-appr-label="거절">거절</button>`;
      if (ap.svc === "musicgen") {
        return b("now", "지금", !ap.when || ap.when === "now") + b("night", "오늘 밤", ap.when === "night") + deny;
      }
      const want = ap.want || "always";
      return PERIODS.map(([k, label]) => b(k, label, k === want)).join("") + deny;
    };
    const apprCard = approvals.length
      ? `<section class="card" id="apprCard" style="border-color:rgba(220,38,38,.3);scroll-margin-top:64px;">
           <div class="card-head">
             <h2 class="card-title">🛂 승인 대기 <span class="tag urgent">${approvals.length}</span></h2>
           </div>
           <div class="list">
             ${approvals.map((ap, i) => `
               <div class="row-item">
                 <div class="row-main">
                   <div class="row-title">${esc(ap.name || "이름 없음")} <span class="tag">${esc(SVC_NAME[ap.svc] || ap.svc || "")}</span>${ap.what ? ` <span class="tag">${esc(ap.what)}</span>` : ""}</div>
                   <div class="row-sub">${esc([ap.detail, ap.svc === "musicgen" ? ap.status : (ap.want ? "바라는 기간 " + (Object.fromEntries(PERIODS)[ap.want] || "계속") : "")].filter(Boolean).join(" · "))}</div>
                   <div class="pill-row" style="margin-top:6px;">${apprBtns(ap, i)}</div>
                 </div>
               </div>
             `).join("")}
           </div>
         </section>`
      : "";

    const conflictHtml = (br.conflicts || []).length
      ? `<div class="must-box" style="margin-top:0;margin-bottom:8px;">
           <div class="must-box-title">⚠ 일정 겹침</div>
           ${(br.conflicts || []).map((c) => `<div style="font-size:13px;">${esc(c)}</div>`).join("")}
         </div>`
      : "";

    const todayCalHtml = todayEvents.length
      ? todayEvents.map((ev) => `
          <div class="row-item">
            <span class="tag primary">${esc(ev.start || "종일")}</span>
            <div class="row-main">
              <div class="row-title">${esc(ev.title)}</div>
              ${ev.calendar ? `<div class="row-sub">${esc(ev.calendar)}</div>` : ""}
            </div>
          </div>`).join("")
      : `<p class="meta" style="margin:4px 0;">오늘 등록된 일정이 없어요.</p>`;

    // 개인 할 일: 오늘 할 일 최우선 → 밀린 일 → 예정된 일 (기한 없는 '나중에'는 아래 개수 요약으로만 표시)
    const meToday = meTodos.filter((it) => it.at && it.at.slice(0, 10) === today);
    const meOver = meTodos.filter((it) => it.at && it.at.slice(0, 10) < today).sort((a, b) => a.at.localeCompare(b.at));
    const meFuture = meTodos.filter((it) => it.at && it.at.slice(0, 10) > today).sort((a, b) => a.at.localeCompare(b.at));
    const meLater = meTodos.filter((it) => !it.at);
    const sortedMe = [...meToday, ...meOver, ...meFuture].slice(0, 5);
    const extraInfo = [
      meFuture.length ? `예정 ${meFuture.length}건` : "",
      meLater.length ? `나중에 ${meLater.length}건` : "",
    ].filter(Boolean).join(" · ");
    const meCardHtml = (sortedMe.length
      ? sortedMe.map((it) => {
          const isOver = it.at && it.at.slice(0, 10) < today;
          const isToday = it.at && it.at.slice(0, 10) === today;
          return `<div class="row-item">
            <button type="button" class="btn sm" data-done-box="me" data-done-id="${it.id}" title="완료">✓</button>
            <div class="row-main">
              <div class="row-title">${esc(it.text)}</div>
              <div class="row-sub">
                ${it.at ? `<span class="tag ${isOver ? "urgent" : (isToday ? "primary" : "")}">${esc(shortDate(it.at))}${it.day ? "" : " " + esc(it.at.slice(11, 16))}</span>` : ""}
                ${it.pri === "high" ? `<span class="tag urgent">중요</span>` : ""}
              </div>
            </div>
            <button type="button" class="btn sm" data-defer-box="me" data-defer-id="${it.id}" title="미루기 · 나중에">⏰</button>
          </div>`;
        }).join("")
      : `<p class="meta" style="margin:4px 0;">오늘 급한 개인 할 일이 없어요.</p>`)
      + (extraInfo ? `<div class="small" style="margin-top:8px;padding-top:6px;border-top:1px dashed var(--line);cursor:pointer;" id="sumExtraTodo">📌 ${esc(extraInfo)} 보관 중 →</div>` : "");

    // 직통 모드 전용: 회사 할 일 + 최근 회의
    let workCard = "";
    if (state.mode === "direct") {
      const topWork = wkTodos.slice(0, 4);
      const topMeet = meetings.slice(0, 3);
      workCard = `<section class="card">
        <div class="card-head">
          <h2 class="card-title">💼 회사 · 회의 <span class="tag">${wkTodos.length + topMeet.length}</span></h2>
          <button type="button" class="btn sm" id="goMeetingsBtn">회의록 →</button>
        </div>
        ${topWork.length ? `<div class="list">${topWork.map((it) => `
          <div class="row-item">
            <button type="button" class="btn sm" data-done-box="work" data-done-id="${it.id}" title="완료">✓</button>
            <div class="row-main">
              <div class="row-title">${esc(it.text)}</div>
              ${it.at ? `<div class="row-sub">${esc(shortDate(it.at))}</div>` : `<div class="row-sub"><span class="tag">나중에</span></div>`}
            </div>
            <button type="button" class="btn sm" data-defer-box="work" data-defer-id="${it.id}" title="미루기 · 나중에">⏰</button>
          </div>`).join("")}</div>` : ""}
        ${topMeet.length ? `<div class="list" style="margin-top:6px;">${topMeet.map((m) => `
          <div class="row-item" style="cursor:pointer;" data-open-meet="${esc(m.id)}">
            <span class="tag primary">회의</span>
            <div class="row-main">
              <div class="row-title">${esc(m.title || m.id)}</div>
              <div class="row-sub">${esc(String(m.created || "").slice(0, 16))} · ${esc(m.summary || m.status || "")}</div>
            </div>
          </div>`).join("")}</div>` : ""}
      </section>`;
    }

    const msgCat = cats.messages || {};
    const sysCat = cats.system || {};
    const wosCat = cats.wos || {};

    host.innerHTML = `
      <section class="card hero">
        <div class="card-head">
          <h2 class="card-title">✨ 베니 비서 브리핑</h2>
          <span class="small">${esc((br.updated_at || s.updated || "").slice(5, 16))}</span>
        </div>
        <div style="font-size:16px;font-weight:800;letter-spacing:-0.01em;">${esc(br.headline || "현황을 확인했어요.")}</div>
        <div style="margin-top:6px;font-size:13.8px;color:var(--ink-2);">${linesHtml}</div>
        ${impHtml}
        ${actsHtml}
      </section>

      ${apprCard}

      <div class="grid-2">
        <section class="card">
          <div class="card-head">
            <h2 class="card-title">📅 오늘 일정 <span class="tag">${todayEvents.length}</span></h2>
            <button type="button" class="btn sm" id="sumAddCal">+ 일정</button>
          </div>
          ${conflictHtml}
          <div class="list">${todayCalHtml}</div>
        </section>

        <section class="card">
          <div class="card-head">
            <h2 class="card-title">🏠 개인 할 일 <span class="tag">${meTodos.length}</span></h2>
            <button type="button" class="btn sm" id="sumGoTodo">전체 →</button>
          </div>
          <div class="list">${meCardHtml}</div>
        </section>
      </div>

      ${workCard}

      <section class="card">
        <div class="card-head">
          <h2 class="card-title">📡 메시지 · PC 상태</h2>
          <button type="button" class="btn sm" id="sumKakaoBtn">카톡 스캔</button>
        </div>
        <div class="list">
          <div class="row-item">
            <span class="tag">카톡</span>
            <div class="row-main"><div class="row-title">${esc(msgCat.note || "확인 전")}</div></div>
          </div>
          <div class="row-item">
            <span class="tag">WOS</span>
            <div class="row-main"><div class="row-title">${esc(wosCat.note || "특이사항 없음")}</div></div>
          </div>
          <div class="row-item">
            <span class="tag ${sysCat.faults ? "urgent" : "ok"}">PC</span>
            <div class="row-main"><div class="row-title">${esc(sysCat.note || "정상")}</div></div>
          </div>
        </div>
      </section>
    `;

    // 이벤트 바인딩
    host.querySelectorAll("[data-br-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const a = (br.actions || [])[Number(btn.dataset.brAct)];
        if (!a) return;
        if (a.kind === "ai_organize") openOrganizeModal(a.arg === "work" && state.mode === "direct" ? "work" : "me");
        else if (a.kind === "kakao_scan") openKakaoModal(true);
        else if (a.kind === "ask") askAssistant(a.arg);
        else if (a.kind === "approvals") {
          const card = $("apprCard");   // 승인 단추는 알림함이 아니라 승인 대기 카드에 있다
          if (card) card.scrollIntoView({ block: "start" });   // 부드러운 스크롤은 WebView 가 가끔 멈춰 바로 옮김
          else { toast("승인 목록을 다시 받는 중…"); loadSnapshot(true); }
        }
        else if (a.kind === "alert_cat") openAlertsModal();
      });
    });

    host.querySelectorAll("[data-appr-i]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ap = approvals[Number(btn.dataset.apprI)];
        if (!ap) return;
        const row = btn.closest(".pill-row");
        const all = row ? row.querySelectorAll("button") : [btn];
        all.forEach((x) => { x.disabled = true; });   // 한 요청에 두 번 보내지 않게 그 줄 단추를 다 잠금
        try {
          const res = await sendCmd("access_decide", {
            svc: ap.svc || "", id: ap.id || "",
            action: btn.dataset.apprAct, perm: ap.perm || "",
          });
          if (res && res.ok !== false) {
            toast(`${ap.name || "요청"} · ${btn.dataset.apprLabel || "처리"} 했어요`);
            return;   // 성공하면 sendCmd 가 현황을 다시 받아 카드를 새로 그림
          }
          toast((res && res.error) || "처리 실패", 3500);
        } catch (e) { toast(e.message || "처리 실패", 3500); }
        all.forEach((x) => { x.disabled = false; });
      });
    });

    host.querySelectorAll("[data-done-id]").forEach((btn) => {
      btn.addEventListener("click", () => toggleTodoDone(btn.dataset.doneBox, Number(btn.dataset.doneId), true, btn));
    });

    host.querySelectorAll("[data-defer-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const box = btn.dataset.deferBox;
        const id = Number(btn.dataset.deferId);
        const list = box === "work" ? wkTodos : meTodos;
        const item = list.find((x) => x.id === id);
        if (item) openTodoDeferModal(box, item);
      });
    });

    host.querySelectorAll("[data-open-meet]").forEach((row) => {
      row.addEventListener("click", () => openMeetingDetail(row.dataset.openMeet));
    });

    const bCal = $("sumAddCal");
    if (bCal) bCal.addEventListener("click", openCalendarAddModal);
    const bTodo = $("sumGoTodo");
    if (bTodo) bTodo.addEventListener("click", () => switchPage("todo"));
    const bExTodo = $("sumExtraTodo");
    if (bExTodo) bExTodo.addEventListener("click", () => switchPage("todo"));
    const bMeet = $("goMeetingsBtn");
    if (bMeet) bMeet.addEventListener("click", () => switchPage("meetings"));
    const bKakao = $("sumKakaoBtn");
    if (bKakao) bKakao.addEventListener("click", () => openKakaoModal(true));
  }

  async function toggleTodoDone(box, id, done, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await sendCmd("todo_done", { box, id, done });
      if (res && res.ok) {
        toast(done ? "완료했어요 ✓" : "다시 열었어요");
        // 낙관적 UI 즉시 반영
        if (state.snap) {
          const key = box === "work" ? "todos_work" : "todos_me";
          if (done) state.snap[key] = (state.snap[key] || []).filter((x) => x.id !== id);
          renderCurrentPage();
        }
      } else {
        toast((res && res.error) || "변경하지 못했어요");
      }
    } catch (e) {
      toast(e.message || "오류");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ════════════════════════════════════════════════════════════════
     2. 할 일 · 일정 페이지 (Todo & Calendar)
     ════════════════════════════════════════════════════════════════ */
  function renderTodo() {
    const host = $("page-todo");
    const s = state.snap;
    if (!s) return;
    if (state.mode !== "direct") state.todoBox = "me";
    const today = todayIso();
    const list = state.todoBox === "work" ? (s.todos_work || []) : (s.todos_me || []);
    const doneList = state.todoBox === "me" ? (s.todos_me_done || []) : [];

    const dueList = list.filter((it) => it.at && it.at.slice(0, 10) <= today)
      .sort((a, b) => {
        const aT = a.at.slice(0, 10) === today ? 0 : 1;
        const bT = b.at.slice(0, 10) === today ? 0 : 1;
        return aT !== bT ? aT - bT : a.at.localeCompare(b.at);
      });
    const futureList = list.filter((it) => it.at && it.at.slice(0, 10) > today)
      .sort((a, b) => a.at.localeCompare(b.at));
    const laterList = list.filter((it) => !it.at);

    const renderTodoRow = (it) => {
      const isOver = it.at && it.at.slice(0, 10) < today;
      const isToday = it.at && it.at.slice(0, 10) === today;
      return `<div class="row-item">
        <button type="button" class="btn sm" data-td-done="${it.id}" title="완료">✓</button>
        <div class="row-main">
          <div class="row-title">${esc(it.text)}</div>
          <div class="row-sub">
            ${it.at
              ? `<span class="tag ${isOver ? "urgent" : (isToday ? "primary" : "")}">${esc(shortDate(it.at))}${it.day ? "" : " " + esc(it.at.slice(11, 16))}</span>`
              : `<span class="tag">나중에</span>`}
            ${it.pri === "high" ? `<span class="tag urgent">중요</span>` : ""}
            ${it.repeat ? `<span class="tag">반복 ${esc(it.repeat)}</span>` : ""}
            ${it.note ? `<div>${esc(it.note)}</div>` : ""}
          </div>
        </div>
        <div class="row-acts">
          <button type="button" class="btn sm" data-td-defer="${it.id}" title="미루기 · 나중에 · 수정">⏰</button>
          <button type="button" class="btn sm danger" data-td-del="${it.id}" title="삭제">✕</button>
        </div>
      </div>`;
    };

    const boxSwitch = state.mode === "direct"
      ? `<div class="pill-row" style="margin-top:0;margin-bottom:10px;">
           <button type="button" class="btn sm ${state.todoBox === "me" ? "primary" : ""}" data-tbox="me">🏠 개인 (${(s.todos_me || []).length})</button>
           <button type="button" class="btn sm ${state.todoBox === "work" ? "primary" : ""}" data-tbox="work">💼 회사 (${(s.todos_work || []).length})</button>
         </div>`
      : `<p class="small" style="margin:0 0 8px;">개인 할 일 (회사 할 일은 집 PC·폰 직통 전용)</p>`;

    // 향후 14일 일정 날짜별 묶기
    const calMap = new Map();
    (s.calendar || []).forEach((ev) => {
      const d = ev.date || "";
      if (!calMap.has(d)) calMap.set(d, []);
      calMap.get(d).push(ev);
    });
    const calHtml = [...calMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, evs]) => `
      <div class="row-item">
        <span class="tag ${d === today ? "primary" : ""}" style="min-width:68px;text-align:center;">${esc(shortDate(d))}</span>
        <div class="row-main">
          ${evs.map((ev) => `<div style="margin-bottom:3px;"><b>${esc(ev.start || "종일")}</b> ${esc(ev.title)} <span class="small">${esc(ev.calendar || "")}</span></div>`).join("")}
        </div>
      </div>`).join("") || `<p class="meta">등록된 14일 일정이 없어요.</p>`;

    const wkndIso = nextWeekendIso();
    const monIso = nextMondayIso();
    const tmrwIso = addDaysIso(1);

    host.innerHTML = `
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">✅ 할 일</h2>
          <button type="button" class="btn tonal sm" id="tdAiOrg">✨ 밀린 일 정리</button>
          <button type="button" class="btn sm" id="tdAiCap">✨ 한 번에 입력</button>
        </div>
        ${boxSwitch}
        <form id="todoAddForm" style="margin-bottom:10px;">
          <div class="input-row">
            <input id="todoTextIn" type="text" placeholder="새 할 일 입력…" style="flex:1;min-width:160px;" maxlength="140" required>
            <input id="todoDateIn" type="date" value="${today}" title="기한 날짜 (비우면 '나중에' 보관)">
            <label class="small" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
              <input id="todoPriIn" type="checkbox"> 중요
            </label>
            <button type="submit" class="btn primary sm" id="todoAddBtn">추가</button>
          </div>
          <div class="pill-row" style="margin-top:6px;">
            <span class="small" style="align-self:center;">언제:</span>
            <button type="button" class="btn sm" data-add-preset="${today}">오늘</button>
            <button type="button" class="btn sm" data-add-preset="${tmrwIso}">내일</button>
            <button type="button" class="btn sm" data-add-preset="${wkndIso}">이번 주말(${esc(shortDate(wkndIso))})</button>
            <button type="button" class="btn sm" data-add-preset="${monIso}">다음 주</button>
            <button type="button" class="btn sm tonal" data-add-preset="">📌 나중에(기한 없음)</button>
          </div>
        </form>
        ${dueList.length ? `<div class="todo-sec-hdr">🔥 오늘 · 밀린 일 <span class="tag">${dueList.length}</span></div><div class="list">${dueList.map(renderTodoRow).join("")}</div>` : ""}
        ${futureList.length ? `<div class="todo-sec-hdr">📆 예정된 할 일 <span class="tag primary">${futureList.length}</span></div><div class="list">${futureList.map(renderTodoRow).join("")}</div>` : ""}
        ${laterList.length ? `<div class="todo-sec-hdr">📌 나중에 · 잊지 않기 <span class="tag">${laterList.length}</span></div><div class="list">${laterList.map(renderTodoRow).join("")}</div>` : ""}
        ${!list.length ? `<p class="meta">남은 할 일이 없어요.</p>` : ""}
        ${doneList.length ? `<details style="margin-top:10px;"><summary class="small" style="cursor:pointer;">최근 완료 (${doneList.length})</summary>
          <div class="list" style="margin-top:6px;">
            ${doneList.slice().reverse().map((it) => `
              <div class="row-item">
                <div class="row-main"><div class="row-title" style="text-decoration:line-through;color:var(--ink-3);">${esc(it.text)}</div></div>
                <button type="button" class="btn sm" data-td-reopen="${it.id}">되돌리기</button>
              </div>`).join("")}
          </div></details>` : ""}
      </section>

      <section class="card">
        <div class="card-head">
          <h2 class="card-title">📅 TimeTree 일정 (향후 14일)</h2>
          <button type="button" class="btn primary sm" id="tdAddCal">+ 일정 추가</button>
        </div>
        <div class="list">${calHtml}</div>
      </section>
    `;

    host.querySelectorAll("[data-tbox]").forEach((b) => {
      b.addEventListener("click", () => { state.todoBox = b.dataset.tbox; renderTodo(); });
    });
    host.querySelectorAll("[data-add-preset]").forEach((b) => {
      b.addEventListener("click", () => {
        $("todoDateIn").value = b.dataset.addPreset;
        toast(b.dataset.addPreset ? `기한을 ${shortDate(b.dataset.addPreset)}로 맞췄어요` : "📌 나중에(기한 없음)로 맞췄어요", 1500);
      });
    });
    $("tdAiOrg").addEventListener("click", () => openOrganizeModal(state.todoBox));
    $("tdAiCap").addEventListener("click", openCaptureModal);
    $("tdAddCal").addEventListener("click", openCalendarAddModal);

    $("todoAddForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const txt = $("todoTextIn").value.trim();
      if (!txt) return;
      const btn = $("todoAddBtn");
      btn.disabled = true;
      try {
        const atVal = $("todoDateIn").value || "";
        const res = await sendCmd("todo_add", {
          box: state.todoBox,
          text: txt,
          at: atVal,
          day: Boolean(atVal),
          pri: $("todoPriIn").checked ? "high" : "",
        });
        if (res && res.ok) {
          $("todoTextIn").value = "";
          $("todoPriIn").checked = false;
          toast(atVal ? "할 일을 추가했어요" : "📌 '나중에 · 잊지 않기'에 담았어요");
          await loadSnapshot(true);
        } else {
          toast((res && res.error) || "추가 실패", 3500);
        }
      } catch (err) { toast(err.message, 3500); }
      btn.disabled = false;
    });

    host.querySelectorAll("[data-td-done]").forEach((b) => {
      b.addEventListener("click", () => toggleTodoDone(state.todoBox, Number(b.dataset.tdDone), true, b));
    });
    host.querySelectorAll("[data-td-defer]").forEach((b) => {
      b.addEventListener("click", () => {
        const it = list.find((x) => x.id === Number(b.dataset.tdDefer));
        if (it) openTodoDeferModal(state.todoBox, it);
      });
    });
    host.querySelectorAll("[data-td-reopen]").forEach((b) => {
      b.addEventListener("click", () => toggleTodoDone("me", Number(b.dataset.tdReopen), false, b));
    });
    host.querySelectorAll("[data-td-del]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = Number(b.dataset.tdDel);
        b.disabled = true;
        try {
          const res = await sendCmd("todo_delete", { box: state.todoBox, id });
          if (res && res.ok) { toast("삭제했어요"); await loadSnapshot(true); }
          else toast((res && res.error) || "삭제 실패");
        } catch (err) { toast(err.message); }
        b.disabled = false;
      });
    });
  }

  function openTodoDeferModal(box, item) {
    const today = todayIso();
    const tmrw = addDaysIso(1);
    const wknd = nextWeekendIso();
    const mon = nextMondayIso();
    const curDate = (item.at || "").slice(0, 10);

    openModal("⏰ 할 일 미루기 · 수정", `
      <div style="font-weight:700;margin-bottom:6px;">${esc(item.text)}</div>
      <div class="small" style="margin-bottom:10px;">
        현재: ${item.at ? esc(shortDate(item.at)) : "📌 나중에 (기한 없음)"}
      </div>
      <div class="pill-row" style="margin-top:0;margin-bottom:12px;">
        <button type="button" class="btn sm tonal" data-qdate="${today}">📅 오늘</button>
        <button type="button" class="btn sm tonal" data-qdate="${tmrw}">🌅 내일</button>
        <button type="button" class="btn sm primary" data-qdate="${wknd}">🛋 이번 주말(${esc(shortDate(wknd))})</button>
        <button type="button" class="btn sm tonal" data-qdate="${mon}">📆 다음 주(${esc(shortDate(mon))})</button>
        <button type="button" class="btn sm" data-qdate="">📌 나중에 (기한 없음)</button>
      </div>
      <p class="small" style="margin:0 0 12px;">※ <b>📌 나중에</b>로 두면 밀린 일·브리핑 알림에서 빠지고, 할 일 탭 아래 '나중에 · 잊지 않기' 목록에 안전하게 남아요.</p>
      <form id="tdEditForm" style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--line);padding-top:10px;">
        <input id="teText" type="text" value="${esc(item.text)}" maxlength="140" required>
        <div class="input-row">
          <input id="teDate" type="date" value="${esc(curDate)}" style="flex:1;" title="직접 날짜 지정 (비우면 나중에)">
          <label class="small" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
            <input id="tePri" type="checkbox" ${item.pri === "high" ? "checked" : ""}> 중요
          </label>
        </div>
        <input id="teNote" type="text" value="${esc(item.note || "")}" placeholder="메모 (선택)" maxlength="240">
        <button type="submit" class="btn primary" id="teSaveBtn">저장</button>
      </form>
    `, (root) => {
      const applyUpdate = async (payload, okMsg) => {
        try {
          const r = await sendCmd("todo_update", Object.assign({ box, id: item.id }, payload));
          if (r && r.ok) {
            toast(okMsg || "반영했어요 ✓");
            closeModal();
            await loadSnapshot(true);
          } else {
            toast((r && r.error) || "변경하지 못했어요", 3500);
          }
        } catch (err) { toast(err.message, 3500); }
      };
      root.querySelectorAll("[data-qdate]").forEach((b) => {
        b.addEventListener("click", () => {
          b.disabled = true;
          const d = b.dataset.qdate;
          const msg = d ? `${shortDate(d)}로 미뤘어요 ✓` : "📌 '나중에 · 잊지 않기'로 옮겼어요 ✓";
          applyUpdate({ at: d, day: Boolean(d) }, msg);
        });
      });
      $("tdEditForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        $("teSaveBtn").disabled = true;
        const d = $("teDate").value || "";
        await applyUpdate({
          text: $("teText").value.trim(),
          at: d,
          day: Boolean(d),
          pri: $("tePri").checked ? "high" : "",
          note: $("teNote").value.trim(),
        }, "할 일을 수정했어요 ✓");
        $("teSaveBtn").disabled = false;
      });
    });
  }

  /* ════════════════════════════════════════════════════════════════
     3. 대화 페이지 (Chat)
     ════════════════════════════════════════════════════════════════ */
  function renderChat() {
    const host = $("page-chat");
    const chips = [
      "오늘 일정이랑 밀린 개인 할 일 요약해줘",
      "카톡 안 읽은 방 확인해줘",
      "PC 상태 어때?",
      "이번 주 AI 레이더 핵심만 알려줘",
    ];
    host.innerHTML = `
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">베니 비서와 대화</h2>
          ${Native && Native.openNativeChat ? `<button type="button" class="btn tonal sm" id="chatOpenNative">폰 비서로 열기</button>` : `<span class="small">${state.mode === "direct" ? "직통" : "보안 모드"}</span>`}
        </div>
        <p class="small" style="margin:0 0 8px;">${state.mode === "direct"
          ? "집 PC 비서는 파일을 읽고 답만 합니다. 할 일 · 일정 넣기는 '입력' 창으로 열어 드려요."
          : "보안 모드: 집 PC 파일은 안 읽고 답합니다. 이 대화는 Firebase 를 거치니 회사 내용은 적지 마세요."}</p>
        <div class="pill-row" style="margin-top:0;margin-bottom:10px;">
          ${chips.map((c) => `<button type="button" class="btn sm tonal" data-qchip="${esc(c)}">${esc(c)}</button>`).join("")}
        </div>
        <div class="chat-log" id="chatLog">
          ${state.chat.map((m) => `<div class="bubble ${m.role === "me" ? "me" : "bot"}">${esc(m.text)}</div>`).join("")}
          ${state.chatBusy ? `<div class="bubble bot"><span class="spinner"></span> 집 PC 비서가 생각하는 중…</div>` : ""}
        </div>
        <form id="chatForm" class="input-row" style="margin-top:8px;">
          <input id="chatIn" type="text" placeholder="무엇을 도와드릴까요?" style="flex:1;" autocomplete="off" ${state.chatBusy ? "disabled" : ""}>
          <button type="submit" class="btn primary" ${state.chatBusy ? "disabled" : ""}>보내기</button>
        </form>
      </section>
    `;
    const logEl = $("chatLog");
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
    const nativeBtn = $("chatOpenNative");
    if (nativeBtn) nativeBtn.addEventListener("click", () => Native && Native.openNativeChat && Native.openNativeChat());
    host.querySelectorAll("[data-qchip]").forEach((b) => {
      b.addEventListener("click", () => sendChatText(b.dataset.qchip));
    });
    $("chatForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("chatIn").value.trim();
      if (!v) return;
      $("chatIn").value = "";
      sendChatText(v);
    });
  }

  /* 대화 기록: 이 탭(sessionStorage)에만 — 화면을 다시 열어도 앞 대화가 남게 (탭을 닫으면 지워짐).
     폰 앱 안(WebView)에서는 저장하지 않는다 — 답에 회사 할 일 · 회의 글이 섞이면 폰 저장소에 남을 수 있어서 (11-25 보안 검토).
     폰에서 '대화'는 어차피 폰 비서로 간다. */
  const CHAT_KEY = "benny_chat_v1";
  function saveChat() {
    if (Native) return;
    try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(state.chat.slice(-40))); } catch (_) {}
  }
  try {
    if (Native) sessionStorage.removeItem(CHAT_KEY);
    const saved = Native ? null : JSON.parse(sessionStorage.getItem(CHAT_KEY) || "null");
    if (Array.isArray(saved) && saved.length) state.chat = saved.filter((m) => m && typeof m.text === "string").slice(-40);
  } catch (_) {}

  /** 요약의 '비서에게 묻기' 같은 질문: 폰 앱이면 폰 비서로, 아니면 웹 대화로 */
  function askAssistant(text) {
    if (Native && Native.askNative) { Native.askNative(String(text || "")); return; }
    switchPage("chat");
    sendChatText(text);
  }

  async function sendChatText(text) {
    if (!text || state.chatBusy) return;
    state.chat.push({ role: "me", text });
    // 할 일 · 일정 넣기는 읽기 전용 PC 비서가 못 한다 → 넣기 창을 열어 바로 분해
    if (/(할\s*일|일정|약속|캘린더)/.test(text) && /(추가|넣어|등록|잡아|적어)/.test(text)) {
      state.chat.push({ role: "bot", text: "할 일 · 일정 넣기 창을 열었어요. 나눈 항목을 확인하고 '선택 항목 저장'을 눌러 주세요." });
      saveChat();
      renderChat();
      openCaptureModal();
      const ta = $("capText");
      if (ta) { ta.value = text; const b = $("capParseBtn"); if (b) b.click(); }
      return;
    }
    state.chatBusy = true;
    saveChat();
    renderChat();
    try {
      let reply = "";
      if (/카톡.*안\s*읽|카톡.*스캔/.test(text)) {
        const res = await sendCmd("kakao_unread", {}, 90000);
        reply = res.ok ? (res.text || "스캔 완료") : (res.error || "카톡 확인 실패");
      } else {
        const res = await sendCmd("ask", { text }, 120000);
        reply = res.ok ? (res.answer || "(응답 없음)") : (res.error || "답변을 받지 못했어요");
      }
      state.chat.push({ role: "bot", text: reply });
    } catch (e) {
      state.chat.push({ role: "bot", text: "응답 실패: " + (e.message || "집 PC 에 닿지 않아요") });
    } finally {
      state.chatBusy = false;
      saveChat();
      renderChat();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     4. 베니 캠퍼스 페이지 (오늘 공부 / 주간 레이더 / 사전·포털)
     ════════════════════════════════════════════════════════════════ */
  function renderCampus() {
    const host = $("page-campus");
    const c = (state.snap && state.snap.campus) || {};
    const tabs = [
      { id: "today", label: "오늘 공부" },
      { id: "radar", label: "주간 레이더" },
      { id: "dict", label: "사전 · 포털" },
    ];
    host.innerHTML = `
      <div class="sub-tablist" role="tablist" aria-label="베니 캠퍼스 탭">
        ${tabs.map((t) => `
          <button type="button" role="tab" id="ctab-${t.id}" aria-controls="cpanel-${t.id}"
            aria-selected="${state.campusTab === t.id ? "true" : "false"}"
            tabindex="${state.campusTab === t.id ? "0" : "-1"}" data-ctab="${t.id}">
            ${esc(t.label)}
          </button>`).join("")}
      </div>
      <div id="cpanel-today" role="tabpanel" aria-labelledby="ctab-today" ${state.campusTab === "today" ? "" : "hidden"}></div>
      <div id="cpanel-radar" role="tabpanel" aria-labelledby="ctab-radar" ${state.campusTab === "radar" ? "" : "hidden"}></div>
      <div id="cpanel-dict" role="tabpanel" aria-labelledby="ctab-dict" ${state.campusTab === "dict" ? "" : "hidden"}></div>
    `;

    // 접근성 탭 키보드 내비게이션 (ArrowLeft/ArrowRight/Home/End)
    const tabBtns = [...host.querySelectorAll('[role="tab"]')];
    tabBtns.forEach((btn, idx) => {
      btn.addEventListener("click", () => { state.campusTab = btn.dataset.ctab; renderCampus(); });
      btn.addEventListener("keydown", (e) => {
        let next = -1;
        if (e.key === "ArrowRight") next = (idx + 1) % tabBtns.length;
        else if (e.key === "ArrowLeft") next = (idx - 1 + tabBtns.length) % tabBtns.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabBtns.length - 1;
        if (next >= 0) {
          e.preventDefault();
          state.campusTab = tabBtns[next].dataset.ctab;
          renderCampus();
          const nb = $("ctab-" + state.campusTab);
          if (nb) nb.focus();
        }
      });
    });

    if (state.campusTab === "today") renderCampusToday($("cpanel-today"), c);
    else if (state.campusTab === "radar") renderCampusRadar($("cpanel-radar"), c);
    else renderCampusDict($("cpanel-dict"));
  }

  function renderCampusToday(panel, c) {
    const h = c.habit || null;
    const lang = c.lang || {};
    const qcards = c.quick_cards || [];
    const due = Number(c.review_due || 0);
    const dueL = lang.ok ? Number(lang.due_total || 0) : 0;
    const nextL = c.next || null;
    const isDirect = state.mode === "direct";

    // 1) 주간 목표 · 공부 약속
    let habitHtml = "";
    if (h) {
      const days = h.days || [];
      // 공부방 habit.days = 월~일 7칸 {d: 날짜, on: true · false · null(오늘 뒤)} (11-25 옛 이름 done · future · label 을 읽어 늘 빈 점이었음)
      const WD = ["월", "화", "수", "목", "금", "토", "일"];
      const dots = days.map((d, i) => `<span class="wdot ${d.on === true ? "on" : (d.on === null ? "future" : "")}">${WD[i] || ""}</span>`).join("");
      const planLine = h.plan
        ? `약속: ${esc(h.plan)}${h.at ? ` (${esc(h.at)})` : ""}`
        : "공부 약속을 정해두면 매일 한 번 알려드려요";
      habitHtml = `<section class="card">
        <div class="card-head">
          <h2 class="card-title">🗓 이번 주 ${Number(h.done || 0)}/${Number(h.goal || 5)}일 ${h.streak ? `<span class="tag ok">${h.streak}일 연속</span>` : ""}</h2>
          <button type="button" class="btn sm" id="cGoalBtn">목표 ${Number(h.goal || 5)}일</button>
          <button type="button" class="btn sm" id="cPlanBtn">약속 수정</button>
        </div>
        <div class="week-dots">${dots}</div>
        <div class="row-sub" style="margin-top:8px;">${planLine}</div>
      </section>`;
    }

    // 2) 오늘의 15분 코어 루틴
    const vocabSub = lang.ok
      ? (dueL > 0 ? `복습 ${dueL}개 · 오늘 ${lang.vocab_today_reviewed || 0}개 완료` : `오늘 ${lang.vocab_today_reviewed || 0}개 · 전체 ${lang.vocab_total || 0}단어`)
      : "어학관 영단어 복습";
    const step2Title = due > 0 ? `② 밀린 복습 ${due}개 끝내기` : (nextL && nextL.title ? `② 이어서: ${nextL.title}` : "② 오늘의 설계·AI 레슨");
    const step2Sub = due > 0 ? "간격 반복 복습부터 먼저 끝내요" : ((nextL && nextL.stage) || "베니 캠퍼스 본관");

    const routineHtml = `<section class="card hero">
      <div class="card-head">
        <h2 class="card-title">🎯 오늘의 15분 코어 루틴</h2>
        ${isDirect ? `<button type="button" class="btn sm" id="cOpenWeb">캠퍼스 웹 ↗</button>` : `<span class="tag">요약 · 퀴즈 동기화</span>`}
      </div>
      <button type="button" class="step-btn ${dueL > 0 ? "primary-step" : ""}" id="cStep1">
        <span style="font-size:20px;">🇬🇧</span>
        <div class="row-main">
          <div class="row-title">① 영단어 3분 복습</div>
          <div class="row-sub">${esc(vocabSub)}</div>
        </div>
        <span>${isDirect ? "↗" : "집 PC"}</span>
      </button>
      <button type="button" class="step-btn ${dueL === 0 ? "primary-step" : ""}" id="cStep2">
        <span style="font-size:20px;">📘</span>
        <div class="row-main">
          <div class="row-title">${esc(step2Title)}</div>
          <div class="row-sub">${esc(step2Sub)}</div>
        </div>
        <span>${isDirect ? "↗" : "집 PC"}</span>
      </button>
    </section>`;

    // 3) 1분 퀴즈 (웹·회사 PC에서도 즉시 채점 & 집 PC 동기화!)
    let quizHtml = "";
    if (qcards.length) {
      if (state.quickIdx >= qcards.length) state.quickIdx = 0;
      const card = qcards[state.quickIdx];
      const key = `${card.sid || ""}:${card.lid || ""}:${card.id || state.quickIdx}`;
      const isReview = card.mode === "review";
      const revealed = state.revealedKey === key;
      const ansTxt = isReview ? (state.reviewAnswers[key] || card.a || "") : (card.a || card.hint || "");
      const sure = state.sureByKey[key] || "";
      const ivls = card.ivl || {};
      const grades = [
        ["again", "다시"], ["hard", "어려움"], ["good", "알았음"], ["easy", "쉬움"],
      ];
      quizHtml = `<section class="card">
        <div class="card-head">
          <h2 class="card-title">⚡ 1분 퀴즈 <span class="tag primary">${state.quickIdx + 1}/${qcards.length}</span></h2>
          <button type="button" class="btn sm" id="qNextBtn">다음 문제 →</button>
        </div>
        <div class="small">${esc(card.subject_title || card.sid || "")} ${card.lesson_title ? "· " + esc(card.lesson_title) : ""}</div>
        <div style="font-size:15px;font-weight:700;margin:8px 0;">${esc(card.q || card.title || "")}</div>
        ${isReview && !revealed ? `
          <div class="pill-row" style="margin-top:6px;">
            <span class="small" style="align-self:center;">확신도:</span>
            ${[["no", "모름"], ["maybe", "반반"], ["yes", "확실"]].map(([k, lbl]) =>
              `<button type="button" class="btn sm ${sure === k ? "primary" : ""}" data-sure="${k}">${lbl}</button>`
            ).join("")}
          </div>` : ""}
        <div class="pill-row">
          <button type="button" class="btn tonal sm" id="qRevealBtn">${revealed ? "답 숨기기" : "답 보기"}</button>
          ${!isReview ? `<button type="button" class="btn primary sm" id="qDoneBtn">완료 체크</button>` : ""}
        </div>
        ${revealed ? `
          <div class="must-box" style="border-color:var(--primary-line);background:var(--surface-2);">
            <div style="font-weight:700;font-size:12px;color:var(--primary);margin-bottom:4px;">모범 답안</div>
            <div style="white-space:pre-wrap;font-size:13.5px;">${esc(ansTxt || "(모범 답 없음)")}</div>
          </div>` : ""}
        ${isReview ? `
          <div class="pill-row">
            ${grades.map(([g, lbl]) => {
              const iv = ivls[g] ? ` (${ivls[g]}일)` : "";
              return `<button type="button" class="btn sm ${g === "good" ? "primary" : ""}" data-grade="${g}">${lbl}${iv}</button>`;
            }).join("")}
          </div>` : ""}
      </section>`;
    }

    // 4) 과목별 진도
    const subs = c.subjects || [];
    const subHtml = subs.length
      ? `<section class="card">
           <div class="card-head"><h2 class="card-title">📚 과목 진도</h2></div>
           <div class="list">
             ${subs.map((s) => {
               const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
               return `<div class="row-item">
                 <div class="row-main">
                   <div class="row-title">${esc(s.title)} <span class="small">${s.done}/${s.total} (${pct}%)</span></div>
                   ${s.next_title ? `<div class="row-sub">다음: ${esc(s.next_title)}</div>` : ""}
                 </div>
                 ${isDirect && s.id ? `<button type="button" class="btn sm" data-sub-open="${esc(s.id)}">열기 ↗</button>` : ""}
               </div>`;
             }).join("")}
           </div>
         </section>`
      : "";

    panel.innerHTML = habitHtml + routineHtml + quizHtml + subHtml;

    // 이벤트 연결
    if (h) {
      const gb = $("cGoalBtn");
      if (gb) gb.addEventListener("click", async () => {
        const nextG = ((Number(h.goal || 5) - 3 + 1) % 5) + 3; // 3→4→5→6→7→3
        gb.disabled = true;
        try {
          const res = await sendCmd("campus_habit", { goal: nextG });
          toast(res.ok ? `주간 목표 ${nextG}일로 바꿨어요` : (res.error || "저장 실패"));
        } catch (e) { toast(e.message); }
        gb.disabled = false;
      });
      const pb = $("cPlanBtn");
      if (pb) pb.addEventListener("click", () => openHabitPlanModal(h));
    }
    const cw = $("cOpenWeb");
    if (cw) cw.addEventListener("click", () => openUrl(TS_HOST + ":8810/"));
    $("cStep1").addEventListener("click", () => {
      if (isDirect) openUrl(TS_HOST + ":8820/?lang=en&tab=vocab&start=1");
      else toast("어학관 오디오 훈련은 집 PC·폰(Tailscale)에서 바로 열려요");
    });
    $("cStep2").addEventListener("click", () => {
      if (isDirect) openUrl(TS_HOST + ":8810/");
      else toast("본관 전체 레슨은 집 PC·폰(Tailscale)에서 열려요. 아래 1분 퀴즈는 여기서 바로 풀 수 있어요!");
    });
    panel.querySelectorAll("[data-sub-open]").forEach((b) => {
      b.addEventListener("click", () => openUrl(TS_HOST + ":8810/#/s/" + encodeURIComponent(b.dataset.subOpen)));
    });

    if (qcards.length) {
      const card = qcards[state.quickIdx];
      const key = `${card.sid || ""}:${card.lid || ""}:${card.id || state.quickIdx}`;
      const cardRef = () => (card.ref && typeof card.ref === "object")
        ? Object.assign({}, card.ref)
        : Object.assign({ sid: card.sid || "" }, card.tid ? { tid: card.tid } : {}, card.lid ? { lid: card.lid } : {}, card.id ? { id: card.id } : {});

      $("qNextBtn").addEventListener("click", () => {
        state.quickIdx = (state.quickIdx + 1) % qcards.length;
        state.revealedKey = null;
        renderCampus();
      });
      panel.querySelectorAll("[data-sure]").forEach((b) => {
        b.addEventListener("click", () => {
          state.sureByKey[key] = state.sureByKey[key] === b.dataset.sure ? "" : b.dataset.sure;
          renderCampus();
        });
      });
      $("qRevealBtn").addEventListener("click", async () => {
        if (state.revealedKey === key) { state.revealedKey = null; renderCampus(); return; }
        if (card.mode === "review" && !state.reviewAnswers[key]) {
          const btn = $("qRevealBtn");
          btn.disabled = true;
          try {
            const pl = Object.assign(cardRef(), { text: "(웹 1분 퀴즈 확인)" });
            if (state.sureByKey[key]) pl.sure = state.sureByKey[key];
            const res = await sendCmd("campus_answer", pl);
            state.reviewAnswers[key] = (res && res.a) || card.a || "(모범 답 없음)";
            state.revealedKey = key;
          } catch (e) { toast(e.message || "답 조회 실패"); }
          btn.disabled = false;
          renderCampus();
        } else {
          state.revealedKey = key;
          renderCampus();
        }
      });
      const db = $("qDoneBtn");
      if (db) db.addEventListener("click", async () => {
        db.disabled = true;
        try {
          const pl = Object.assign(cardRef(), { done: true, text: "(웹 1분 퀴즈 완료)" });
          const res = await sendCmd("campus_done", pl);
          toast(res.ok ? "완료 기록했어요 ✓" : (res.error || "저장 실패"));
        } catch (e) { toast(e.message); }
        db.disabled = false;
      });
      panel.querySelectorAll("[data-grade]").forEach((b) => {
        b.addEventListener("click", async () => {
          const g = b.dataset.grade;
          b.disabled = true;
          try {
            const ansPl = Object.assign(cardRef(), { text: "(웹 1분 퀴즈 확인)" });
            if (state.sureByKey[key]) ansPl.sure = state.sureByKey[key];
            const grdPl = Object.assign(cardRef(), { grade: g });
            const res = await sendCmd("campus_grade", {
              ensure_answered: !state.reviewAnswers[key],
              ans: ansPl,
              grd: grdPl,
            });
            if (res && res.ok) {
              toast(res.hyper ? "확신했는데 틀렸어요 — 이 기억이 가장 오래 남아요!" : "채점 반영했어요 ✓", res.hyper ? 4200 : 2400);
              state.quickIdx = (state.quickIdx + 1) % Math.max(1, qcards.length);
              state.revealedKey = null;
              await loadSnapshot(true);
            } else {
              toast((res && res.error) || "채점 실패");
            }
          } catch (e) { toast(e.message); }
          b.disabled = false;
        });
      });
    }
  }

  function renderCampusRadar(panel, c) {
    const topics = c.topics || [];
    if (!topics.length) {
      panel.innerHTML = `<div class="card"><p class="meta">아직 주간 레이더 요약이 없어요.</p></div>`;
      return;
    }
    if (!state.selectedTopic || !topics.some((t) => t.name === state.selectedTopic)) {
      state.selectedTopic = topics[0].name;
    }
    const cur = topics.find((t) => t.name === state.selectedTopic) || topics[0];
    const learns = cur.learns || [];
    const news = cur.news || [];
    const tryItem = cur.try_item && cur.try_item.title ? cur.try_item : null;

    panel.innerHTML = `
      <div class="pill-row" style="margin-top:0;margin-bottom:10px;">
        ${topics.map((t) => `<button type="button" class="btn sm ${t.name === cur.name ? "primary" : ""}" data-rtopic="${esc(t.name)}">${esc(t.name)}</button>`).join("")}
      </div>
      <section class="card hero">
        <div class="card-head">
          <h2 class="card-title">📡 ${esc(cur.name)}</h2>
          <span class="small">${esc(cur.date || c.radar_updated || "")}</span>
        </div>
        <div style="font-size:15px;font-weight:800;">${esc(cur.headline || "")}</div>
        ${cur.changed_summary ? `<div class="row-sub" style="margin-top:4px;">${esc(cur.changed_summary)}</div>` : ""}
      </section>
      ${learns.length ? `<section class="card">
        <div class="card-head"><h2 class="card-title">💡 이번 주 배울 것</h2></div>
        <div class="list">
          ${learns.map((l, idx) => `
            <div class="row-item">
              <div class="row-main">
                <div class="row-title">${esc(l.title)} ${l.tag ? `<span class="tag">${esc(l.tag)}</span>` : ""}</div>
                ${l.body ? `<div class="row-sub">${esc(l.body)}</div>` : ""}
                <div class="pill-row" style="margin-top:6px;">
                  <button type="button" class="btn sm tonal" data-learn-todo="${idx}">+ 오늘 할 일 담기</button>
                  ${l.url ? `<button type="button" class="btn sm" data-open-url="${esc(l.url)}">원문 ↗</button>` : ""}
                </div>
              </div>
            </div>`).join("")}
        </div>
      </section>` : ""}
      ${tryItem ? `<section class="card">
        <div class="card-head"><h2 class="card-title">🛠 ${esc(tryItem.kind || "실습 1개")}</h2></div>
        <div class="row-title">${esc(tryItem.title)}</div>
        ${tryItem.body ? `<div class="row-sub">${esc(tryItem.body)}</div>` : ""}
      </section>` : ""}
      ${news.length ? `<section class="card">
        <div class="card-head">
          <h2 class="card-title">📰 주요 소식 (${news.length})</h2>
          <button type="button" class="btn sm" id="rToggleNews">${state.showNews ? "접기" : "펼치기"}</button>
        </div>
        ${state.showNews ? `<div class="list">${news.map((n) => `
          <div class="row-item">
            <div class="row-main">
              <div class="row-title">${esc(n.title)}</div>
              ${n.body ? `<div class="row-sub">${esc(n.body)}</div>` : ""}
            </div>
            ${n.url ? `<button type="button" class="btn sm" data-open-url="${esc(n.url)}">↗</button>` : ""}
          </div>`).join("")}</div>` : `<p class="small" style="margin:0;">필요할 때 펼쳐서 확인하세요.</p>`}
      </section>` : ""}
    `;

    panel.querySelectorAll("[data-rtopic]").forEach((b) => {
      b.addEventListener("click", () => { state.selectedTopic = b.dataset.rtopic; state.showNews = false; renderCampus(); });
    });
    panel.querySelectorAll("[data-open-url]").forEach((b) => {
      b.addEventListener("click", () => openUrl(b.dataset.openUrl));
    });
    panel.querySelectorAll("[data-learn-todo]").forEach((b) => {
      b.addEventListener("click", async () => {
        const l = learns[Number(b.dataset.learnTodo)];
        if (!l) return;
        b.disabled = true;
        try {
          const res = await sendCmd("todo_add", { box: "me", text: "[공부] " + l.title, at: todayIso(), day: true, pri: "high" });
          toast(res.ok ? "오늘 할 일에 담았어요 ✓" : (res.error || "담기 실패"));
        } catch (e) { toast(e.message); }
        b.disabled = false;
      });
    });
    const tn = $("rToggleNews");
    if (tn) tn.addEventListener("click", () => { state.showNews = !state.showNews; renderCampus(); });
  }

  function renderCampusDict(panel) {
    const isDirect = state.mode === "direct";
    const quickKws = ["CTS", "OCV", "STA", "IR Drop", "Clock Mesh", "Power Grid"];
    const portals = [
      { ico: "🌐", name: "베니 포털", sub: "모든 앱 모음", url: "https://benny3s.github.io/", pub: true },
      { ico: "📡", name: "주간 레이더 웹", sub: "외부·회사 PC 열림", url: "https://benny3s.github.io/radar/", pub: true },
      { ico: "🎵", name: "Music Lab", sub: "합주·악보", url: "https://benny3s.github.io/music/", pub: true },
      { ico: "🌉", name: "Benny Bridge", sub: "원격 브릿지", url: "https://benny3s.github.io/bridge/", pub: true },
      { ico: "🎓", name: "베니 캠퍼스", sub: isDirect ? "본관 바로 열기" : "집 PC 직통 전용", url: TS_HOST + ":8810/", pub: false },
      { ico: "🇬🇧", name: "어학관", sub: isDirect ? "영어·단어·스피킹" : "집 PC 직통 전용", url: TS_HOST + ":8820/", pub: false },
      { ico: "🖥", name: "PC 관제판", sub: isDirect ? "AI 세션·상태" : "집 PC 직통 전용", url: TS_HOST + ":8999/", pub: false },
      { ico: "📆", name: "약속 잡자", sub: "일정 조율", url: "https://benny3s.github.io/when/", pub: true },
    ];

    panel.innerHTML = `
      <section class="card">
        <div class="card-head"><h2 class="card-title">📖 설계 · AI 지식 사전 검색</h2></div>
        <form id="kbForm" class="input-row">
          <input id="kbIn" type="text" value="${esc(state.kbQuery)}" placeholder="예: CTS, OCV, clock skew, IR drop…" style="flex:1;">
          <button type="submit" class="btn primary sm" ${state.kbLoading ? "disabled" : ""}>검색</button>
        </form>
        <div class="pill-row">
          ${quickKws.map((k) => `<button type="button" class="btn sm tonal" data-kbkw="${esc(k)}">${esc(k)}</button>`).join("")}
        </div>
        <div class="list" style="margin-top:10px;">
          ${state.kbLoading ? `<p class="meta"><span class="spinner"></span> 사전 검색 중…</p>` : ""}
          ${!state.kbLoading && state.kbResults.length ? state.kbResults.map((it) => `
            <div class="row-item">
              <span class="tag primary">${esc(it.kind || "개념")}</span>
              <div class="row-main">
                <div class="row-title">${esc(it.title || it.id)}</div>
                ${it.summary ? `<div class="row-sub">${esc(it.summary)}</div>` : ""}
              </div>
            </div>`).join("") : (state.kbSearched && !state.kbLoading ? `<p class="meta">'${esc(state.kbSearched)}' 검색 결과가 없어요.</p>` : "")}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2 class="card-title">🚪 베니 포털 바로가기</h2></div>
        <div class="grid-2">
          ${portals.map((p) => `
            <button type="button" class="step-btn" style="margin-top:0;${!p.pub && !isDirect ? "opacity:.6;" : ""}" data-portal-url="${esc(p.url)}" data-portal-pub="${p.pub ? "1" : "0"}">
              <span style="font-size:20px;">${p.ico}</span>
              <div class="row-main">
                <div class="row-title">${esc(p.name)}</div>
                <div class="row-sub">${esc(p.sub)}</div>
              </div>
              <span>↗</span>
            </button>`).join("")}
        </div>
      </section>
    `;

    $("kbForm").addEventListener("submit", (e) => {
      e.preventDefault();
      runKbSearch($("kbIn").value.trim());
    });
    panel.querySelectorAll("[data-kbkw]").forEach((b) => {
      b.addEventListener("click", () => runKbSearch(b.dataset.kbkw));
    });
    panel.querySelectorAll("[data-portal-url]").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.portalPub === "0" && !isDirect) {
          toast("이 페이지는 집 PC·폰(Tailscale)에서만 열려요");
          return;
        }
        openUrl(b.dataset.portalUrl);
      });
    });
  }

  async function runKbSearch(q) {
    if (!q) return;
    state.kbQuery = q;
    state.kbSearched = q;
    state.kbLoading = true;
    renderCampus();
    try {
      const res = await sendCmd("kb_find", { q }, 25000);
      state.kbResults = (res && res.items) || [];
    } catch (e) {
      toast(e.message || "사전 검색 실패");
      state.kbResults = [];
    } finally {
      state.kbLoading = false;
      renderCampus();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     5. 회의록 페이지 (Direct 모드 전용 — 회사 PC 중계엔 미노출)
     ════════════════════════════════════════════════════════════════ */
  function renderMeetings() {
    const host = $("page-meetings");
    if (state.mode !== "direct") {
      host.innerHTML = `<div class="card"><p class="meta">회의록은 집 PC·폰 직통에서만 열려요.</p></div>`;
      return;
    }
    const all = (state.snap && state.snap.meetings) || [];
    const q = state.meetQuery.trim().toLowerCase();
    const list = q
      ? all.filter((m) => (String(m.title || "") + " " + String(m.summary || "") + " " + (m.tags || []).join(" ")).toLowerCase().includes(q))
      : all;

    host.innerHTML = `
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">📝 회의록 <span class="tag">${list.length}</span></h2>
          ${Native ? `<button type="button" class="btn primary sm" id="mStartLive">🎙 실시간 회의</button>` : ""}
        </div>
        <div class="input-row" style="margin-bottom:8px;">
          <input id="mSearchIn" type="text" value="${esc(state.meetQuery)}" placeholder="회의 제목·키워드 검색…" style="flex:1;">
        </div>
        <div class="pill-row" style="margin-top:0;margin-bottom:10px;">
          <button type="button" class="btn tonal sm" id="mMultiRecent">✨ 최근 회의 통합 브리핑</button>
          <button type="button" class="btn sm ${state.meetPickMode ? "primary" : ""}" id="mPickToggle">
            ${state.meetPickMode ? `골라 묶기 취소 (${state.meetPicked.size})` : "골라 묶기"}
          </button>
          ${state.meetPickMode && state.meetPicked.size >= 1
            ? `<button type="button" class="btn primary sm" id="mRunPicked">선택 ${state.meetPicked.size}건 통합 브리핑</button>`
            : ""}
        </div>
        <div class="list">
          ${list.map((m) => {
            const checked = state.meetPicked.has(m.id);
            const stTag = m.status === "done" ? `<span class="tag ok">완료</span>` : `<span class="tag">${esc(m.status || "진행")}</span>`;
            return `<div class="row-item" style="cursor:pointer;" data-mid="${esc(m.id)}">
              ${state.meetPickMode
                ? `<input type="checkbox" data-mpick="${esc(m.id)}" ${checked ? "checked" : ""} style="width:18px;height:18px;margin-top:3px;">`
                : stTag}
              <div class="row-main">
                <div class="row-title">${esc(m.title || m.id)}</div>
                <div class="row-sub">${esc(String(m.created || "").slice(0, 16))}${m.duration ? ` · ${Math.round(m.duration / 60)}분` : ""}${m.inbox_left ? ` · 미정리 ${m.inbox_left}건` : ""}</div>
                ${m.summary ? `<div class="row-sub" style="color:var(--ink-2);">${esc(String(m.summary).slice(0, 110))}</div>` : ""}
              </div>
            </div>`;
          }).join("") || `<p class="meta">표시할 회의록이 없어요.</p>`}
        </div>
      </section>
    `;

    const ml = $("mStartLive");
    if (ml) ml.addEventListener("click", () => Native && Native.openLiveMeeting && Native.openLiveMeeting());
    $("mSearchIn").addEventListener("input", (e) => { state.meetQuery = e.target.value; renderMeetings(); });
    $("mMultiRecent").addEventListener("click", () => runMultiBrief(null));
    $("mPickToggle").addEventListener("click", () => {
      state.meetPickMode = !state.meetPickMode;
      if (!state.meetPickMode) state.meetPicked.clear();
      renderMeetings();
    });
    const rp = $("mRunPicked");
    if (rp) rp.addEventListener("click", () => runMultiBrief([...state.meetPicked]));

    host.querySelectorAll("[data-mid]").forEach((row) => {
      row.addEventListener("click", (e) => {
        const mid = row.dataset.mid;
        if (state.meetPickMode) {
          if (state.meetPicked.has(mid)) state.meetPicked.delete(mid);
          else state.meetPicked.add(mid);
          renderMeetings();
        } else {
          openMeetingDetail(mid);
        }
      });
    });
  }

  async function openMeetingDetail(mid) {
    openModal("회의 상세", `<p class="meta"><span class="spinner"></span> 불러오는 중…</p>`);
    try {
      const v = await directFetchJson("/meeting/view/" + encodeURIComponent(mid));
      // /meeting/view 모양 (11-25 맞춤): summary · decisions = 글 목록, unclear = 모호한 말 목록, transcript = [{t, spk, text}]
      const lines = (x) => (Array.isArray(x) ? x.map((p) => (typeof p === "string" ? p : (p && (p.text || p.issue)) || "")).filter(Boolean) : (x ? [String(x)] : []));
      const sumText = lines(v.summary).join("\n");
      const pts = lines(v.decisions && v.decisions.length ? v.decisions : v.points);
      const todos = v.todos || [];
      const unsure = v.unclear || v.unsure || [];
      const trText = Array.isArray(v.transcript)
        ? v.transcript.map((s) => (s && s.spk ? s.spk + ": " : "") + ((s && s.text) || "")).join("\n")
        : String(v.transcript || "");
      const bodyHtml = `
        <div class="small">${esc(String(v.created || "").slice(0, 16))} ${v.duration ? "· " + Math.round(v.duration / 60) + "분" : ""}</div>
        <div class="pill-row" style="margin-bottom:10px;">
          <button type="button" class="btn primary sm" id="mdMailEn">✉ 영문 회신 초안</button>
          <button type="button" class="btn tonal sm" id="mdMailKo">✉ 국문 회신 초안</button>
          <button type="button" class="btn sm" id="mdCopySum">요약 복사</button>
        </div>
        ${sumText ? `<div class="card" style="background:var(--surface-2);"><div style="font-weight:700;margin-bottom:4px;">요약</div>${lines(v.summary).map((p) => `<div style="margin-top:4px;">• ${esc(p)}</div>`).join("")}</div>` : ""}
        ${pts.length ? `<div class="card"><div style="font-weight:700;margin-bottom:4px;">정한 것</div>${pts.map((p) => `<div style="margin-top:4px;">• ${esc(p)}</div>`).join("")}</div>` : ""}
        ${todos.length ? `<div class="card"><div style="font-weight:700;margin-bottom:4px;">할 일 (${todos.length})</div>${todos.map((t) => `<div style="margin-top:4px;">☐ ${esc(typeof t === "string" ? t : (t.text || ""))}</div>`).join("")}</div>` : ""}
        <div class="card">
          <div style="font-weight:700;margin-bottom:6px;">⚠ 모호 용어 사전 영구 등록</div>
          ${unsure.length ? `<div class="pill-row" style="margin-top:0;margin-bottom:8px;">${unsure.slice(0, 8).map((u) => {
            const heard = typeof u === "string" ? u : (u.heard || u.raw || "");
            return `<button type="button" class="btn sm" data-fill-heard="${esc(heard)}">${esc(heard)}</button>`;
          }).join("")}</div>` : ""}
          <form id="termFixForm" class="input-row">
            <input id="tfHeard" type="text" placeholder="잘못 들린 말" style="flex:1;min-width:110px;" required>
            <input id="tfTerm" type="text" placeholder="정확한 용어" style="flex:1;min-width:110px;" required>
            <button type="submit" class="btn primary sm">사전 등록</button>
          </form>
        </div>
        ${trText ? `<details style="margin-top:8px;"><summary class="small" style="cursor:pointer;">전체 대본 펼치기</summary><pre style="white-space:pre-wrap;font-size:12.5px;background:var(--surface-2);padding:10px;border-radius:10px;max-height:260px;overflow:auto;">${esc(trText.slice(0, 12000))}</pre></details>` : ""}
      `;
      openModal(v.title || mid, bodyHtml, (root) => {
        $("mdCopySum").addEventListener("click", () => copyText(sumText, "요약"));
        $("mdMailEn").addEventListener("click", () => openMailDraftModal(mid, null, "en"));
        $("mdMailKo").addEventListener("click", () => openMailDraftModal(mid, null, "ko"));
        root.querySelectorAll("[data-fill-heard]").forEach((b) => {
          b.addEventListener("click", () => { $("tfHeard").value = b.dataset.fillHeard; $("tfTerm").focus(); });
        });
        $("termFixForm").addEventListener("submit", async (e) => {
          e.preventDefault();
          const heard = $("tfHeard").value.trim();
          const term = $("tfTerm").value.trim();
          if (!heard || !term) return;
          try {
            const r = await directFetchJson("/meeting/termfix", { method: "POST", body: { heard, term } });
            toast(r.ok ? `'${heard}' → '${term}' 사전에 등록했어요 ✓` : (r.error || "등록 실패"));
            if (r.ok) { $("tfHeard").value = ""; $("tfTerm").value = ""; }
          } catch (err) { toast(err.message); }
        });
      });
    } catch (e) {
      openModal("회의 상세", `<p class="meta">불러오기 실패: ${esc(e.message)}</p>`);
    }
  }

  async function runMultiBrief(ids) {
    openModal("✨ 통합 회의 브리핑", `<p class="meta"><span class="spinner"></span> 여러 회의를 묶어 정리하는 중…</p>`);
    try {
      const res = await directFetchJson("/meeting/multi_brief", {
        method: "POST",
        body: ids ? { ids } : { today_only: false },
      });
      if (!res.ok) throw new Error(res.error || "브리핑 생성 실패");
      const used = res.meetings || [];
      const txt = res.markdown || res.brief || res.text || "";   // multi_meeting_brief 는 markdown 으로 준다 (11-25 맞춤)
      openModal(`✨ 통합 브리핑 (${used.length}건)`, `
        <div class="small" style="margin-bottom:8px;">포함 회의: ${esc(used.map((m) => m.title || m.id).join(" · "))}</div>
        <div style="white-space:pre-wrap;line-height:1.6;">${esc(txt)}</div>
        <div class="pill-row">
          <button type="button" class="btn primary sm" id="mbCopy">브리핑 복사</button>
          <button type="button" class="btn tonal sm" id="mbMail">✉ 통합 회신 메일 초안</button>
        </div>
      `, () => {
        $("mbCopy").addEventListener("click", () => copyText(txt, "통합 브리핑"));
        $("mbMail").addEventListener("click", () => openMailDraftModal("", used.map((m) => m.id), "en"));
      });
    } catch (e) {
      openModal("통합 브리핑 오류", `<p class="meta">${esc(e.message)}</p>`);
    }
  }

  async function openMailDraftModal(mid, ids, lang) {
    openModal("✉ 회신 메일 초안", `<p class="meta"><span class="spinner"></span> ${lang === "en" ? "영문" : "국문"} 메일 초안 작성 중…</p>`);
    try {
      const res = await directFetchJson("/meeting/draft_mail", {
        method: "POST",
        body: { id: mid || "", ids: ids || undefined, lang },
      });
      if (!res.ok) throw new Error(res.error || "메일 생성 실패");
      const full = (res.subject ? "Subject: " + res.subject + "\n\n" : "") + (res.body || "");
      openModal(`✉ 회신 메일 초안 (${lang === "en" ? "EN" : "KO"})`, `
        ${res.subject ? `<div class="card" style="background:var(--surface-2);"><b>제목:</b> ${esc(res.subject)}</div>` : ""}
        <pre style="white-space:pre-wrap;font-family:inherit;line-height:1.55;background:var(--surface-2);padding:12px;border-radius:12px;">${esc(res.body || "")}</pre>
        <div class="pill-row">
          <button type="button" class="btn primary sm" id="mailCopyBtn">전체 복사</button>
          <button type="button" class="btn sm" id="mailSwapLang">${lang === "en" ? "국문으로 다시 쓰기" : "영문으로 다시 쓰기"}</button>
        </div>
      `, () => {
        $("mailCopyBtn").addEventListener("click", () => copyText(full, "메일 초안"));
        $("mailSwapLang").addEventListener("click", () => openMailDraftModal(mid, ids, lang === "en" ? "ko" : "en"));
      });
    } catch (e) {
      openModal("메일 초안 오류", `<p class="meta">${esc(e.message)}</p>`);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     공용 모달 (AI 정리 · AI 입력 · 알림함 · 일정 추가 · 카톡 · 약속)
     ════════════════════════════════════════════════════════════════ */
  async function openOrganizeModal(box) {
    openModal("✨ AI 밀린 일 정리", `<p class="meta"><span class="spinner"></span> TimeTree 빈 시간과 밀린 일을 분석하는 중…</p>`);
    try {
      const res = await sendCmd("todo_organize", { box }, 45000);
      if (!res || !res.ok) throw new Error((res && res.error) || "분석 실패");
      const props = res.proposals || [];
      if (!props.length) {
        openModal("✨ AI 밀린 일 정리", `<p>${esc(res.summary || "정리할 밀린 할 일이 없어요.")}</p>`);
        return;
      }
      const opBadge = { done: "완료 추천", move: "일정 이동", hold: "보류" };
      openModal("✨ AI 밀린 일 정리", `
        <p style="font-weight:700;margin-top:0;">${esc(res.summary || "")}</p>
        <div class="list">
          ${props.map((p, i) => `
            <label class="row-item" style="cursor:pointer;">
              <input type="checkbox" data-org-i="${i}" checked style="width:18px;height:18px;margin-top:2px;">
              <div class="row-main">
                <div class="row-title">${esc(p.text)} <span class="tag primary">${esc(opBadge[p.op] || p.op)}</span></div>
                <div class="row-sub">${p.date ? `${esc(shortDate(p.date))} ${esc(p.time || "")} · ` : ""}${esc(p.reason || "")}</div>
              </div>
            </label>`).join("")}
        </div>
        <div class="pill-row">
          <button type="button" class="btn primary" id="orgApplyBtn">선택 항목 일괄 적용</button>
        </div>
      `, (root) => {
        $("orgApplyBtn").addEventListener("click", async () => {
          const picked = [...root.querySelectorAll("[data-org-i]:checked")].map((cb) => props[Number(cb.dataset.orgI)]);
          if (!picked.length) return toast("적용할 항목을 선택해 주세요");
          $("orgApplyBtn").disabled = true;
          try {
            const r = await sendCmd("todo_apply", { proposals: picked }, 45000);
            toast(r.ok ? (r.summary || "정리했어요 ✓") : (r.error || "적용 실패"));
            if (r.ok) { closeModal(); await loadSnapshot(true); }
          } catch (e) { toast(e.message); }
          $("orgApplyBtn").disabled = false;
        });
      });
    } catch (e) {
      openModal("✨ AI 밀린 일 정리", `<p class="meta">⚠ ${esc(e.message)}</p>`);
    }
  }

  function openCaptureModal() {
    openModal("✨ AI 한 번에 입력", `
      <p class="small" style="margin-top:0;">말하듯 편하게 여러 개를 적으면 일정과 할 일로 자동 분해해 드려요.</p>
      <textarea id="capText" rows="4" style="width:100%;" placeholder="예: 내일 오후 3시 치과 예약, 금요일까지 관리비 납부하고 주말에 합주실 예약"></textarea>
      <div class="pill-row">
        <button type="button" class="btn primary" id="capParseBtn">AI 분해하기</button>
      </div>
      <div id="capRes" style="margin-top:12px;"></div>
    `, () => {
      $("capParseBtn").addEventListener("click", async () => {
        const text = $("capText").value.trim();
        if (!text) return;
        const btn = $("capParseBtn");
        btn.disabled = true;
        $("capRes").innerHTML = `<p class="meta"><span class="spinner"></span> 분석 중…</p>`;
        try {
          const res = await sendCmd("parse_capture", { text }, 45000);
          if (!res || !res.ok) throw new Error((res && res.error) || "분석 실패");
          const items = res.items || [];
          if (!items.length) {
            $("capRes").innerHTML = `<p class="meta">분해할 항목을 찾지 못했어요.</p>`;
            btn.disabled = false;
            return;
          }
          $("capRes").innerHTML = `
            <div class="list">
              ${items.map((it, i) => `
                <label class="row-item" style="cursor:pointer;">
                  <input type="checkbox" data-cap-i="${i}" checked style="width:18px;height:18px;margin-top:2px;">
                  <div class="row-main">
                    <div class="row-title">
                      <span class="tag ${it.kind === "event" ? "primary" : ""}">${it.kind === "event" ? "일정" : (it.box === "work" ? "회사 할 일" : "개인 할 일")}</span>
                      ${esc(it.title)}
                    </div>
                    <div class="row-sub">
                      ${it.date ? esc(shortDate(it.date)) : "기한 미정"} ${it.start ? esc(it.start) : ""}
                      ${it.conflict ? `<span class="tag urgent">⚠ ${esc(it.conflict)}</span>` : ""}
                    </div>
                  </div>
                </label>`).join("")}
            </div>
            <div class="pill-row">
              <button type="button" class="btn primary" id="capSaveBtn">선택 항목 저장</button>
            </div>`;
          $("capSaveBtn").addEventListener("click", async () => {
            const picked = [...$("capRes").querySelectorAll("[data-cap-i]:checked")].map((cb) => items[Number(cb.dataset.capI)]);
            if (!picked.length) return;
            $("capSaveBtn").disabled = true;
            let okN = 0;
            for (const it of picked) {
              try {
                if (it.kind === "event" && it.date) {
                  const r = await sendCmd("calendar_write", {
                    op: "add", calendar: "명재지민", title: it.title, date: it.date,
                    start: it.start || "", end: it.end || "", all_day: !it.start,
                  }, 90000);
                  if (r && r.ok) okN++;
                } else {
                  const box = (it.box === "work" && state.mode === "direct") ? "work" : "me";
                  const r = await sendCmd("todo_add", {
                    box, text: it.title,
                    at: it.date ? (it.start ? `${it.date} ${it.start}` : it.date) : "",
                    day: !it.start, pri: it.pri || "",
                  }, 30000);
                  if (r && r.ok) okN++;
                }
              } catch (_) {}
            }
            toast(`${okN}/${picked.length}건을 저장했어요 ✓`);
            closeModal();
            await loadSnapshot(true);
          });
        } catch (e) {
          $("capRes").innerHTML = `<p class="meta">⚠ ${esc(e.message)}</p>`;
        }
        btn.disabled = false;
      });
    });
  }

  function openAlertsModal() {
    const alerts = (state.snap && state.snap.alerts) || [];
    openModal(`🔔 알림함 (${alerts.length})`, alerts.length
      ? `<div class="list">${alerts.map((a) => `
          <div class="row-item">
            <span class="tag">${esc(a.src || "PC")}</span>
            <div class="row-main">
              <div class="row-title">${esc(a.title || String(a.text || "").slice(0, 40) || "알림")}</div>
              <div class="row-sub">${esc(a.t || "")}</div>
              ${a.text ? `<div style="font-size:13px;white-space:pre-wrap;margin-top:4px;color:var(--ink-2);">${esc(a.text)}</div>` : ""}
            </div>
          </div>`).join("")}</div>`
      : `<p class="meta">최근 48시간 새 알림이 없어요.</p>`);
  }

  function openCalendarAddModal() {
    openModal("📅 TimeTree 일정 추가", `
      <form id="calAddForm" style="display:flex;flex-direction:column;gap:10px;">
        <input id="caTitle" type="text" placeholder="일정 제목" required maxlength="80">
        <div class="input-row">
          <input id="caDate" type="date" value="${todayIso()}" required style="flex:1;">
          <select id="caCal" style="flex:1;">
            <option value="명재지민">명재지민 (가족)</option>
            <option value="내 일정">내 일정</option>
          </select>
        </div>
        <div class="input-row">
          <input id="caStart" type="text" placeholder="시작 (예: 14:00, 비우면 종일)" style="flex:1;">
          <input id="caEnd" type="text" placeholder="끝 (예: 15:00)" style="flex:1;">
        </div>
        <button type="submit" class="btn primary" id="caSubmit">일정 저장</button>
      </form>
    `, () => {
      $("calAddForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = $("caSubmit");
        btn.disabled = true;
        const st = $("caStart").value.trim();
        const en = $("caEnd").value.trim();
        try {
          const r = await sendCmd("calendar_write", {
            op: "add",
            calendar: $("caCal").value,
            title: $("caTitle").value.trim(),
            date: $("caDate").value,
            start: st, end: en, all_day: !st,
          }, 95000);
          toast(r && r.ok ? "일정을 저장했어요 ✓" : ((r && r.error) || "저장 실패"));
          if (r && r.ok) { closeModal(); await loadSnapshot(true); }
        } catch (err) { toast(err.message, 3500); }
        btn.disabled = false;
      });
    });
  }

  function openKakaoModal(autoScan = false) {
    openModal("💬 PC 카톡 안 읽은 방 · 요약", `
      <div class="input-row" style="margin-bottom:10px;">
        <button type="button" class="btn primary sm" id="kkScanBtn">안 읽은 방 스캔</button>
        <input id="kkRoomIn" type="text" placeholder="방 이름 입력 후 요약…" style="flex:1;">
        <button type="button" class="btn tonal sm" id="kkSumBtn">방 요약</button>
      </div>
      <pre id="kkOut" style="white-space:pre-wrap;font-family:inherit;font-size:13px;background:var(--surface-2);padding:12px;border-radius:12px;min-height:80px;">버튼을 눌러 확인하세요.</pre>
    `, () => {
      const runScan = async () => {
        $("kkScanBtn").disabled = true;
        $("kkOut").textContent = "PC 카톡 안 읽은 방 목록을 스캔하는 중… (최대 1분)";
        try {
          const r = await sendCmd("kakao_unread", {}, 100000);
          $("kkOut").textContent = r.ok ? (r.text || "완료") : ("⚠ " + (r.error || "실패"));
        } catch (e) { $("kkOut").textContent = "⚠ " + e.message; }
        $("kkScanBtn").disabled = false;
      };
      $("kkScanBtn").addEventListener("click", runScan);
      $("kkSumBtn").addEventListener("click", async () => {
        const room = $("kkRoomIn").value.trim();
        if (!room) return toast("요약할 방 이름을 입력해 주세요");
        $("kkSumBtn").disabled = true;
        $("kkOut").textContent = `'${room}' 방 대화를 읽고 요약하는 중…`;
        try {
          const r = await sendCmd("kakao_summarize", { room }, 120000);
          $("kkOut").textContent = r.ok ? (r.text || "완료") : ("⚠ " + (r.error || "실패"));
        } catch (e) { $("kkOut").textContent = "⚠ " + e.message; }
        $("kkSumBtn").disabled = false;
      });
      if (autoScan) runScan();
    });
  }

  function openHabitPlanModal(h) {
    openModal("🗓 공부 약속", `
      <form id="habForm" style="display:flex;flex-direction:column;gap:10px;">
        <input id="habPlan" type="text" value="${esc(h.plan || "")}" placeholder="예: 출근 지하철에서 단어 3분" maxlength="120">
        <input id="habAt" type="text" value="${esc(h.at || "")}" placeholder="알림 시각 HH:MM (예: 08:00, 비우면 끔)" maxlength="5">
        <button type="submit" class="btn primary" id="habSave">저장</button>
      </form>
    `, () => {
      $("habForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        $("habSave").disabled = true;
        try {
          const r = await sendCmd("campus_habit", { plan: $("habPlan").value.trim(), at: $("habAt").value.trim() });
          toast(r.ok ? "공부 약속을 저장했어요 ✓" : (r.error || "저장 실패"));
          if (r.ok) { closeModal(); await loadSnapshot(true); }
        } catch (err) { toast(err.message); }
        $("habSave").disabled = false;
      });
    });
  }

  /* ── 로그인 폼 (회사 PC / 외부 안전 중계) */
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("loginPw").value;
    if (!pw) return;
    const btn = $("loginSubmit");
    const msg = $("loginMsg");
    btn.disabled = true;
    msg.textContent = "관리자 인증 확인 중…";
    try {
      const app = await ensureLoginKit();
      const tok = await window.bennyAdminLogin(app, pw);
      await app.auth().signInWithCustomToken(tok);
      if (window.bennyAdminEnroll) window.bennyAdminEnroll(app);
      $("loginPw").value = "";
      msg.textContent = "";
      await loadSnapshot(false);
    } catch (err) {
      msg.textContent = (err && err.message) || "로그인하지 못했어요";
    } finally {
      btn.disabled = false;
    }
  });

  /* ── 전역 버튼 · 내비게이션 연결 */
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      // 11-25 베니 님 "채팅 보내고 뒤로 가니까 앞에 대화가 사라져서" · "할 일 추가를 못 한대":
      // 폰 앱 안에서는 '대화' 가 폰 비서(할 일 · 일정 · 폰 도구, 대화 기록 유지)로 간다. 웹 대화는 PC 브라우저용.
      if (btn.dataset.page === "chat" && Native && Native.openNativeChat) { Native.openNativeChat(); return; }
      switchPage(btn.dataset.page);
    });
  });

  /* ── 폰 앱의 뒤로 가기: 열린 창 → 요약 순서로 닫고, 더 닫을 게 없으면 false (앱이 뒤로 보냄) */
  window.bennyBack = function () {
    if (modalDlg && modalDlg.open) { modalDlg.close(); return true; }
    if (state.page !== "summary") { switchPage("summary"); return true; }
    return false;
  };

  /* ── 11-25 베니 님 "키보드는 올라오는데 입력칸은 안 올라와서 내 글이 안 보여":
     폰은 키보드가 뜨면 화면이 줄고, 바닥에 붙은 탭 줄이 키보드 바로 위로 따라 올라와 입력칸을 덮었다.
     글을 쓰는 동안엔 탭 줄을 숨기고, 입력칸을 화면 가운데로 끌어온다 (키보드가 다 뜬 뒤 한 번 더). */
  const isTyping = (el) => !!el && (el.isContentEditable || el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && !/^(button|submit|checkbox|radio|range|color|file|reset|image)$/i.test(el.type || "")) ||
    el.tagName === "SELECT");
  const bringIntoView = () => {
    const el = document.activeElement;
    if (!isTyping(el)) return;
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) { el.scrollIntoView(); }
  };
  document.addEventListener("focusin", (e) => {
    if (!isTyping(e.target)) return;
    document.body.classList.add("kb-open");
    setTimeout(bringIntoView, 250);
    setTimeout(bringIntoView, 650);
  });
  document.addEventListener("focusout", () => {
    setTimeout(() => { if (!isTyping(document.activeElement)) document.body.classList.remove("kb-open"); }, 150);
  });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", () => setTimeout(bringIntoView, 80));
  window.addEventListener("resize", () => setTimeout(bringIntoView, 80));
  $("btnRefresh").addEventListener("click", async () => {
    if (state.mode === "relay") {
      toast("집 PC 최신 현황 요청 중…");
      try { await sendCmd("refresh", {}, 20000); } catch (_) {}
    }
    await loadSnapshot(false);
    toast("새로고침했어요");
  });
  $("btnCapture").addEventListener("click", openCaptureModal);
  $("btnAlerts").addEventListener("click", openAlertsModal);
  $("btnLiveMeet").addEventListener("click", () => {
    if (Native && Native.openLiveMeeting) Native.openLiveMeeting();
  });
  $("btnNativeSettings").addEventListener("click", () => {
    if (Native && Native.openSettings) Native.openSettings();
  });

  /* ── 주기적 백그라운드 갱신 */
  setInterval(() => {
    if (document.visibilityState === "visible" && state.snap) loadSnapshot(true);
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.snap && (Date.now() - state.lastSyncAt > 45000)) {
      loadSnapshot(true);
    }
  });

  /* ── 시작! */
  (async function boot() {
    if (Native) {
      $("btnLiveMeet").hidden = false;
      $("btnNativeSettings").hidden = false;
    }
    await detectTransport();
    await loadSnapshot(false);
  })();
})();
