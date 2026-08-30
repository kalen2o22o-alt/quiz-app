// storage-cloudflare.js
// 在线模式存储适配器（Cloudflare Pages Functions + KV，全免费）：
// 把用户学习记录（history/wrong/favorites/notes/answers）存到 Cloudflare KV，
// 跨设备集中、不丢。题库仍由 bank_*.js 本地提供。
// 仅当 window.__CLOUDFLARE_CONFIG__ 已正确配置时才激活；否则保持惰性，本地/server 模式不受影响。
// 与 storage-cloudbase.js 暴露相同接口：ready / unlock() / loadAll(subj) / saveFile(subj,file,obj)
(function(){
  'use strict';
  var cfg = window.__CLOUDFLARE_CONFIG__;
  if(!cfg){ return; }
  var apiBase = String(cfg.apiBase || '').replace(/\/+$/, ''); // 留空 = 与前端同域 /api
  var FILES = ['history', 'wrong', 'favorites', 'error_corrected', 'notes', 'answers'];
  var nsSeed = ''; // 口令哈希命名空间前缀（不知道口令就无法定位行）

  function simpleHash(str){
    var h = 5381;
    for(var i = 0; i < str.length; i++){ h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  async function sha256Hex(str){
    try{
      if(typeof crypto !== 'undefined' && crypto.subtle){
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.prototype.map.call(new Uint8Array(buf), function(b){ return b.toString(16).padStart(2, '0'); }).join('');
      }
    }catch(e){}
    return simpleHash(str);
  }

  // 访问口令弹窗（仅 requirePassphrase=true 时触发）
  function askPassphrase(){
    return new Promise(function(resolve){
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,24,30,.5);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:system-ui,sans-serif';
      overlay.innerHTML =
        '<div style="background:#fff;border-radius:14px;padding:24px 26px;width:320px;box-shadow:0 10px 40px rgba(0,0,0,.25)">' +
          '<div style="font-size:16px;font-weight:600;color:#1f2329;margin-bottom:4px">解锁刷题记录</div>' +
          '<div style="font-size:13px;color:#7a7f87;margin-bottom:14px">输入你的访问口令（各设备需一致）</div>' +
          '<input id="pw" type="password" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d0d3d9;border-radius:8px;font-size:14px;outline:none" placeholder="口令"/>' +
          '<div id="err" style="color:#c0392b;font-size:12px;min-height:16px;margin:6px 0"></div>' +
          '<button id="ok" style="width:100%;padding:10px;border:0;border-radius:8px;background:#185FA5;color:#fff;font-size:14px;cursor:pointer">进入</button>' +
        '</div>';
      document.body.appendChild(overlay);
      var input = overlay.querySelector('#pw');
      var err = overlay.querySelector('#err');
      input.focus();
      function submit(){
        var v = input.value || '';
        if(v.length < 1){ err.textContent = '请输入口令'; return; }
        overlay.remove();
        resolve(v);
      }
      overlay.querySelector('#ok').addEventListener('click', submit);
      input.addEventListener('keydown', function(e){ if(e.key === 'Enter') submit(); });
    });
  }

  async function unlock(){
    if(!cfg.requirePassphrase) return;
    // 同一浏览器记住口令（存哈希，非明文）：只输一次，刷新/重开自动解锁
    var saved = null;
    try { saved = localStorage.getItem('quiz_cf_ns'); } catch(e) {}
    if(saved){ nsSeed = saved; return; }
    var pw = await askPassphrase();
    nsSeed = await sha256Hex('cpa-quiz::' + pw);
    try { localStorage.setItem('quiz_cf_ns', nsSeed); } catch(e) {}
  }

  function baseUrl(){ return (apiBase || '') + '/api'; }

  async function loadAll(subj){
    var res = await fetch(baseUrl() + '?subj=' + encodeURIComponent(subj) + '&ns=' + encodeURIComponent(nsSeed), { method: 'GET' });
    if(!res.ok){ throw new Error('云端读取失败 HTTP ' + res.status); }
    var map = {};
    try{ map = await res.json(); }catch(e){}
    var out = {};
    FILES.forEach(function(f){ out[f] = map[f] || {}; });
    return out;
  }

  async function saveFile(subj, file, obj){
    var res = await fetch(baseUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subj: subj, file: file, value: obj || {}, ns: nsSeed })
    });
    if(!res.ok){ throw new Error('云端写入失败 HTTP ' + res.status); }
    return await res.json();
  }

  window.CloudStore = { ready: true, unlock: unlock, loadAll: loadAll, saveFile: saveFile };
})();
