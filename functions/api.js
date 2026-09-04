// Cloudflare Pages Function — 题刷刷云端数据 API
// 文件位置：functions/api.js （部署后自动成为 /api 路由，与前端同域）
// 依赖：Pages 项目绑定 KV namespace，变量名固定为 QUIZ_KV
//
// 【本版为“诊断 + 加固”版，相对旧版改动】
//   1. 新增诊断接口：GET /api?diag=1  → 返回 { kvBound, envKeys }，用于确认 KV 绑定是否注入
//   2. PUT 写入加 try/catch（不再让 Worker 崩溃为 500 HTML，返回可读 JSON 错误）
//   3. GET 读取失败不再伪装成空数据（附带 __kvError 字段，前端可据此显示真实状态）
//
// 接口：
//   GET  /api?quota=1                     → 当日 KV 写入配额（writes/limit/pct，方案A）
//   GET  /api?diag=1                      → 诊断 KV 绑定状态
//   GET  /api?subj=<科目id>&ns=<口令命名空间>  → { history, wrong, favorites, error_corrected, notes, answers, drafts }
//   PUT  /api  body:{ subj, file, value, ns }  → 写入 KV（服务端自动合并，防双端覆盖）
//   OPTIONS → CORS 预检

// 模块级内存限流计数（不写 KV，避免消耗 KV 写配额）
const rateMap = new Map();

