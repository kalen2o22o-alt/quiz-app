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
  var FILES = ['history', 'wrong', 'favorites', 'error_corrected', 'notes', 'answers', 'drafts', 'motto'];
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

  // 检查命名空间是否有数据（用于口令校验）
  async function namespaceHasData(ns){
    try{
      var res = await fetch(baseUrl() + '?subj=accounting&ns=' + encodeURIComponent(ns), { method: 'GET' });
      if(!res.ok) return null; // 网络错误，无法判断
      var map = await res.json();
      var hasData = false;
      FILES.forEach(function(f){
        var v = map[f];
        if(v && typeof v === 'object' && Object.keys(v).length > 0) hasData = true;
      });
      return hasData;
    }catch(e){ return null; }
  }

  // 确认弹窗
  function confirmDialog(title, msg, okText, cancelText){
    return new Promise(function(resolve){
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,24,30,.5);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:system-ui,sans-serif';
      overlay.innerHTML =
        '<div style="background:#fff;border-radius:14px;padding:24px 26px;width:340px;box-shadow:0 10px 40px rgba(0,0,0,.25)">' +
          '<div style="font-size:16px;font-weight:600;color:#1f2329;margin-bottom:8px">' + title + '</div>' +
          '<div style="font-size:13px;color:#7a7f87;margin-bottom:16px;line-height:1.6">' + msg + '</div>' +
          '<div style="display:flex;gap:10px">' +
            '<button id="cancel" style="flex:1;padding:10px;border:1px solid #d0d3d9;border-radius:8px;background:#fff;color:#555;font-size:14px;cursor:pointer">' + (cancelText || '取消') + '</button>' +
            '<button id="ok" style="flex:1;padding:10px;border:0;border-radius:8px;background:#185FA5;color:#fff;font-size:14px;cursor:pointer">' + (okText || '确认') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.querySelector('#ok').addEventListener('click', function(){ overlay.remove(); resolve(true); });
      overlay.querySelector('#cancel').addEventListener('click', function(){ overlay.remove(); resolve(false); });
    });
  }

  async function unlock(){
    if(!cfg.requirePassphrase) return;
    // 同一浏览器记住口令（存哈希，非明文）：只输一次，刷新/重开自动解锁
    var saved = null;
    try { saved = localStorage.getItem('quiz_cf_ns'); } catch(e) {}
    if(saved){
      nsSeed = saved;
      // 校验已保存的口令：如果命名空间为空且本地有数据，可能口令错误
      var hasData = await namespaceHasData(saved);
      if(hasData === false){
        var localHasData = false;
        try{
          var keys = Object.keys(localStorage);
          keys.forEach(function(k){
            if(k.indexOf('answers_') === 0 || k.indexOf('sessions_') === 0){
              var v = localStorage.getItem(k);
              if(v && v !== '{}' && v !== '[]') localHasData = true;
            }
          });
        }catch(e){}
        if(localHasData){
          var retry = await confirmDialog('口令可能错误', '该口令对应的云端命名空间为空，但本地有学习记录。可能是口令输入错误，是否重新输入？', '重新输入', '继续使用');
          if(retry){
            try { localStorage.removeItem('quiz_cf_ns'); } catch(e) {}
            nsSeed = '';
            return unlock();
          }
        }
      }
      return;
    }
    // 首次输入口令：校验是否为已有命名空间
    while(true){
      var pw = await askPassphrase();
      var ns = await sha256Hex('cpa-quiz::' + pw);
      var hasData = await namespaceHasData(ns);
      if(hasData === false){
        var isNew = await confirmDialog('新建命名空间', '该口令对应的云端命名空间为空（首次使用或口令错误）。确认使用此口令新建？', '确认新建', '重新输入');
        if(!isNew) continue;
      }
      nsSeed = ns;
      try { localStorage.setItem('quiz_cf_ns', nsSeed); } catch(e) {}
      return;
    }
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

  // 内容指纹缓存：避免重复 PUT 同一内容（节省 KV 写配额）
  // 指纹持久化到 localStorage：跨页面加载也能跳过相同内容的 PUT
  var __fpStoreKey__ = 'quiz_cf_fp';
  var __lastSaved__ = {};
  try{
    var _fpRaw = localStorage.getItem(__fpStoreKey__);
    if(_fpRaw){ __lastSaved__ = JSON.parse(_fpRaw) || {}; }
  }catch(e){}
  function _fpSave(){
    try{ localStorage.setItem(__fpStoreKey__, JSON.stringify(__lastSaved__)); }catch(e){}
  }
  function fingerprint(v){
    try{ return simpleHash(JSON.stringify(v)); }catch(e){ return 'x'; }
  }

  async function saveFile(subj, file, obj){
    // 内容与上次已保存一致 → 跳过 PUT（不消耗 KV 写配额）
    var fp = fingerprint(obj || {});
    var cacheKey = subj + ':' + file;
    if(__lastSaved__[cacheKey] === fp){
      return { ok: true, skipped: true, key: cacheKey };
    }
    var body = JSON.stringify({ subj: subj, file: file, value: obj || {}, ns: nsSeed });
    // keepalive 请求在 Cloudflare 上对较大 body 会被关闭连接（ERR_CONNECTION_CLOSED / Failed to fetch）
    // 大数据（>8KB）改用普通请求，避免保存失败；小数据保留 keepalive 以支持页面关闭时发出
    var useKeepalive = body.length <= 8192;
    var res = await fetch(baseUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: useKeepalive
    });
    if(!res.ok){ throw new Error('云端写入失败 HTTP ' + res.status); }
    __lastSaved__[cacheKey] = fp; // 保存成功后记录指纹
    _fpSave();
    return await res.json();
  }

  window.CloudStore = { ready: true, unlock: unlock, loadAll: loadAll, saveFile: saveFile };
})();
