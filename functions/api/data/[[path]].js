// Cloudflare Pages Function — 题库数据读取 API
// 位置：functions/api/data/[[path]].js → GET /api/data/<subj>/<file>.json
// 依赖：KV namespace 绑定变量 QUIZ_KV
// 键：quiz:bank:<subj>:<bankType>（bankType = chapters / intensive / papers）
// 无 KV 数据时返回 404，前端回退静态 bank_*.js 兜底
const KVPrefix = 'quiz:bank:';
const FILE_MAP = {
  'chapters.json': 'chapters',
  'intensive.json': 'intensive',
  'papers.json': 'papers',
};

function corsHeaders(origin) {
  const allowed = ['https://quiz-app-1iy.pages.dev', 'http://localhost:8777', 'http://127.0.0.1:8777'];
  const corsOrigin = allowed.includes(origin) ? origin : (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') ? origin : '');
  return {
    'Access-Control-Allow-Origin': corsOrigin || 'https://quiz-app-1iy.pages.dev',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const CORS = corsHeaders(origin);
  const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: JSON_HEADERS });
  }

  // path: ["<subj>", "<file>.json"]（motto.json 等用户数据文件不在此处理，走 /api?subj=）
  const segs = (context.params && context.params.path) || [];
  if (segs.length < 2) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS });
  }
  const subject = decodeURIComponent(segs[0]);
  const file = segs[segs.length - 1];
  const bankType = FILE_MAP[file];
  if (!bankType || !subject) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS });
  }

  const key = KVPrefix + subject + ':' + bankType;
  let v = null;
  try { v = await env.QUIZ_KV.get(key, 'json'); } catch (e) { v = null; }
  if (v == null) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS });
  }
  return new Response(JSON.stringify(v), { status: 200, headers: JSON_HEADERS });
}