// ============ 方案A：KV 当日真实写入计数（配额可见性） ============
// 内存计数为主，每累计 20 次真写或跨小时时低频持久化 1 次到 KV；
// 冷启动后首次查询 quota 时从 KV 恢复基线。计数键本身占少量写入（≤5%）。
const WRITE_LIMIT = 1000;   // Cloudflare KV 免费版每日写入上限
let writeCount = 0;         // 本进程当日累计真实写入
let writeDay = '';          // 计数归属日期（UTC，与 Cloudflare 日配额对齐）
let loadedFlag = false;     // 当日是否已从 KV 恢复过基线
let lastFlushHr = 0;        // 上次持久化的整点小时
function todayStr(){ return new Date().toISOString().slice(0, 10); }
function ensureDay(){ const d = todayStr(); if(writeDay !== d){ writeDay = d; writeCount = 0; loadedFlag = false; } }
async function flushCounter(env, force){
  try{
    if(!env || !env.QUIZ_KV) return;
    const hr = Math.floor(Date.now() / 3600000);
    if(!force && writeCount % 20 !== 0 && hr === lastFlushHr) return;
    lastFlushHr = hr;
    await env.QUIZ_KV.put(KVPrefix + '__budget__:day:' + writeDay, JSON.stringify({ c: writeCount }));
  }catch(e){ /* 计数持久化失败不影响主流程 */ }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // P1-7：CORS 限定为 Pages 域名（动态读取 Origin，同域或允许的域名才放行）
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = [
    'https://quiz-app-1iy.pages.dev',
    'http://localhost:8777',
    'http://127.0.0.1:8777',
  ];
  const corsOrigin = allowedOrigins.includes(origin)
    ? origin
    : (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') ? origin : '');
  const CORS = {
    'Access-Control-Allow-Origin': corsOrigin || 'https://quiz-app-1iy.pages.dev',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };
  const FILES = ['history', 'wrong', 'favorites', 'error_corrected', 'notes', 'answers', 'motto']; // drafts 仅本地，不同步云端
  const KVPrefix = 'quiz:';

  // ============ 新增：诊断接口 ============
  if (url.searchParams.get('diag') === '1') {
    return new Response(JSON.stringify({
      diag: true,
      kvBound: !!(env && env.QUIZ_KV),
      envKeys: Object.keys(env || {}),
      time: Date.now(),
    }), { status: 200, headers: JSON_HEADERS });
  }

  // ============ 方案A：KV 当日写入配额查询（放在限流前，轮询不消耗限流额度） ============
  if (url.searchParams.get('quota') === '1') {
    ensureDay();
    if(!loadedFlag){
      loadedFlag = true;
      try{
        const kv = await env.QUIZ_KV.get(KVPrefix + '__budget__:day:' + writeDay, 'json');
        if(kv && typeof kv.c === 'number') writeCount = kv.c;
      }catch(e){}
    }
    return new Response(JSON.stringify({
      day: writeDay,
      writes: writeCount,
      limit: WRITE_LIMIT,
      remaining: Math.max(0, WRITE_LIMIT - writeCount),
      pct: Math.min(100, Math.round(writeCount / WRITE_LIMIT * 100)),
    }), { status: 200, headers: JSON_HEADERS });
  }

  // P1-7：简单限流（每个IP每分钟最多120次请求）
  // 【优化】改用纯内存计数，不再写 KV —— 避免每次请求都消耗 KV 写配额（免费版 1000次/天）
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const nowMin = Math.floor(Date.now() / 60000);
  const rateKey = 'rate:' + clientIP + ':' + nowMin;
  const rCount = rateMap.get(rateKey) || 0;
  if (rCount >= 120) {
    return new Response(JSON.stringify({ error: 'rate limit exceeded' }), { status: 429, headers: JSON_HEADERS });
  }
  rateMap.set(rateKey, rCount + 1);
  // 清理 2 分钟前的旧窗口，防止内存无限增长
  if (rateMap.size > 2000) {
    for (const k of rateMap.keys()) {
      if (!k.includes(':' + nowMin) && !k.includes(':' + (nowMin - 1))) rateMap.delete(k);
    }
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method === 'GET') {
    const subj = (url.searchParams.get('subj') || '').trim();
    const ns = (url.searchParams.get('ns') || '').trim();
    if (!subj) {
      return new Response(JSON.stringify({ error: 'missing subj' }), { status: 400, headers: JSON_HEADERS });
    }
    const map = {};
    let kvError = null;
    for (const f of FILES) {
      const key = KVPrefix + ns + ':' + subj + ':' + f;
      let v = null;
      // P1：读取失败不再静默吞掉，记录错误
      try { v = await env.QUIZ_KV.get(key, 'json'); } catch (e) { kvError = String((e && e.message) || e); }
      map[f] = v || {};
    }
    // P1：若 KV 未绑定或读取失败，附加真实状态，前端可据此判断而非误报“已连接”
    if (kvError || !env.QUIZ_KV) {
      map.__kvError = kvError || 'kv binding missing (env.QUIZ_KV is undefined)';
    }
    return new Response(JSON.stringify(map), { status: 200, headers: JSON_HEADERS });
  }

  if (request.method === 'PUT') {
    let body;
    try { body = await request.json(); } catch (e) {
      return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: JSON_HEADERS });
    }
    const subj = body && body.subj ? String(body.subj) : '';
    const file = body && body.file ? String(body.file) : '';
    const ns = body && body.ns ? String(body.ns) : '';
    if (!subj || FILES.indexOf(file) < 0) {
      return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: JSON_HEADERS });
    }
    const key = KVPrefix + ns + ':' + subj + ':' + file;

    // P1-2：服务端记录级合并，防双端同时写入互相覆盖
    let current = null;
    try { current = await env.QUIZ_KV.get(key, 'json'); } catch (e) { current = null; }
    const incoming = body.value || {};
    const merged = mergeValues(current, incoming);

    // 优化：若合并结果与 KV 现有值相同，跳过写回（省 KV 写配额 + CPU）
    try {
      const mergedJson = JSON.stringify(merged);
      if (current !== null && JSON.stringify(current) === mergedJson) {
        return new Response(JSON.stringify({ ok: true, key: key, merged: false, skipped: true }), { status: 200, headers: JSON_HEADERS });
      }
      // P1：写入加 try/catch，不再让 Worker 崩溃为 500 HTML，返回可读错误
      await env.QUIZ_KV.put(key, mergedJson);
      // 方案A：真实写入计数 + 低频持久化
      ensureDay();
      writeCount++;
      await flushCounter(env, false);
    } catch (e) {
      return new Response(JSON.stringify({
        error: 'kv write failed',
        detail: String((e && e.message) || e),
        kvBound: !!(env && env.QUIZ_KV),
      }), { status: 500, headers: JSON_HEADERS });
    }
    return new Response(JSON.stringify({ ok: true, key: key, merged: true }), { status: 200, headers: JSON_HEADERS });
  }

  return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: JSON_HEADERS });
}

// P1-2：记录级深度合并（对象取并集，数组按id去重，标量取新值）
function mergeValues(a, b) {
  if (b === null || b === undefined) return a || {};
  if (a === null || a === undefined) return b;
  if (Array.isArray(a) && Array.isArray(b)) {
    // 数组：按 id 字段去重合并
    const map = {};
    a.forEach(item => { if (item && item.id) map[item.id] = item; });
    b.forEach(item => { if (item && item.id) map[item.id] = item; });
    return Object.values(map);
  }
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...a };
    for (const k of Object.keys(b)) {
      if (out[k] !== undefined && typeof out[k] === 'object' && typeof b[k] === 'object' && !Array.isArray(out[k]) && !Array.isArray(b[k])) {
        out[k] = mergeValues(out[k], b[k]);
      } else {
        out[k] = b[k];
      }
    }
    return out;
  }
  return b; // 标量：新值覆盖旧值
}
