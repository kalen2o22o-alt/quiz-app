// Cloudflare Pages Function — 题刷刷云端数据 API
// 文件位置：functions/api.js （部署后自动成为 /api 路由，与前端同域）
// 依赖：Pages 项目绑定 KV namespace，变量名固定为 QUIZ_KV
// 接口：
//   GET  /api?subj=<科目id>&ns=<口令命名空间>  → { history, wrong, favorites, error_corrected, notes, answers }
//   PUT  /api  body:{ subj, file, value, ns }  → 写入 KV
//   OPTIONS → CORS 预检（默认放行所有来源，同域部署时本就不需要）
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  };
  const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };
  const FILES = ['history', 'wrong', 'favorites', 'error_corrected', 'notes', 'answers'];
  const KVPrefix = 'quiz:';

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
    for (const f of FILES) {
      const key = KVPrefix + ns + ':' + subj + ':' + f;
      let v = null;
      try { v = await env.QUIZ_KV.get(key, 'json'); } catch (e) { v = null; }
      map[f] = v || {};
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
    await env.QUIZ_KV.put(key, JSON.stringify(body.value || {}));
    return new Response(JSON.stringify({ ok: true, key: key }), { status: 200, headers: JSON_HEADERS });
  }

  return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: JSON_HEADERS });
}
