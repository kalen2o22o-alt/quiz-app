#!/usr/bin/env node
/**
 * 题刷刷 · 本地落盘服务器（方案二：文件仓版）
 * --------------------------------------------------
 * - 托管当前目录的静态文件（题刷刷.html / renderer.js / bank_*.js 等）
 * - 提供 /api/data/<name>.json 的 GET（读取）与 PUT（原子写）接口
 *   data/ 目录即数据库：history / wrong / favorites / answers 每次交卷/变更实时落盘
 * - 端口默认 8777，被占用则 8778 / 8779 依次自增
 * - 路径校验：仅放行白名单文件名且必须落在 data/ 内，防目录穿越
 * - CORS：允许 *（便于本地跨源调用）
 *
 * 启动：node server.js   （建议用 启动刷题.bat 双击）
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PORT_FILE = path.join(ROOT, 'server.port');

// 科目目录白名单（科目 id -> 中文名；与 meta.js / data 目录结构一致）
const SUBJECTS = [
  { id: 'accounting', name: '会计' },
  { id: 'finance',    name: '财务成本管理' },
  { id: 'economics',  name: '经济法' },
  { id: 'tax',        name: '税法' },
];
const SUBJECT_IDS = new Set(SUBJECTS.map(s => s.id));

// 仅这些文件名允许被 GET/PUT
const ALLOWED = new Set([
  'chapters.json',
  'papers.json',
  'history.json',
  'wrong.json',
  'favorites.json',
  'answers.json',
  'drafts.json',
  'notes.json',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function safeDataPath(subject, name) {
  if (!SUBJECT_IDS.has(subject)) return null;
  if (!ALLOWED.has(name)) return null;
  const p = path.join(DATA_DIR, subject, name);
  // 解析后必须严格落在 data/<subject>/ 内
  const rp = path.resolve(p);
  if (rp !== path.join(DATA_DIR, subject, name)) return null;
  if (path.dirname(rp) !== path.join(DATA_DIR, subject)) return null;
  return rp;
}

// /api/meta：动态扫描 data/ 各科目目录，返回科目列表与是否有章节题库
function handleMeta(res) {
  const origin = null;
  const subjects = SUBJECTS.map(s => {
    const f = path.join(DATA_DIR, s.id, 'chapters.json');
    let hasData = false;
    try {
      const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
      const ch = (obj && obj.chapters) || {};
      hasData = Object.keys(ch).length > 0;
    } catch (e) { hasData = false; }
    return { id: s.id, name: s.name, hasData };
  });
  sendJSON(res, 200, { subjects }, origin);
}

// Origin 白名单：仅限本机页面访问（同源 / http(s)://localhost:* / http(s)://127.0.0.1:*）
// 无 Origin 头（非浏览器调用，如本地 curl）视为允许；其他一切来源拒绝，保护 data/ 用户数据不被本机任意网页跨源读写
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
function originAllowed(origin) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.has(u.hostname);
  } catch (e) { return false; }
}
// 仅当来源合法时才回显 CORS 头（不再使用 Access-Control-Allow-Origin: *）
function corsHeaders(origin) {
  if (origin && originAllowed(origin)) return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'false' };
  return {};
}

function sendJSON(res, code, obj, origin) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, corsHeaders(origin)));
  res.end(body);
}

function sendCorsPreflight(res, origin) {
  res.writeHead(204, Object.assign({
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }, corsHeaders(origin)));
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 32 * 1024 * 1024) { // 32MB 上限
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return reject(new Error('payload too large'));
      resolve(data);
    });
    req.on('error', reject);
  });
}

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file); // 原子替换，避免崩溃/并发损坏 JSON
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]).replace(/\\/g, '/');
  if (rel === '/' || rel === '') rel = '/题刷刷.html';
  // 防目录穿越：任何含 ".." 段（含 %2e%2e / %5c 反斜杠变体）一律拒绝
  if (rel.split('/').some(s => s === '..')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const target = path.resolve(ROOT, '.' + rel);
  const relCheck = path.relative(ROOT, target);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + rel);
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store', // 本地服务不缓存，改 config.js/renderer.js 后刷新即生效，避免读到旧文件
    });
    fs.createReadStream(target).pipe(res);
  });
}

function handleApi(req, res, subject, name) {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    sendJSON(res, 403, { error: 'origin not allowed' }, origin);
    return;
  }
  const file = safeDataPath(subject, name);
  if (!file) {
    sendJSON(res, 403, { error: 'forbidden filename' }, origin);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    fs.readFile(file, 'utf8', (err, text) => {
      if (err) {
        // 文件不存在则视为空对象
        if (err.code === 'ENOENT') {
          sendJSON(res, 200, {}, origin);
        } else {
          sendJSON(res, 500, { error: err.message }, origin);
        }
        return;
      }
      res.writeHead(200, Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      }, corsHeaders(origin)));
      res.end(text);
    });
    return;
  }
  if (req.method === 'PUT') {
    readBody(req).then((raw) => {
      // 校验为合法 JSON
      let parsed;
      try {
        parsed = JSON.parse(raw || '{}');
      } catch (e) {
        sendJSON(res, 400, { error: 'invalid json: ' + e.message }, origin);
        return;
      }
      try {
        atomicWrite(file, JSON.stringify(parsed, null, 2));
        sendJSON(res, 200, { ok: true, name }, origin);
      } catch (e) {
        sendJSON(res, 500, { error: e.message }, origin);
      }
    }).catch((e) => {
      sendJSON(res, 400, { error: e.message }, origin);
    });
    return;
  }
  sendJSON(res, 405, { error: 'method not allowed' }, origin);
}

const server = http.createServer((req, res) => {
  const u = req.url || '/';
  if (req.method === 'OPTIONS') { sendCorsPreflight(res, req.headers.origin); return; }
  if (u === '/api/meta' || u.indexOf('/api/meta?') === 0) { handleMeta(res); return; }
  const m = u.match(/^\/api\/data\/([a-zA-Z0-9_\-]+)\/([a-zA-Z0-9_\-]+\.json)$/);
  if (m) { handleApi(req, res, m[1], m[2]); return; }
  serveStatic(req, res, u);
});

function start(port) {
  server.listen(port, '127.0.0.1', () => {
    const actual = server.address().port;
    try { fs.writeFileSync(PORT_FILE, String(actual), 'utf8'); } catch (e) {}
    console.log('题刷刷本地服务已启动: http://localhost:' + actual + '/题刷刷.html');
    console.log('数据目录: ' + DATA_DIR);
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < 8799) {
      console.log('端口 ' + port + ' 被占用，尝试 ' + (port + 1));
      start(port + 1);
    } else {
      console.error('服务启动失败:', e.message);
      process.exit(1);
    }
  });
}

start(8777);
