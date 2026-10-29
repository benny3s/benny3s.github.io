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
  function devName() {
    const ua = navigator.userAgent || "";
    const os = /iPhone/.test(ua) ? "아이폰" : /iPad/.test(ua) ? "아이패드" : /Android/.test(ua) ? "안드로이드" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "기기";
    const br = /KAKAOTALK/i.test(ua) ? "카카오톡" : /SamsungBrowser/.test(ua) ? "삼성 인터넷" : /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
    return (os + " " + br).trim();
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function waitUi(first, dev, call) {
    return new Promise((resolve, reject) => {
      let done = false, timer = null;
      const box = document.createElement("div");
      box.setAttribute("style", "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;");
      const t = first.smsTargets || [];
      box.innerHTML = '<div style="background:#fff;color:#222;max-width:420px;width:100%;border-radius:14px;padding:18px;font:14px/1.5 system-ui,sans-serif;">' +
        '<h3 style="margin:0 0 8px;">🛂 새 기기 확인</h3>' +
        '<p style="margin:0 0 8px;">처음 보는 기기라 확인이 필요해요. <b>베니 님 폰이나 등록된 PC</b>에 온 알림에서 <b>허용</b>을 눌러 주세요. (10분 안에)</p>' +
        (t.length ? '<p style="margin:8px 0 4px;color:#666;">폰·PC를 못 쓰면 문자로 인증:</p>' + t.map((x, i) => '<button type="button" data-sms="' + i + '" style="margin:0 6px 6px 0;padding:6px 10px;">📱 ' + esc(x) + '로 받기</button>').join("") +
          '<div data-code style="display:none;margin-top:6px;"><input data-in inputmode="numeric" maxlength="6" placeholder="인증번호 6자리" style="width:140px;padding:8px;"> <button type="button" data-ok style="padding:6px 10px;">확인</button></div>' : "") +
        '<p data-msg style="margin:8px 0 0;color:#666;">기다리는 중…</p>' +
        '<div style="text-align:right;margin-top:10px;"><button type="button" data-cancel style="padding:6px 12px;">취소</button></div></div>';
      document.body.appendChild(box);
      const msg = s => { box.querySelector("[data-msg]").textContent = s; };
      const finish = (err, tok) => { if (done) return; done = true; clearTimeout(timer); box.remove(); err ? reject(err) : resolve(tok); };
      const ask = extra => call(Object.assign({ holdId: first.holdId, pollKey: first.pollKey, deviceId: dev }, extra || {})).then(x => { saveKey(x.deviceKey); if (x.token) finish(null, x.token); return x; });
      const poll = () => { if (done) return; ask().then(() => { if (!done) timer = setTimeout(poll, 3000); }).catch(e => finish(new Error((e && e.message) || "확인하지 못했어요."))); };
      box.querySelector("[data-cancel]").onclick = () => finish(new Error("취소했어요."));
      box.querySelectorAll("[data-sms]").forEach(b => b.onclick = () => {
        msg("문자 보내는 중…");
        ask({ smsSend: Number(b.getAttribute("data-sms")) }).then(x => {
          msg((x.smsSent || "") + " 번호로 인증번호를 보냈어요. 받은 6자리를 넣어 주세요.");
          box.querySelector("[data-code]").style.display = ""; box.querySelector("[data-in]").focus();
        }).catch(e => msg((e && e.message) || "문자를 보내지 못했어요."));
      });
      const ok = box.querySelector("[data-ok]");
      if (ok) ok.onclick = () => {
        const v = (box.querySelector("[data-in]").value || "").replace(/\D/g, "");
        if (v.length !== 6) return msg("6자리를 넣어 주세요.");
        msg("확인 중…");
        ask({ smsCode: v }).catch(e => msg((e && e.message) || "인증번호가 맞지 않아요."));
      };
      timer = setTimeout(poll, 3000);
    });
  }
  window.bennyAdminLogin = async function (app, pw) {
    const call = d => app.functions("asia-northeast3").httpsCallable("adminLogin")(d).then(r => (r && r.data) || {});
    const dev = devId();
    /* onceOk: 이 페이지는 비번을 저장하지 않아 '이번만 허용'(12시간)으로 들어와도 됨 */
    const r = await call({ password: pw, deviceId: dev, deviceKey: devKey(), deviceName: devName(), onceOk: 1 });
    saveKey(r.deviceKey);
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
