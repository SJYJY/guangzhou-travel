// 密码门：输入正确密码后才显示网页，并弹出欢迎页
// 注意：这是纯前端的“门锁”，挡住随手打开的人；懂技术的人查看源码仍能看到内容
(function () {
  var SITE = "和宝宝的100天旅游";
  var KEY = "gz_gate_ok_v1";
  var HASH = "076ec6b2"; // 密码的校验值（不直接写明文）
  function h(s) { var x = 0x811c9dc5; s = "gz-baby100:" + s; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return ("0000000" + x.toString(16)).slice(-8); }
  var realTitle = document.title;
  var ok = false; try { ok = localStorage.getItem(KEY) === HASH; } catch (e) {}

  var css = document.createElement("style");
  css.textContent =
    "#gate,#welcome{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;" +
    "font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:linear-gradient(135deg,#ffdde1,#ee9ca7 45%,#c0392b);color:#fff;text-align:center}" +
    "#gate .card{background:rgba(255,255,255,.18);backdrop-filter:blur(8px);border-radius:20px;padding:34px 30px;width:300px;box-shadow:0 10px 40px rgba(0,0,0,.2)}" +
    "#gate .lock{font-size:46px}#gate h2{margin:10px 0 18px;font-size:20px;font-weight:600}" +
    "#gate input{width:100%;box-sizing:border-box;font-size:26px;letter-spacing:12px;text-align:center;padding:10px;border:none;border-radius:12px;outline:none;color:#c0392b}" +
    "#gate button{margin-top:14px;width:100%;padding:11px;font-size:16px;border:none;border-radius:12px;background:#fff;color:#c0392b;font-weight:700;cursor:pointer}" +
    "#gate .err{height:20px;margin-top:10px;font-size:13px;color:#fff3b0}" +
    "#gate .card.shake{animation:gshake .4s}@keyframes gshake{20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}" +
    "#welcome{opacity:0;transition:opacity .6s;cursor:pointer}#welcome.show{opacity:1}" +
    "#welcome .t{font-size:40px;font-weight:800;text-shadow:0 4px 20px rgba(0,0,0,.25);transform:scale(.8);transition:transform .8s cubic-bezier(.2,1.6,.4,1)}" +
    "#welcome.show .t{transform:scale(1)}#welcome .s{margin-top:14px;font-size:16px;opacity:.9}" +
    "#welcome .hearts{font-size:30px;margin-bottom:12px;animation:gbeat 1.2s infinite}@keyframes gbeat{50%{transform:scale(1.15)}}" +
    "html.gz-locked,html.gz-locked body{overflow:hidden}html.gz-locked body{visibility:hidden}html.gz-locked #gate{visibility:visible}";
  document.head.appendChild(css);

  function setSiteTitle() {
    document.title = realTitle;
    var b = document.querySelectorAll(".topnav .brand"); for (var i = 0; i < b.length; i++) b[i].textContent = "💕 " + SITE;
    setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 50);
  }
  function welcome() {
    var w = document.createElement("div"); w.id = "welcome";
    w.innerHTML = '<div class="hearts">💕 👶 🌸</div><div class="t">' + SITE + '</div><div class="s">广州 · 荔湾 · 越秀 · 天河</div><div class="s" style="font-size:12px;margin-top:30px;opacity:.7">点击进入</div>';
    document.body.appendChild(w);
    requestAnimationFrame(function () { requestAnimationFrame(function () { w.classList.add("show"); }); });
    var close = function () { w.classList.remove("show"); setTimeout(function () { w.remove(); }, 600); };
    w.onclick = close; setTimeout(close, 3000);
  }
  if (ok) { document.addEventListener("DOMContentLoaded", setSiteTitle); return; }

  document.title = "🔒 请输入密码";
  document.documentElement.classList.add("gz-locked");
  document.addEventListener("DOMContentLoaded", function () {
    var g = document.createElement("div"); g.id = "gate";
    g.innerHTML = '<div class="card"><div class="lock">🔒</div><h2>请输入密码</h2>' +
      '<input id="gatePwd" type="password" inputmode="numeric" maxlength="12" autocomplete="off" autofocus>' +
      '<button id="gateBtn">进 入</button><div class="err" id="gateErr"></div></div>';
    document.body.appendChild(g);
    var inp = document.getElementById("gatePwd"), card = g.querySelector(".card");
    function tryOpen() {
      if (h(inp.value.trim()) === HASH) {
        try { localStorage.setItem(KEY, HASH); } catch (e) {}
        document.documentElement.classList.remove("gz-locked"); g.remove(); setSiteTitle(); welcome();
      } else {
        document.getElementById("gateErr").textContent = "密码不对，再试一次～";
        card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake"); inp.value = ""; inp.focus();
      }
    }
    document.getElementById("gateBtn").onclick = tryOpen;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") tryOpen(); });
    setTimeout(function () { inp.focus(); }, 100);
  });
})();
