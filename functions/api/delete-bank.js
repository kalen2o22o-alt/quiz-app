// Cloudflare Pages Function — 题库删除 API
// 位置：functions/api/delete-bank.js → POST /api/delete-bank
// 依赖：KV namespace 绑定变量 QUIZ_KV
// 键：quiz:bank:<subj>:<bankType>（bankType = chapters / intensive / papers）
// body：{ bankType, subject, id, section? }（章节清空传 id='__ALL__'）
const KVPrefix = 'quiz:bank:';
const BANK_FILES = { chapters: 'chapters', intensive: 'intensive', papers: 'papers' };

function corsHeaders(origin) {
  const allowed = ['https://quiz-app-1iy.pages.dev', 'http://localhost:8777', 'http://127.0.0.1:8777'];
  const corsOrigin = allowed.includes(origin) ? origin : (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') ? origin : '');
  return {
    'Access-Control-Allow-Origin': corsOrigin || 'https://quiz-app-1iy.pages.dev',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: JSON_HEADERS });
  }
  let body;
  try { body = await request.json(); } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: JSON_HEADERS });
  }
  const bankType = body && body.bankType;
  const subject = body && body.subject ? String(body.subject) : '';
  const delId = body && body.id ? String(body.id) : '';
  const section = body && body.section ? String(body.section) : '';
  if (!BANK_FILES[bankType] || !subject || !delId) {
    return new Response(JSON.stringify({ error: 'bad request: bankType/subject/id required' }), { status: 400, headers: JSON_HEADERS });
  }
  const key = KVPrefix + subject + ':' + bankType;

  let existing = null;
  try { existing = await env.QUIZ_KV.get(key, 'json'); } catch (e) { existing = null; }
  if (existing == null) {
    return new Response(JSON.stringify({ error: '题库文件不存在（云端未导入过）' }), { status: 404, headers: JSON_HEADERS });
  }

  let deleted = false;
  let deletedName = '';
  try {
    if (bankType === 'chapters') {
      // chapters 可能是 {章节:{sections:{...}}} 或完整结构 {chapters:{...}}
      const chs = (existing.chapters && typeof existing.chapters === 'object') ? existing.chapters : existing;
      if (delId === '__ALL__') {
        const count = Object.keys(chs).length;
        if (existing.chapters && typeof existing.chapters === 'object') existing.chapters = {}; else existing = {};
        deletedName = '全部章节（' + count + '章）';
        deleted = true;
      } else if (chs[delId]) {
        if (section && chs[delId].sections && chs[delId].sections[section]) {
          deletedName = delId + ' / ' + section;
          delete chs[delId].sections[section];
          if (Object.keys(chs[delId].sections || {}).length === 0) delete chs[delId];
          deleted = true;
        } else if (!section) {
          deletedName = delId;
          delete chs[delId];
          deleted = true;
        }
      }
    } else if (Array.isArray(existing)) {
      const idx = existing.findIndex(p => p && p.id === delId);
      if (idx >= 0) {
        deletedName = existing[idx].name || delId;
        existing.splice(idx, 1);
        deleted = true;
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'delete failed: ' + String(e.message || e) }), { status: 500, headers: JSON_HEADERS });
  }

  if (!deleted) {
    return new Response(JSON.stringify({ error: '未找到 id=' + delId + ' 的条目' }), { status: 404, headers: JSON_HEADERS });
  }

  try {
    await env.QUIZ_KV.put(key, JSON.stringify(existing));
  } catch (e) {
    return new Response(JSON.stringify({ error: 'kv write failed', detail: String(e.message || e) }), { status: 500, headers: JSON_HEADERS });
  }
  return new Response(JSON.stringify({ ok: true, bankType, subject, id: delId, name: deletedName, dataPath: key }), { status: 200, headers: JSON_HEADERS });
}
