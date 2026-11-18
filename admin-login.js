/* 관리자 로그인 공용 (포털·레이더) — 베니브릿지 adminLogin 의 '새 기기 확인' 방식 (2026-10-27, Benny: "새 기기면 내 폰으로 승인/거절")
   bennyAdminLogin(app, pw) → 토큰. 이 브라우저가 등록된 관리자 기기면 바로, 처음 보는 기기면
   베니 폰·PC 알림의 '허용' 또는 등록된 번호(베니·아내)로 받은 문자 6자리를 기다림.
   bennyAdminEnroll(app) — 이미 관리자로 로그인돼 있는 이 기기를 '믿을 기기'로 등록(한 번).
   기기 id 는 베니브릿지와 같은 localStorage 'bennyAdminDevice' (같은 주소라 함께 씀) */
(function () {
  function devId() {
    try {
      let id = localStorage.getItem("bennyAdminDevice");
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(id || "")) {
        id = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => ("0" + b.toString(16)).slice(-2)).join("");
        localStorage.setItem("bennyAdminDevice", id);
      }
      return id;
    } catch (e) { return ""; }
  }
  /* 기기 열쇠 (10-29): 믿을 기기가 될 때 서버가 이 기기에만 주는 값 — 기기 id 만으로는 믿을 기기로 안 봄. 베니브릿지와 같은 'bennyAdminDeviceKey' */
  function devKey() { try { return localStorage.getItem("bennyAdminDeviceKey") || ""; } catch (e) { return ""; } }
  function saveKey(k) { if (k) { try { localStorage.setItem("bennyAdminDeviceKey", String(k)); } catch (e) {} } }
  /* 이미 열쇠 가진 기기 id 로 다시 승인받으면 서버가 새 id 를 줌 */
  function saveId(id) { if (/^[A-Za-z0-9_-]{16,64}$/.test(id || "")) { try { localStorage.setItem("bennyAdminDevice", id); } catch (e) {} } }
  function devName() {
    const ua = navigator.userAgent || "";
    const os = /iPhone/.test(ua) ? "아이폰" : /iPad/.test(ua) ? "아이패드" : /Android/.test(ua) ? "안드로이드" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "기기";
    const br = /KAKAOTALK/i.test(ua) ? "카카오톡" : /SamsungBrowser/.test(ua) ? "삼성 인터넷" : /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
    return (os + " " + br).trim();
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function waitUi(first, dev, call) {
    return new Promise((resolve, reject) => {
      let done = false, timer = null, otpAc = null;
      const stopOtp = () => { if (otpAc) { otpAc.abort(); otpAc = null; } };
      const box = document.createElement("div");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-labelledby", "bnHoldTitle");
      box.setAttribute("style", "position:fixed;inset:0;background:var(--bn-overlay,rgba(0,0,0,.45));display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;");
      const t = first.smsTargets || [];
      const btnCss = "min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid var(--bn-line,#ddd);background:var(--bn-surface,#fff);color:var(--bn-ink,#222);font:600 14px/1.4 inherit;cursor:pointer;";
      box.innerHTML = '<div style="background:var(--bn-surface,#fff);color:var(--bn-ink,#222);max-width:420px;width:100%;border-radius:16px;padding:20px;font:15px/1.55 var(--bn-font,system-ui,sans-serif);box-shadow:0 10px 28px rgba(0,0,0,.18);">' +
        '<h3 id="bnHoldTitle" style="margin:0 0 8px;font-size:17.5px;">🛂 새 기기 확인</h3>' +
        '<p style="margin:0 0 10px;color:var(--bn-ink-2,#555);">처음 보는 기기라 확인이 필요해요. <b>베니 님 폰이나 등록된 PC</b>에 온 알림에서 <b>허용</b>을 눌러 주세요. (10분 안에)</p>' +
        (t.length ? '<p style="margin:10px 0 6px;font-size:13px;color:var(--bn-ink-2,#666);">폰·PC를 못 쓰면 문자로 인증:</p><div style="display:flex;flex-wrap:wrap;gap:6px;">' +
          t.map((x, i) => '<button type="button" data-sms="' + i + '" style="' + btnCss + '">📱 ' + esc(x) + '로 받기</button>').join("") + '</div>' +
          '<form data-otp-form method="post" action="#" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--bn-line,#eee);">' +
          '<label for="bnOtpIn" style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">인증번호 6자리</label>' +
          '<p id="bnOtpHint" style="margin:0 0 8px;font-size:12.5px;color:var(--bn-ink-2,#666);">문자로 받은 숫자 6자리를 입력해 주세요.</p>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
          '<input id="bnOtpIn" data-in type="text" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" aria-describedby="bnOtpHint" required placeholder="000000" style="width:150px;min-height:44px;padding:8px 12px;font:600 16px/1.3 ui-monospace,monospace;letter-spacing:.2em;border:1px solid var(--bn-line,#ccc);border-radius:8px;background:var(--bn-surface,#fff);color:var(--bn-ink,#222);">' +
          '<button type="submit" data-ok style="' + btnCss + 'background:var(--bn-accent,#287047);border-color:var(--bn-accent,#287047);color:#fff;">확인</button>' +
          '</div></form>' : "") +
        '<p data-msg role="status" aria-live="polite" style="margin:10px 0 0;font-size:13px;color:var(--bn-ink-2,#666);">기다리는 중…</p>' +
        '<div style="text-align:right;margin-top:12px;"><button type="button" data-cancel style="' + btnCss + '">취소</button></div></div>';
      document.body.appendChild(box);
      const msg = s => { box.querySelector("[data-msg]").textContent = s; };
      const finish = (err, tok) => { if (done) return; done = true; clearTimeout(timer); stopOtp(); box.remove(); err ? reject(err) : resolve(tok); };
      const ask = extra => call(Object.assign({ holdId: first.holdId, pollKey: first.pollKey, deviceId: dev }, extra || {})).then(x => { saveId(x.deviceId); saveKey(x.deviceKey); if (x.token) finish(null, x.token); return x; });
      const isTransient = e => {
        const c = String((e && e.code) || "");
        return !navigator.onLine || /unavailable|internal|network|fetch/i.test(c + " " + ((e && e.message) || ""));
      };
      const poll = () => {
        if (done) return;
        ask().then(() => { if (!done) timer = setTimeout(poll, 3000); }).catch(e => {
          if (done) return;
          if (isTransient(e)) { msg("연결이 잠깐 끊겼어요 — 다시 확인 중…"); timer = setTimeout(poll, 3000); return; }
          finish(new Error((e && e.message) || "확인하지 못했어요."));
        });
      };
      const otpForm = box.querySelector("[data-otp-form]"), otpIn = box.querySelector("[data-in]");
      const startOtp = () => {
        if (!otpIn || !("OTPCredential" in window)) return;
        stopOtp();
        const ac = new AbortController(); otpAc = ac;
        navigator.credentials.get({ otp: { transport: ["sms"] }, signal: ac.signal }).then(otp => {
          if (!otp || done) return;
          otpIn.value = otp.code;
          if (otpForm) otpForm.requestSubmit();
        }).catch(() => {});
      };
      box.querySelector("[data-cancel]").onclick = () => finish(new Error("취소했어요."));
      box.querySelectorAll("[data-sms]").forEach(b => b.onclick = () => {
        msg("문자 보내는 중…");
        ask({ smsSend: Number(b.getAttribute("data-sms")) }).then(x => {
          msg((x.smsSent || "") + " 번호로 인증번호를 보냈어요.");
          if (otpForm) { otpForm.style.display = ""; otpIn.focus(); startOtp(); }
        }).catch(e => msg((e && e.message) || "문자를 보내지 못했어요."));
      });
      if (otpForm) otpForm.addEventListener("submit", e => {
        e.preventDefault();
        stopOtp();
        const v = (otpIn.value || "").replace(/\D/g, "");
        if (v.length !== 6) return msg("6자리를 넣어 주세요.");
        msg("확인 중…");
        ask({ smsCode: v }).catch(err => msg((err && err.message) || "인증번호가 맞지 않아요."));
      });
      const cancelBtn = box.querySelector("[data-cancel]");
      if (cancelBtn) cancelBtn.focus();
      timer = setTimeout(poll, 3000);
    });
  }
  window.bennyAdminLogin = async function (app, pw) {
    const call = d => app.functions("asia-northeast3").httpsCallable("adminLogin")(d).then(r => (r && r.data) || {});
    const dev = devId();
    /* keyOk: 열쇠를 저장할 수 있음. 이번만 허용(onceOk)은 안 받음 — 이 페이지는 12시간 끝을 챙기지 않아서 */
    const r = await call({ password: pw, deviceId: dev, deviceKey: devKey(), deviceName: devName(), keyOk: 1 });
    saveId(r.deviceId); saveKey(r.deviceKey);
    if (r.token) return r.token;
    if (!r.pending) throw new Error("토큰을 받지 못했어요.");
    return waitUi(r, dev, call);
  };
  let enrolled = false;
  window.bennyAdminEnroll = function (app) {
    if (enrolled) return;
    enrolled = true;
    try {
      app.functions("asia-northeast3").httpsCallable("adminDevice")({ op: "enroll", deviceId: devId(), deviceKey: devKey(), deviceName: devName(), wantKey: 1 })
        .then(r => saveKey(r && r.data && r.data.deviceKey)).catch(() => { enrolled = false; });
    } catch (e) { enrolled = false; }
  };
})();
