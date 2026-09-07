// Cloudflare Pages Function — 题库导入 API
// 位置：functions/api/import-bank.js → POST /api/import-bank
// 依赖：KV namespace 绑定变量 QUIZ_KV
// 键：quiz:bank:<subj>:<bankType>（bankType = chapters / intensive / papers）
// 逻辑：读 KV 现有题库 → 合并导入数据 → 写回；KV 无数据时用前端 fullBanks 种子初始化（避免丢失静态兜底题库）
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

// 合并：papers/intensive 数组按 id 覆盖/追加；chapters 合并章节对象
function mergeBank(existing, incoming) {
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const out = existing.slice();
    for (const item of incoming) {
      if (!item || !item.id) continue;
      const idx = out.findIndex(x => x && x.id === item.id);
      if (idx >= 0) out[idx] = item; else out.push(item);
    }
    return out;
  }
  if (existing && typeof existing === 'object' && incoming && typeof incoming === 'object') {
    const out = { ...existing };
    for (const k of Object.keys(incoming)) {
      const v = incoming[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        // 章节下的小节合并
        const secs = { ...(out[k].sections || {}) };
        if (v.sections) for (const sk of Object.keys(v.sections)) {
          if (secs[sk] && Array.isArray(secs[sk].questions) && Array.isArray(v.sections[sk].questions)) {
            const qs = secs[sk].questions.slice();
            for (const q of v.sections[sk].questions) {
              if (!q || q.src_no == null) { qs.push(q); continue; }
              const qi = qs.findIndex(x => x && x.src_no === q.src_no);
              if (qi >= 0) qs[qi] = q; else qs.push(q);
            }
            secs[sk] = { ...(secs[sk] || {}), ...v.sections[sk], questions: qs };
          } else {
            secs[sk] = v.sections[sk];
          }
        }
        out[k] = { ...out[k], ...v, sections: secs };
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return incoming;
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
  const importData = body && body.data;
  const fullBanks = (body && body.fullBanks) || {};
  if (!BANK_FILES[bankType] || !subject || !importData) {
    return new Response(JSON.stringify({ error: 'bad request: bankType/subject/data required' }), { status: 400, headers: JSON_HEADERS });
  }
  const key = KVPrefix + subject + ':' + bankType;

  // 读现有（KV）；无则尝试用前端 fullBanks 种子（含静态兜底题库），再无则仅导入数据
  let existing = null;
  try { existing = await env.QUIZ_KV.get(key, 'json'); } catch (e) { existing = null; }
  let base = null;
  if (existing != null && typeof existing === 'object') {
    base = existing;
  } else if (fullBanks && fullBanks[bankType] != null) {
    base = fullBanks[bankType];
  }
  // 导入数据：chapters 传入的是章节对象 {章节名:{...}}；papers/intensive 传入套卷或套卷数组
  let incoming = importData;
  let added = 0;
  try {
    if (bankType === 'chapters') {
      const inc = (incoming && typeof incoming === 'object') ? incoming : {};
      const src = (base && typeof base === 'object' && base.chapters && typeof base.chapters === 'object') ? base.chapters : (base || {});
      const merged = mergeBank(src, inc);
      const wrapped = (base && typeof base === 'object' && base.chapters && typeof base.chapters === 'object')
        ? { ...base, chapters: merged }
        : merged;
      base = wrapped;
      added = JSON.stringify(inc).length;
    } else {
      const incArr = Array.isArray(incoming) ? incoming : (incoming ? [incoming] : []);
      const baseArr = Array.isArray(base) ? base : [];
      base = mergeBank(baseArr, incArr);
      added = incArr.reduce((n, p) => n + (p && p.questions ? p.questions.length : 0), 0);
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'merge failed: ' + String(e.message || e) }), { status: 500, headers: JSON_HEADERS });
  }

  try {
    await env.QUIZ_KV.put(key, JSON.stringify(base));
  } catch (e) {
    return new Response(JSON.stringify({ error: 'kv write failed', detail: String(e.message || e), kvBound: !!(env && env.QUIZ_KV) }), { status: 500, headers: JSON_HEADERS });
  }
  return new Response(JSON.stringify({ ok: true, bankType, subject, addedQuestions: added, dataPath: key }), { status: 200, headers: JSON_HEADERS });
}
