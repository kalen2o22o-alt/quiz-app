(function(){
  // 题库拆分：优先用独立文件（bank_chapters / bank_papers / meta），回退到旧 data.js。
  // BANK_* 现为多科目结构 {subjId: {...}}：取「当前科目」的题库；兼容旧单科目结构。
  function __bankSubj__(){
    let s = 'accounting';
    try{ s = localStorage.getItem('cpa-subject') || 'accounting'; }catch(e){}
    return s;
  }
  const APP = Object.assign(
    {},
    window.APP_DATA || {},
    window.APP_META || {},
    {
      subject: (function(){
        const s = __bankSubj__();
        const meta = window.APP_META;
        if(meta && Array.isArray(meta.subjects)){
          const sm = meta.subjects.find(x => x.id === s);
          if(sm && sm.name) return sm.name;
        }
        return (window.APP_META && window.APP_META.subject) || '会计';
      })(),
      chapters: (function(){
        const b = window.BANK_CHAPTERS;
        if(b == null) return (window.APP_DATA && window.APP_DATA.chapters) || {};
        const s = __bankSubj__();
        return (b[s] != null) ? b[s] : b;
      })(),
      papers: (function(){
        const b = window.BANK_PAPERS;
        if(b == null) return (window.APP_DATA && window.APP_DATA.papers) || [];
        const s = __bankSubj__();
        return (b[s] != null) ? b[s] : b;
      })(),
      intensivePapers: (function(){
        const b = window.BANK_INTENSIVE;
        if(b == null) return [];
        const s = __bankSubj__();
        return (b[s] != null) ? b[s] : b;
      })()
    }
  );
  let subjects = APP.subjects || [];
  // ===== 考试模块（学习中心一级入口，后续可扩展） =====
  // subjects 里的 id 必须与 server.js SUBJECTS / data/<id>/ 目录一致；
  // 新模块接入时：EXAMS 增模块与科目 -> server.js SUBJECTS 增条目 -> data/<id>/ 放题库。
  const EXAMS = [
    { id: 'cpa', short: 'CPA', name: 'CPA · 注册会计师', icon: 'CPA', examDate: '2026-08-29',
      subjects: [
        { id: 'accounting', name: '会计' },
        { id: 'auditing',   name: '审计' },
        { id: 'finance',    name: '财务成本管理' },
        { id: 'tax',        name: '税法' },
        { id: 'economics',  name: '经济法' },
        { id: 'strategy',   name: '公司战略与风险管理' }
      ]},
    { id: 'mid',  short: '中级', name: '中级会计', icon: '中级', examDate: '2026-09-05',
      subjects: [
        { id: 'mid-practice', name: '中级会计实务' },
        { id: 'mid-finance',  name: '中级财务管理' },
        { id: 'mid-econ',     name: '中级经济法' }
      ]},
    { id: 'taxp', short: '税务师', name: '税务师', icon: '税务', examDate: '2026-11-14',
      subjects: [
        { id: 'tax-law1',   name: '税法一' },
        { id: 'tax-law2',   name: '税法二' },
        { id: 'tax-practice', name: '涉税服务实务' },
        { id: 'tax-lawsvc', name: '涉税服务相关法律' },
        { id: 'tax-fa',     name: '财务与会计' }
      ]}
  ];
  function getExam(){ return store.get('cpa-exam') || 'cpa'; }
  function setExam(id){
    if(!EXAMS.some(e => e.id === id)) return;
    store.set('cpa-exam', id);
  }
  function currentExam(){ return EXAMS.find(e => e.id === getExam()) || EXAMS[0]; }
  // 科目是否有可用题库：以 /api/meta 返回的 hasData 为准
  function subjectMeta(id){ return subjects.find(s => s.id === id); }
  // 每题自带 verified 标志：带平台"正确答案"的题(第13/15/16关)可算真实对错；
  // 仅题干括号、无平台答案的题(第1-12关)仍待校验，正确率显示 —
  function isVerified(q){ return q.verified === true; }
  // 题型：客观题由系统自动判分；主观题需用户手动判分，不自动计入错题
  function isObjective(q){ return q && ['single','multi','multiple','judge'].includes(q.type); }
  function isSubjective(q){ return q && !isObjective(q); }
  // 错题判定：客观题自动判定；主观题仅当用户手动判为 wrong 时才计入错题
  // 错题/正确判定：以「历史所有练习会话中的最近一次作答」为准，
  // 这样错题训练、章节训练每次新开 session 都不会互相覆盖，且错题本可跨 session 累积。
  function isHistoricalWrong(q){
    if(!isVerified(q) || !isObjective(q)) return false;
    const ans = getLastAnswerFor(q._uid);
    return !!(ans && normAns(ans) !== normAns(q.answer));
  }
  // 该题是否曾在【已交卷】session 中出现过作答：错题/手动判分只认已交卷记录，
  // 未交卷（进行中）作答仅作记忆保存，不进错题、不影响历史统计。
  function hasSubmittedAnswer(uid){
    if(!uid) return false;
    const sessions = getSessions();
    for(let i = 0; i < sessions.length; i++){
      const s = sessions[i];
      if(s && s.submitted === true && s.answers && Object.prototype.hasOwnProperty.call(s.answers, uid)) return true;
    }
    return false;
  }
  function isManualWrong(q){ if(!q) return false; const uid = q._uid || q.uid; if(!hasSubmittedAnswer(uid)) return false; const g = getManualGrade(uid); return !!(g && g.state === 'wrong'); }
  function isWrong(q){ return isHistoricalWrong(q) || isManualWrong(q); }
  function isHistoricalCorrect(q){
    if(!isVerified(q) || !isObjective(q)) return false;
    const uid = q._uid || q.uid;
    const ans = getLastAnswerFor(uid);
    return !!(ans && normAns(ans) === normAns(q.answer));
  }
  function isManualCorrect(q){ if(!q) return false; const uid = q._uid || q.uid; if(!hasSubmittedAnswer(uid)) return false; const g = getManualGrade(uid); return !!(g && g.state === 'correct'); }
  function isCorrect(q){ return isHistoricalCorrect(q) || isManualCorrect(q); }

  // ===== 方案二（文件仓版）存储后端 =====
  // 服务器模式(http/https)：数据真落在 data/*.json，内存缓存优先、失败时回退 localStorage。
  // 文件模式(file://)：退化为原 localStorage 行为（bank_*.js 提供题库，store 即 localStorage）。
  const __SERVER_MODE__ = (location.protocol === 'http:' || location.protocol === 'https:');
  // 在线模式：配置了云端数据库（Supabase）时优先走云端，题库仍用本地 bank_*.js。
  // 未配置时 window.SupaStore / window.CloudStore 均不设置 → 本常量恒为 false，本地/server 模式完全不受影响。
  const __SUPABASE_MODE__ = !!(window.SupaStore && window.SupaStore.ready) || !!(window.CloudStore && window.CloudStore.ready);
  // key 前缀 → 文件（与 data/ 文件名对应；其余 key 视为全局设置，只走 localStorage）
  const __FILE_MAP__ = {
    'sessions_': 'history',
    'manual_grades_': 'wrong',
    'wrong_mastered_': 'wrong',
    'wrong_list_': 'wrong',
    'favorites_': 'favorites',
    'error_corrected_': 'error_corrected',
    'notes_': 'notes',
    'answers_': 'answers',
    'current_session_': 'drafts',
    'drafts_': 'drafts',
    'practice_state_': 'drafts',
    'motto_text': 'motto',
    'motto_history': 'motto',
  };
  function __fileOfKey__(k){
    for(const p in __FILE_MAP__){ if(k.indexOf(p) === 0) return __FILE_MAP__[p]; }
    return null;
  }
  // 旧版数据 key 用中文科目名做后缀（如 sessions_会计），新统一为科目 id（sessions_accounting）
  const SUBJ_NAME_TO_ID = { '会计':'accounting','审计':'auditing','财管':'finance','税法':'tax','经济法':'economics','战略':'strategy' };
  const __fileCache__ = { history:{}, wrong:{}, favorites:{}, error_corrected:{}, notes:{}, answers:{}, drafts:{}, motto:{} };
  let __dirty__ = {};
  let __flushTimer__ = null;
  function __flushAll__(keepalive){
    const files = Object.keys(__dirty__).filter(f => f !== 'drafts'); // drafts 仅本地，永不上传
    if(!files.length) return;
    if(__SUPABASE_MODE__){
      const subj = getSubject();
      const failed = [];
      const promises = files.map(f => {
        const saveSubj = (f === 'motto') ? 'global' : subj;
        return (window.SupaStore || window.CloudStore).saveFile(saveSubj, f, __fileCache__[f] || {})
          .catch(() => { failed.push(f); });
      });
      Promise.all(promises).then(() => {
        // 所有请求完成后，统一处理dirty：成功的清除，失败的保留
        files.forEach(f => {
          if(failed.includes(f)){
            __dirty__[f] = true; // 失败的保留，下次重试
          }else{
            delete __dirty__[f]; // 成功的清除
          }
        });
        if(failed.length){
          console.warn('[quiz] 云端写入失败，保留待重试:', failed);
          // 显示红色提示条
          try{
            let tip = document.getElementById('__save_fail_tip__');
            if(!tip){
              tip = document.createElement('div');
              tip.id = '__save_fail_tip__';
              tip.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#C03B2B;color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
              tip.title = '点击重试';
              document.body.appendChild(tip);
            }
            tip.textContent = '⚠ 数据未保存（' + failed.length + '个文件），点击重试';
            tip.onclick = () => { tip.remove(); __flushAll__(false); };
          }catch(e){}
        }
      });
      return;
    }
    const failed = [];
    const promises = files.map(f => {
      try{
        const body = JSON.stringify(__fileCache__[f] || {}, null, 2);
        const url = (f === 'motto') ? '/api/data/motto.json' : ('/api/data/' + getSubject() + '/' + f + '.json');
        return fetch(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body: body, keepalive: !!keepalive })
          .then(r => { if(!r.ok) failed.push(f); })
          .catch(() => { failed.push(f); });
      }catch(e){ failed.push(f); return Promise.resolve(); }
    });
    Promise.all(promises).then(() => {
      // 所有请求完成后，统一处理dirty：成功的清除，失败的保留
      files.forEach(f => {
        if(failed.includes(f)){
          __dirty__[f] = true; // 失败的保留，下次重试
        }else{
          delete __dirty__[f]; // 成功的清除
        }
      });
      if(failed.length){
        console.warn('[quiz] 写盘失败，保留待重试:', failed);
        // 显示提示
        try{
          let tip = document.getElementById('__save_fail_tip__');
          if(!tip){
            tip = document.createElement('div');
            tip.id = '__save_fail_tip__';
            tip.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#C03B2B;color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
            tip.title = '点击重试';
            document.body.appendChild(tip);
          }
          tip.textContent = '⚠ 数据未保存（' + failed.length + '个文件），点击重试';
          tip.onclick = () => { tip.remove(); __flushAll__(false); };
        }catch(e){}
      }
    });
  }
  function __scheduleFlush__(file){
    if(!__SERVER_MODE__) return; // 文件模式不写服务器
    // 未交卷暂存（drafts：正在做的题/草稿/进行中状态）仅存本地，不上传云端（省 KV 写配额、避免高频 PUT）
    if(file === 'drafts') return;
    __dirty__[file] = true;
    if(__flushTimer__) return;
    __flushTimer__ = setTimeout(() => { __flushTimer__ = null; __flushAll__(false); }, 400);
  }
  // 关页/切后台时强制 flush（keepalive 保证 unload 期间也能发出），避免 400ms 防抖期内丢失
  if(__SERVER_MODE__){
    window.addEventListener('beforeunload', () => __flushAll__(true));
    document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') __flushAll__(true); });
  }
  const store = (function(){
    let mem = {};
    let ok = true;
    try { window.localStorage.setItem('__t','1'); window.localStorage.removeItem('__t'); }
    catch(e){ ok = false; }
    function lsGet(k){ try { return ok ? window.localStorage.getItem(k) : (mem[k] ?? null); } catch(e){ return mem[k] ?? null; } }
    function lsSet(k,v){ try { if(ok) window.localStorage.setItem(k,v); else mem[k]=v; } catch(e){ mem[k]=v; } }
    function lsRemove(k){ try { if(ok) window.localStorage.removeItem(k); else delete mem[k]; } catch(e){ delete mem[k]; } }
    return {
      get(k){
        const f = __fileOfKey__(k);
        if(f && __fileCache__[f] && Object.prototype.hasOwnProperty.call(__fileCache__[f], k)){
          const val = __fileCache__[f][k];
          return (typeof val === 'string') ? val : JSON.stringify(val);
        }
        return lsGet(k);
      },
      set(k,v){
        const f = __fileOfKey__(k);
        if(f){
          try { __fileCache__[f][k] = JSON.parse(v); } catch(e){ __fileCache__[f][k] = v; }
          lsSet(k, v);
          __scheduleFlush__(f);
          return;
        }
        lsSet(k, v);
      },
      remove(k){
        const f = __fileOfKey__(k);
        if(f){
          delete __fileCache__[f][k];
          lsRemove(k);
          __scheduleFlush__(f);
          return;
        }
        lsRemove(k);
      }
    };
  })();
  function getSubject(){
    return store.get('cpa-subject') || 'accounting';
  }
  function setSubject(id){
    store.set('cpa-subject', id);
    location.reload();
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  // 富文本：换行 -> <br>；连续含制表符的行 -> 真实表格（首行作表头）
  function fmtRich(s){
    if(s == null) return '';
    const esc = escapeHtml(String(s));
    const lines = esc.split('\n');
    const out = [];
    let i = 0;
    const isBlank = l => l.replace(/\u00a0/g,' ').trim() === '';
    const hasTab = l => l.indexOf('\t') >= 0;
    while(i < lines.length){
      const line = lines[i];
      if(hasTab(line)){
        const block = [];
        // 收集含\t的行，允许中间夹空行（空行前后都有含\t的行时纳入）
        while(i < lines.length){
          if(hasTab(lines[i])){ block.push(lines[i]); i++; }
          else if(isBlank(lines[i])){
            // 向后看是否还有含\t的行
            let j = i + 1;
            while(j < lines.length && isBlank(lines[j])) j++;
            if(j < lines.length && hasTab(lines[j])){ block.push(lines[i]); i++; }
            else break;
          }
          else break;
        }
        const tabRows = block.filter(hasTab);
        if(tabRows.length >= 2){
          const rows = tabRows.map(r => r.split('\t').map(c => (c.replace(/\u00a0/g, ' ').trim() || '&nbsp;')));
          const ncol = Math.max.apply(null, rows.map(r => r.length));
          const html = rows.map((r, ri) => {
            while(r.length < ncol) r.push('&nbsp;');
            const tag = ri === 0 ? 'th' : 'td';
            return '<tr>' + r.map(c => '<' + tag + '>' + c + '</' + tag + '>').join('') + '</tr>';
          }).join('');
          out.push('<div class="q-tbl-wrap"><table class="q-tbl"><tbody>' + html + '</tbody></table></div>');
        } else {
          out.push('<span class="q-tbl">' + block[0] + '</span>');
        }
      } else {
        out.push(line);
        i++;
      }
    }
    return out.join('<br>');
  }
  // 题目显示号：主观多问大题 -> “26-1 / 26-2”；单题 -> 连续编号
  function qNo(q, idx){
    if(!q) return String((idx == null ? 0 : idx) + 1);
    // 仅在做题页面（practiceQuestions 已初始化且包含此题）使用题型内编号
    if(typeof practiceQuestions !== 'undefined' && Array.isArray(practiceQuestions) && practiceQuestions.indexOf(q) >= 0){
      const isSubj = q.type === 'subjective';
      const ptype = q.ptype || q.type;
      // 筛选同题型题目
      const typeList = practiceQuestions.filter(qq => {
        if(isSubj) return qq.type === 'subjective' && (qq.ptype || qq.type) === ptype;
        return qq.type === q.type;
      });
      if(isSubj && q.parentNo){
        // 主观题：大题号在当前题型内从1开始
        const parentNos = [];
        typeList.forEach(qq => { if(qq.parentNo && parentNos.indexOf(qq.parentNo) < 0) parentNos.push(qq.parentNo); });
        const parentIdx = parentNos.indexOf(q.parentNo) + 1;
        return q.subNo ? (parentIdx + '-' + q.subNo) : String(parentIdx);
      }
      // 客观题：题型内从1开始连续编号
      const typeIdx = typeList.indexOf(q) + 1;
      if(typeIdx > 0) return String(typeIdx);
    }
    // 回退：历史记录等其他场景
    if(q.parentNo) return q.subNo ? (q.parentNo + '-' + q.subNo) : String(q.parentNo);
    return String((idx == null ? 0 : idx) + 1);
  }
  // ---- 左栏 / 右栏可拖动调整宽度 + 各自可折叠（分条独立成列，内含折叠按钮） ----
  function makeSplitterElement(side){
    const sp = document.createElement('div');
    sp.className = 'v-splitter';
    sp.dataset.side = side;
    sp.title = side === 'left' ? '拖动调整左侧栏宽度' : '拖动调整右侧栏宽度';
    const btn = document.createElement('button');
    btn.className = 'col-toggle';
    btn.dataset.side = side;
    btn.type = 'button';
    btn.title = side === 'left' ? '隐藏左侧栏' : '隐藏右侧栏';
    // 收起态：左栏箭头朝左(«)，右栏箭头朝右(»)
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + (side === 'left' ? 'M14.5 6 8.5 12l6 6' : 'M9.5 6l6 6-6 6') + '"/></svg>';
    sp.appendChild(btn);
    sp.dataset.dragBound = '1';
    sp.addEventListener('mousedown', onSplitterDown);
    return sp;
  }
  // 给分隔条补绑拖拽（静态模板里的 .v-splitter 也需要；已绑定的跳过）
  function bindSplitterDrag(sp){
    if(!sp || sp.dataset.dragBound) return;
    sp.dataset.dragBound = '1';
    sp.addEventListener('mousedown', onSplitterDown);
  }
  // 响应式布局：窄屏自动折叠右栏，宽屏自动展开（用户手动折叠的不受影响）
  let __userManuallyToggledRight = false;
  function applyResponsiveLayout(){
    const shouldCollapse = window.innerWidth <= 1100;
    document.querySelectorAll('.cols').forEach(cols => {
      const isCollapsed = cols.classList.contains('right-collapsed');
      if(shouldCollapse && !isCollapsed && !__userManuallyToggledRight){
        cols.classList.add('right-collapsed');
        const btn = cols.querySelector('.v-splitter[data-side="right"] .col-toggle');
        if(btn){
          const path = btn.querySelector('svg path');
          if(path) path.setAttribute('d','M9 6l6 6-6 6');
          btn.title = '显示右侧栏';
        }
      } else if(!shouldCollapse && isCollapsed && !__userManuallyToggledRight){
        cols.classList.remove('right-collapsed');
        const btn = cols.querySelector('.v-splitter[data-side="right"] .col-toggle');
        if(btn){
          const path = btn.querySelector('svg path');
          if(path) path.setAttribute('d','M15 6l-6 6 6 6');
          btn.title = '隐藏右侧栏';
        }
      }
    });
  }
  function ensureSplitter(){
    // 只在答题卡页面(practice视图且非选卷模式)创建分隔条和折叠按钮
    if(getCurrentView() !== 'practice') return;
    const isSelectMode = /[?&]mode=select/.test(location.hash) || /[?&]mode=select/.test(location.search);
    if(isSelectMode) return;
    document.querySelectorAll('.cols').forEach(cols => {
      const right = cols.querySelector(':scope > .col-right');
      let sr = right && cols.querySelector(':scope > .v-splitter[data-side="right"]');
      if(right && !sr){ sr = makeSplitterElement('right'); right.before(sr); }
      bindSplitterDrag(sr);
    });
    applyResponsiveLayout();
  }
  // 窗口大小变化时自动调整布局（防抖150ms）
  let __resizeTimer = null;
  window.addEventListener('resize', () => {
    if(__resizeTimer) clearTimeout(__resizeTimer);
    __resizeTimer = setTimeout(applyResponsiveLayout, 150);
  });
  // 折叠/展开左栏或右栏；按钮图标随状态切换（栏隐藏后显示展开箭头）
  function toggleSidePanel(side){
    const cols = document.querySelector('.cols');
    if(!cols) return;
    const isLeft = side === 'left';
    const isMobile = window.innerWidth <= 767;
    // 手机端：悬浮层模式，切换 body 类
    if(isMobile){
      const bodyCls = isLeft ? 'mobile-show-left' : 'mobile-show-right';
      const otherCls = isLeft ? 'mobile-show-right' : 'mobile-show-left';
      const willShow = !document.body.classList.contains(bodyCls);
      document.body.classList.toggle(bodyCls, willShow);
      document.body.classList.remove(otherCls); // 同时只显示一个
      // 右侧悬浮层显示时，自动展开正确答案与解析（取消折叠）
      if(!isLeft && willShow && typeof rightCollapsed !== 'undefined' && typeof applyRightCollapsed === 'function'){
        rightCollapsed.ans = false;
        applyRightCollapsed();
      }
      return;
    }
    // 电脑端：原折叠逻辑
    const cls = isLeft ? 'left-collapsed' : 'right-collapsed';
    const willHide = !cols.classList.contains(cls);
    cols.classList.toggle(cls, willHide);
    if(isLeft) document.body.classList.toggle('left-collapsed', willHide);
    if(!isLeft) __userManuallyToggledRight = true;
    const btn = isLeft
      ? cols.querySelector('.col-toggle-mini')
      : cols.querySelector('.v-splitter[data-side="right"] .col-toggle');
    if(btn){
      const path = btn.querySelector('svg path');
      if(path){
        if(isLeft){ path.setAttribute('d', willHide ? 'M9.5 6l6 6-6 6' : 'M14.5 6 8.5 12l6 6'); }
        else      { path.setAttribute('d', willHide ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'); }
      }
      btn.title = willHide ? (isLeft ? '显示左侧栏' : '显示右侧栏') : (isLeft ? '隐藏左侧栏' : '隐藏右侧栏');
    }
  }
  // 动态更新左右栏折叠按钮的fixed位置（根据栏实际宽度）
  function updateTogglePositions(){
    const cols = document.querySelector('.cols');
    if(!cols) return;
    const leftBtn = cols.querySelector('.col-toggle-mini');
    const rightBtn = cols.querySelector('.v-splitter[data-side="right"] .col-toggle');
    const leftCollapsed = cols.classList.contains('left-collapsed');
    const rightCollapsed = cols.classList.contains('right-collapsed');
    if(leftBtn){
      if(leftCollapsed){
        leftBtn.style.left = '0px';
      } else {
        const colLeft = cols.querySelector('.col-left');
        const w = colLeft ? colLeft.offsetWidth : 252;
        leftBtn.style.left = w + 'px';
      }
    }
    if(rightBtn){
      if(rightCollapsed){
        rightBtn.style.right = '0px';
      } else {
        const colRight = cols.querySelector('.col-right');
        const w = colRight ? colRight.offsetWidth : 380;
        rightBtn.style.right = w + 'px';
      }
    }
  }
  // 左栏收起后的悬浮展开按钮（常驻 body，折叠时显示；左分隔条已移除）
  function ensureLeftToggleFloat(){
    if(document.getElementById('left-toggle-float')) return;
    const f = document.createElement('button');
    f.id = 'left-toggle-float';
    f.className = 'col-toggle left-toggle-float';
    f.dataset.side = 'left';
    f.type = 'button';
    f.title = '展开左侧栏';
    f.setAttribute('aria-label', '展开左侧栏');
    f.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>';
    document.body.appendChild(f);
  }
  function initSidePanelToggles(){
    document.addEventListener('click', e => {
      const btn = e.target.closest('.col-toggle, .left-toggle-float');
      if(btn) toggleSidePanel(btn.dataset.side === 'left' ? 'left' : 'right');
    });
    // 遮罩层点击收起悬浮层
    document.addEventListener('click', e => {
      if(e.target.classList.contains('mobile-overlay')){
        document.body.classList.remove('mobile-show-left', 'mobile-show-right');
      }
    });
    document.addEventListener('mousedown', e => {
      if(e.target.closest('.col-toggle')){ e.stopPropagation(); e.preventDefault(); }
    }, true);
  }
  function onSplitterDown(e){
    e.preventDefault();
    const sp = e.currentTarget;
    const side = sp.dataset.side || 'right';
    const cols = sp.closest('.cols');
    const rect = cols.getBoundingClientRect();
    const prop = side === 'left' ? '--left-w' : '--right-w';
    const cur = window.getComputedStyle(cols).getPropertyValue(prop).trim();
    const startW = cur ? parseFloat(cur) : (side === 'left' ? 210 : 380);
    const startX = e.clientX;
    function move(ev){
      let w, max;
      if(side === 'left'){
        w = startW + (startX - ev.clientX);   // 向左拖 => 左栏变宽
        const rwRaw = window.getComputedStyle(cols).getPropertyValue('--right-w').trim();
        const rw = rwRaw ? parseFloat(rwRaw) : 380;
        max = rect.width - rw - 240;          // 至少给中栏留 240
        w = Math.max(140, Math.min(w, max));
      } else {
        w = startW - (ev.clientX - startX);   // 向左拖 => 右栏变宽
        const lwRaw = window.getComputedStyle(cols).getPropertyValue('--left-w').trim();
        const lw = lwRaw ? parseFloat(lwRaw) : 210;
        max = rect.width - lw - 240;
        w = Math.max(260, Math.min(w, max));
      }
      cols.style.setProperty(prop, w + 'px');
    }
    function up(){
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing-split');
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.classList.add('resizing-split');
  }
  // 套卷取题：按 paperId 从对应题库取整套卷（冲刺模考用APP.papers，强化训练用BANK_INTENSIVE），赋予稳定 _uid 以便跨页作答同步
  // 简单 FNV-1a 哈希，用于生成稳定的题目ID（不依赖数组下标）
  function __qnHash__(s){
    s = String(s || '');
    let h = 0x811c9dc5;
    for(let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function getPaperQuestions(paperId){
    let paper = null;
    if(Array.isArray(APP.papers)) paper = APP.papers.find(p => p.id === paperId);
    if(!paper && window.BANK_INTENSIVE){
      const b = window.BANK_INTENSIVE;
      const s = __bankSubj__();
      const bank = (b[s] != null) ? b[s] : b;
      paper = (bank || []).find(p => p.id === paperId);
    }
    if(!paper) return [];
    const qs = (paper.questions || []).map((q, qi) => {
      const qhash = __qnHash__((q.stem || '') + '|' + JSON.stringify(q.options || {}));
      q._uid = 'paper:' + paperId + '::' + qhash;
      q.paper = paperId;
      q.chapter = paper.name;
      return q;
    });
    mergeGlobalAnswers(qs);
    return qs;
  }
  function getQuestions(){
    if(practicePaperId){
      const qs = getPaperQuestions(practicePaperId);
      return qs;
    }
    const qs = [];
    Object.values(APP.chapters || {}).forEach(ch => {
      Object.values(ch.sections || {}).forEach(sec => {
        (sec.questions || []).forEach((q, qi) => {
          // 稳定唯一标识（跨 4 页一致）：chapter||section||节内序号
          q._uid = (q.chapter || '') + '||' + (q.section || '') + '||' + qi;
          qs.push(q);
        });
      });
    });
    mergeGlobalAnswers(qs); // 做题页作答跨页同步
    return qs;
  }
  // 跨页作答同步：用做题页写入的全局作答覆盖各页内嵌 APP_DATA 写死的 user_answer（不动 answer/verified）
  function mergeGlobalAnswers(qs){
    let map = null;
    try{ const raw = store.get(globalAnswersKey()); if(raw) map = JSON.parse(raw); }catch(e){}
    if(!map) return;
    qs.forEach(q => {
      if(q._uid && Object.prototype.hasOwnProperty.call(map, q._uid)){
        q.user_answer = map[q._uid] || '';
      }
    });
  }
  function globalAnswersKey(){ return 'answers_' + getSubject(); }
  // 读取本软件实时作答（localStorage），用于章节「未开始/进行中/已完成」状态判定
  function getLiveAnswersMap(){
    try{ const raw = store.get(globalAnswersKey()); if(raw) return JSON.parse(raw) || {}; }catch(e){}
    return {};
  }
  function globalFavoritesKey(){ return 'favorites_' + getSubject(); }
  // 收藏结构：对象数组 {uid, chapter, section, type, raw_type, stem, options, answer, analysis, savedAt}
  // 兼容旧版：纯 uid 字符串数组（读取时自动从题库补全题目）
  function getFavorites(){
    try{
      const raw = store.get(globalFavoritesKey());
      if(raw){
        const arr = JSON.parse(raw);
        if(Array.isArray(arr)){
          const map = new Map();
          arr.forEach(item => {
            if(typeof item === 'string'){
              // 旧版 uid：从题库补全
              const q = getQuestions().find(x => x._uid === item);
              if(q) map.set(item, favSnap(q));
            } else if(item && item.uid){
              map.set(item.uid, item);
            }
          });
          return map;
        }
      }
    }catch(e){}
    return new Map();
  }
  function favSnap(q){
    return {
      uid: q._uid || '',
      chapter: q.chapter || '',
      section: q.section || '',
      type: q.type || '',
      raw_type: q.raw_type || '',
      stem: q.stem || '',
      options: q.options || [],
      answer: q.answer || '',
      analysis: q.analysis || '',
      savedAt: Date.now()
    };
  }
  function addFavorite(uid, q){
    const map = getFavorites();
    if(q && q._uid) map.set(q._uid, favSnap(q));
    else if(uid) map.set(uid, { uid, savedAt: Date.now() });
    try{ store.set(globalFavoritesKey(), JSON.stringify([...map.values()])); }catch(e){}
  }
  function removeFavorite(uid){ const map = getFavorites(); map.delete(uid); try{ store.set(globalFavoritesKey(), JSON.stringify([...map.values()])); }catch(e){} }
  function isFavorite(uid){ return getFavorites().has(uid); }

  // 纠错功能：全局保存，按科目单独存储
  function globalErrorCorrectedKey(){ return 'error_corrected_' + getSubject(); }
  // 纠错结构：对象数组 {uid, chapter, section, type, raw_type, stem, options, answer, analysis, savedAt}
  function getErrorCorrected(){
    try{
      const raw = store.get(globalErrorCorrectedKey());
      if(raw){
        const arr = JSON.parse(raw);
        if(Array.isArray(arr)){
          const map = new Map();
          arr.forEach(item => {
            if(typeof item === 'string'){
              const q = getQuestions().find(x => x._uid === item);
              if(q) map.set(item, errorSnap(q));
            } else if(item && item.uid){
              map.set(item.uid, item);
            }
          });
          return map;
        }
      }
    }catch(e){}
    return new Map();
  }
  function errorSnap(q){
    return {
      uid: q._uid || '',
      chapter: q.chapter || '',
      section: q.section || '',
      type: q.type || '',
      raw_type: q.raw_type || '',
      stem: q.stem || '',
      options: q.options || [],
      answer: q.answer || '',
      analysis: q.analysis || '',
      savedAt: Date.now()
    };
  }
  function addErrorCorrected(uid, q){
    const map = getErrorCorrected();
    if(q && q._uid) map.set(q._uid, errorSnap(q));
    else if(uid) map.set(uid, { uid, savedAt: Date.now() });
    try{ store.set(globalErrorCorrectedKey(), JSON.stringify([...map.values()])); }catch(e){}
  }
  function removeErrorCorrected(uid){ const map = getErrorCorrected(); map.delete(uid); try{ store.set(globalErrorCorrectedKey(), JSON.stringify([...map.values()])); }catch(e){} }
  function isErrorCorrected(uid){ return getErrorCorrected().has(uid); }

  // 主观题手动判分存储：{ [uid]: { state:'correct'|'wrong', score:number } }
  function manualGradesKey(){ return 'manual_grades_' + getSubject(); }
  let __manualGradesCache__ = null;
  function getManualGrades(){
    if(__manualGradesCache__ !== null) return __manualGradesCache__;
    try{ const raw = store.get(manualGradesKey()); if(raw){ const obj = JSON.parse(raw); if(obj && typeof obj === 'object'){ __manualGradesCache__ = obj; return obj; } } }catch(e){}
    __manualGradesCache__ = {};
    return {};
  }
  function __invalidateManualGradesCache__(){ __manualGradesCache__ = null; }
  function saveManualGrades(obj){ try{ store.set(manualGradesKey(), JSON.stringify(obj || {})); }catch(e){} }
  function getManualGrade(uid){ return getManualGrades()[uid] || null; }
  function setManualGrade(uid, state, score){
    const obj = getManualGrades();
    if(!uid) return;
    if(state === 'correct' || state === 'wrong'){
      obj[uid] = { state, score: Number(score) || 0 };
    } else {
      delete obj[uid];
    }
    saveManualGrades(obj);
    __invalidateManualGradesCache__();
  }
  function clearManualGrade(uid){ const obj = getManualGrades(); delete obj[uid]; saveManualGrades(obj); __invalidateManualGradesCache__(); }

  // ============ 练习历史 Session 管理 ============
  // 每个训练都是一个独立 session：当前进行中的答案存在 answers_${subject}，
  // 已交卷的历史 session 存在 sessions_${subject}。错题判定看所有 session 的最近作答。
  function currentSessionKey(){ return 'current_session_' + getSubject(); }
  function sessionsKey(){ return 'sessions_' + getSubject(); }
  function getSessions(){
    try{ const raw = store.get(sessionsKey()); if(raw){ const arr = JSON.parse(raw); if(Array.isArray(arr)) return arr; } }catch(e){ console.warn('[quiz] 练习历史读取失败:', e); }
    return [];
  }
  function saveSessions(arr){ try{ store.set(sessionsKey(), JSON.stringify(arr || [])); }catch(e){ console.warn('[quiz] 练习历史写入失败:', e); } __invalidateHistAnswersCache__(); }
  function getCurrentSession(){
    try{ const raw = store.get(currentSessionKey()); if(raw){ const s = JSON.parse(raw); if(s && typeof s === 'object') return s; } }catch(e){}
    return null;
  }
  function setCurrentSession(sess){ try{ store.set(currentSessionKey(), JSON.stringify(sess || {})); }catch(e){} }
  function archiveCurrentSession(){
    const sess = getCurrentSession();
    if(!sess) return;
    // 保留session自己的answers（submitPaper已设置），不再用全局池覆盖
    if(!sess.answers) sess.answers = {};
    sess.endTime = Date.now();
    const arr = getSessions();
    const idx = arr.findIndex(x => x.id === sess.id);
    if(idx >= 0) arr[idx] = sess; else arr.push(sess);
    saveSessions(arr);
  }
  function newSession(mode, chapter, section){
    return {
      id: 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      mode: mode || 'chapter',
      chapter: chapter || '',
      section: section || '',
      startTime: Date.now(),
      endTime: null,
      elapsed: 0,
      submitted: false,
      answers: {}
    };
  }
  function ensureSession(mode, chapter, section){
    const cur = getCurrentSession();
    // 同范围判定：章节按「章+节」；冲刺模考/强化套卷按「套卷名」；其余模式（错题随机/机考）不续做
    const sameScope = (mode === 'chapter') ? (cur && cur.chapter === chapter && cur.section === section)
                    : (mode === 'paper')   ? (cur && cur.chapter === chapter)
                    : false;
    const matched = cur && !cur.submitted && cur.mode === mode && sameScope;
    if(matched) return cur; // 续做同节/同套卷未交卷训练
    // 已交卷的【章节】session：保留 practice_state（含 submitted）与全局收藏，交给 loadState / enterReviewMode 恢复解析态，
    // 避免刷新/重开已交卷章节时丢失解析（否则 stateKey 被清，退化成全新练习）。
    // 已交卷的【套卷】不在此返回：重开即从零开始新卷，避免旧作答残留进做题页。
    if(cur && cur.submitted && cur.mode === mode && sameScope && mode === 'chapter') return cur;
    // 异节 / 全新 / 已交卷套卷重开：先归档旧作答，再清空当前实时答案与本节状态，从零开始
    if(cur && Object.keys(cur.answers || {}).length) archiveCurrentSession();
    const sess = newSession(mode, chapter, section);
    setCurrentSession(sess);
    // 清空当前实时答案 + 本节旧状态，让新训练从零开始（历史作答不覆盖、不预填）
    try{ store.set(globalAnswersKey(), JSON.stringify({})); }catch(e){}
    try{ store.remove(stateKey()); }catch(e){}
    return sess;
  }
  // 合并所有【已交卷】session 的答案，返回 { [uid]: 最近一次作答 }
  // 口径：只统计已交卷训练（sessions_ 中 submitted=true）；未交卷/进行中作答不计入，
  // 与「只有交卷才生成练习历史」的规则保持一致。
  let __histAnswersCache__ = null;
  function getHistoricalAnswersMap(){
    if(__histAnswersCache__ !== null) return __histAnswersCache__;
    const all = [];
    getSessions().forEach(s => {
      if(s.submitted === true && s.answers && typeof s.answers === 'object') all.push({ t: s.endTime || s.startTime, m: s.answers });
    });
    // 按时间顺序合并，后面的覆盖前面的
    all.sort((a, b) => a.t - b.t);
    const map = {};
    all.forEach(it => { Object.keys(it.m).forEach(uid => { map[uid] = it.m[uid]; }); });
    __histAnswersCache__ = map;
    return map;
  }
  function __invalidateHistAnswersCache__(){ __histAnswersCache__ = null; }
  function getLastAnswerFor(uid){
    const map = getHistoricalAnswersMap();
    return uid ? (map[uid] || '') : '';
  }

  // 一次性清理：清空现存所有「未交卷」状态（未交卷 current session / 进行中的节状态 / 实时作答池）。
  // 由 DOMContentLoaded 首次调用一次（标志位 cpa_cleared_orphan_v1），仅清一次；
  // 不删除已交卷 session 与其 practice_state（submitted=true），已交卷统计与解析态恢复不受影响。
  function clearOrphanStateOnce(){
    try{
      if(store.get('cpa_cleared_orphan_v1')) return;
      // 1) 未交卷的当前 session
      const cur = getCurrentSession();
      if(cur && cur.submitted !== true){ store.remove(currentSessionKey()); }
      // 2) 所有「进行中未交卷」的节状态 practice_state_*（已交卷的保留）
      let hasLS = false;
      try{ hasLS = !!(window.localStorage && typeof window.localStorage.length === 'number'); }catch(e){ hasLS = false; }
      if(hasLS){
        const prefix = 'practice_state_';
        const del = [];
        for(let i = 0; i < window.localStorage.length; i++){
          const k = window.localStorage.key(i);
          if(k && k.indexOf(prefix) === 0){
            let remove = true;
            try{ const raw = store.get(k); if(raw){ const st = JSON.parse(raw); remove = st.submitted !== true; } }catch(e){}
            if(remove) del.push(k);
          }
        }
        del.forEach(k => store.remove(k));
      }
      // 3) 全局实时作答池（未交卷临时作答全部清空；已交卷作答已归档进 sessions，不受影响）
      store.remove(globalAnswersKey());
      store.set('cpa_cleared_orphan_v1', '1');
    }catch(e){}
  }

  // 作答草稿（思考过程）存储：{ [uid]: string }，跨页、跨会话持久化
  function draftKey(){ return 'drafts_' + getSubject(); }
  function getDrafts(){
    try{ const raw = store.get(draftKey()); if(raw){ const obj = JSON.parse(raw); if(obj && typeof obj === 'object') return obj; } }catch(e){}
    return {};
  }
  function getDraft(uid){ const m = getDrafts(); return (uid && m[uid]) ? m[uid] : ''; }
  function setDraft(uid, text){
    if(!uid) return;
    const m = getDrafts();
    if(text && String(text).trim()) m[uid] = String(text); else delete m[uid];
    try{ store.set(draftKey(), JSON.stringify(m)); }catch(e){}
  }

  function getTypeLabel(type, ptype){
    if(type === 'subjective'){
      if(ptype === 'calc') return '计算分析题';
      if(ptype === 'comp') return '综合题';
      return '计算分析题 / 综合题';
    }
    return type === 'single' ? '单项选择题' : type === 'multi' ? '多项选择题' : type === 'judge' ? '判断题' :
           type === 'analysis' ? '分析题' : type === 'comprehensive' ? '综合题' : type || '其他题型';
  }
  function countType(qs, type){ return qs.filter(q => q.type === type).length; }

  // ============ 6 科目主题配色（已统一为锤子系统红色系，v2 原型标准） ============
  // 各科目保留同一套锤子红值：品牌红 #C03B2B / 深红 #8A2818，与全局 :root 一致
  const THEMES = {
    accounting: { primary:'#C03B2B', primaryStrong:'#9E2F20', primaryLight:'#E2573D', primarySoft:'#F7E6E2', secondary:'#B43222', secondaryStrong:'#8A2818', secondaryLight:'#D9A79C', secondarySoft:'#F4E0DA' },
    auditing:   { primary:'#C03B2B', primaryStrong:'#9E2F20', primaryLight:'#E2573D', primarySoft:'#F7E6E2', secondary:'#B43222', secondaryStrong:'#8A2818', secondaryLight:'#D9A79C', secondarySoft:'#F4E0DA' },
    finance:    { primary:'#C03B2B', primaryStrong:'#9E2F20', primaryLight:'#E2573D', primarySoft:'#F7E6E2', secondary:'#B43222', secondaryStrong:'#8A2818', secondaryLight:'#D9A79C', secondarySoft:'#F4E0DA' },
    tax:        { primary:'#C03B2B', primaryStrong:'#9E2F20', primaryLight:'#E2573D', primarySoft:'#F7E6E2', secondary:'#B43222', secondaryStrong:'#8A2818', secondaryLight:'#D9A79C', secondarySoft:'#F4E0DA' },
    economics:  { primary:'#C03B2B', primaryStrong:'#9E2F20', primaryLight:'#E2573D', primarySoft:'#F7E6E2', secondary:'#B43222', secondaryStrong:'#8A2818', secondaryLight:'#D9A79C', secondarySoft:'#F4E0DA' },
    strategy:   { primary:'#C03B2B', primaryStrong:'#9E2F20', primaryLight:'#E2573D', primarySoft:'#F7E6E2', secondary:'#B43222', secondaryStrong:'#8A2818', secondaryLight:'#D9A79C', secondarySoft:'#F4E0DA' }
  };
  // 把插画里写死的青/蓝色值映射到当前主题的 CSS 变量，实现整页换肤
  const SVG_HEX_MAP = {
    '#1FD5C5':'--color-primary','#6FE3D6':'--color-primary-light','#0D9488':'--color-primary-strong',
    '#0F766E':'--color-primary-strong','#17B8AB':'--color-primary-light','#CFF6F1':'--color-primary-soft',
    '#DFFAF6':'--color-primary-soft','#E4EEFD':'--color-secondary-soft','#DCE9FC':'--color-secondary-soft',
    '#93C0EA':'--color-primary-soft','#CFFAF4':'--color-primary-soft',
    '#3B7FE8':'--color-secondary','#7FAFF0':'--color-secondary-light','#2160BE':'--color-secondary-strong',
    '#1C55A8':'--color-secondary-strong','#4386D2':'--color-secondary','#3A76BE':'--color-secondary',
    '#B6D6F5':'--color-secondary-light','#A3C7EE':'--color-secondary-light','#2E79CE':'--color-secondary',
    '#3070C9':'--color-secondary','#A9CBEC':'--color-secondary-light','#96BBE2':'--color-secondary-light',
    '#2261B8':'--color-secondary-strong','#2A73D4':'--color-secondary-strong','#4B95E2':'--color-secondary',
    '#3F80CB':'--color-secondary'
  };
  function applyTheme(subjectId){
    const t = THEMES[subjectId] || THEMES.accounting;
    const root = document.documentElement.style;
    root.setProperty('--color-primary', t.primary);
    root.setProperty('--color-primary-strong', t.primaryStrong);
    root.setProperty('--color-primary-accent', t.primaryStrong);
    root.setProperty('--color-primary-deep', t.primaryStrong);
    root.setProperty('--color-primary-light', t.primaryLight);
    root.setProperty('--color-primary-soft', t.primarySoft);
    root.setProperty('--color-secondary', t.secondary);
    root.setProperty('--color-secondary-strong', t.secondaryStrong);
    root.setProperty('--color-secondary-deep', t.secondaryStrong);
    root.setProperty('--color-secondary-light', t.secondaryLight);
    root.setProperty('--color-secondary-soft', t.secondarySoft);
    root.setProperty('--gradient-brand', `linear-gradient(135deg, ${t.primary} 0%, ${t.secondary} 100%)`);
    root.setProperty('--gradient-brand-deep', `linear-gradient(115deg, ${t.primaryStrong} 0%, ${t.secondaryStrong} 100%)`);
    root.setProperty('--gradient-brand-soft', `linear-gradient(135deg, ${t.primarySoft} 0%, ${t.secondarySoft} 100%)`);
    themeSVGs();
  }
  function themeSVGs(){
    document.querySelectorAll('[stop-color],[fill],[stroke]').forEach(el => {
      ['stop-color','fill','stroke'].forEach(attr => {
        const v = (el.getAttribute(attr) || '').trim();
        const varName = SVG_HEX_MAP[v];
        if(varName) el.style.setProperty(attr, `var(${varName})`);
      });
    });
  }

  // 动态样式
  const style = document.createElement('style');
  style.textContent = `
    .subject-switcher-wrap{display:flex;align-items:center;gap:4px;cursor:pointer}
    #subject-select{background:transparent;border:none;color:inherit;font-size:12px;cursor:pointer;font-weight:600;outline:none;max-width:90px;-webkit-appearance:none;-moz-appearance:none;appearance:none;padding-right:0}
    .subject-empty{text-align:center;padding:80px 24px;color:var(--color-text-secondary)}
    .subject-empty h3{font-size:20px;margin-bottom:12px;color:var(--color-text-primary);font-weight:600}
    .subject-empty code{background:var(--color-surface-muted);padding:2px 6px;border-radius:4px;font-size:12px}
    .no-source-tag{display:inline-flex;align-items:center;height:16px;padding:0 5px;border-radius:4px;background:var(--color-surface-muted);color:var(--color-text-secondary);font-size:10px;font-weight:500;vertical-align:middle;margin-left:4px;border:1px solid var(--color-border)}
    .no-source-val{color:var(--color-text-secondary);font-weight:500}
  `;
  document.head.appendChild(style);

  // 考试倒计时：按当前考试模块的 examDate 计算，各考试互不影响
  function getCountdownDays(examDate){
    if(!examDate) return null;
    const exam = new Date(examDate + 'T00:00:00');
    if(isNaN(exam.getTime())) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = exam - today;
    return Math.max(0, Math.ceil(diff / (1000*60*60*24)));
  }

  // ===== 学习中心增强（v2 移植）：每日励志语录（可编辑 · 历史带日期） =====
  const DEFAULT_MOTTO = '今天也把错题变成得分。';
  function zesc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function mottoText(){ return store.get('motto_text') || DEFAULT_MOTTO; }
  function mottoHistory(){ try{ const a = JSON.parse(store.get('motto_history') || '[]'); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
  function todayStr(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function mottoSave(text){
    text = (text || '').trim(); if(!text) return;
    store.set('motto_text', text);
    const now = todayStr();
    const arr = mottoHistory();
    const idx = arr.findIndex(x => x && x.text === text);
    if(idx >= 0){
      arr[idx].usedAt = now;
      if(!arr[idx].createdAt) arr[idx].createdAt = now;
      arr[idx].updatedAt = now;
    } else {
      arr.unshift({ text: text, usedAt: now, createdAt: now, updatedAt: now });
    }
    arr.length = Math.min(arr.length, 20);
    store.set('motto_history', JSON.stringify(arr));
    const el = document.getElementById('motto-txt'); if(el) el.textContent = text;
    renderMottoHist();
  }
  function mottoDelete(text){
    store.set('motto_history', JSON.stringify(mottoHistory().filter(x => x && x.text !== text)));
    renderMottoHist();
  }
  function renderMottoHist(){
    const box = document.getElementById('motto-hist'); if(!box) return;
    const arr = mottoHistory().filter(x => x && x.text !== DEFAULT_MOTTO);
    if(!arr.length){ box.innerHTML = '<div class="mh-empty">还没有保存过的语录，输入一句点「保存」即可记录（含使用日期）</div>'; return; }
    box.innerHTML = arr.map(o => `<div class="hitem" data-text="${zesc(o.text)}"><span class="d">${zesc(o.usedAt || '')}</span><span class="t">${zesc(o.text)}</span><button class="del" title="从历史中删除">✕</button></div>`).join('');
  }
  // ===== 学习中心增强：考试日期（可手动调整，v2 移植） =====
  function getExamDatesOverride(){ try{ return JSON.parse(store.get('exam_dates_override') || '{}') || {}; }catch(e){ return {}; } }
  function getExamDateOf(ex){ const o = getExamDatesOverride(); return o && o[ex.id] ? o[ex.id] : ex.examDate; }
  function saveExamDatesUI(){
    document.querySelectorAll('#date-pop input[type=date]').forEach(inp => {
      if(inp.value){ const o = getExamDatesOverride(); o[inp.dataset.ex] = inp.value; store.set('exam_dates_override', JSON.stringify(o)); }
    });
    closeLcPops();
    renderLearnCenter(); renderCountdown();
  }
  function closeLcPops(){ ['motto-pop','date-pop'].forEach(id => { const p = document.getElementById(id); if(p) p.classList.remove('show'); }); }
  // 弹层挂到 body 上（避免被 topnav overflow 裁剪），按触发点浮动定位
  function ensureLcPop(id){
    let p = document.getElementById(id);
    if(p) return p;
    p = document.createElement('div');
    p.id = id;
    p.className = id;
    if(id === 'motto-pop'){
      p.innerHTML = '<h4>每日励志语录</h4><div class="in-row"><input id="motto-input" maxlength="50" placeholder="写一句今天的自我激励…"/><button class="ok-btn" id="lc-motto-save">保存</button></div><div class="hist" id="motto-hist"></div>';
      document.body.appendChild(p);
      const ms = document.getElementById('lc-motto-save');
      if(ms) ms.addEventListener('click', () => { const inp = document.getElementById('motto-input'); if(inp) mottoSave(inp.value); });
      const hist = document.getElementById('motto-hist');
      if(hist) hist.addEventListener('click', e => {
        const row = e.target.closest('.hitem'); if(!row) return;
        if(e.target.closest('.del')) mottoDelete(row.getAttribute('data-text'));
        else mottoSave(row.getAttribute('data-text'));
      });
    } else {
      p.innerHTML = '<h4 id="date-pop-title">考试日期</h4>'
        + '<div class="date-row"><input type="date" id="date-single-input"></div>'
        + '<div class="ops"><button class="lc-save" id="lc-date-save">确认</button></div>';
      document.body.appendChild(p);
      const sd = document.getElementById('lc-date-save');
      if(sd) sd.addEventListener('click', saveExamDatesUI);
    }
    return p;
  }
  function toggleLcPop(id, anchor){
    const p = ensureLcPop(id);
    const was = p.classList.contains('show');
    closeLcPops();
    if(was) return;
    p.classList.add('show');
    if(id === 'motto-pop'){
      const inp = p.querySelector('input');
      if(inp){ inp.value = mottoText() === DEFAULT_MOTTO ? '' : mottoText(); inp.focus(); }
      renderMottoHist();
    } else {
      const exId = anchor ? anchor.getAttribute('data-exam') : null;
      const ex = (EXAMS || []).find(e => e.id === exId) || (EXAMS || [])[0];
      const title = p.querySelector('#date-pop-title');
      if(title) title.textContent = ex.name + ' · 考试日期';
      const inp = p.querySelector('#date-single-input');
      if(inp){ inp.dataset.ex = ex.id; inp.value = getExamDateOf(ex); }
    }
    const r = anchor.getBoundingClientRect();
    const pw = id === 'motto-pop' ? 340 : 360;
    let left = r.left;
    if(left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
    p.style.left = Math.max(10, left) + 'px';
    let top = r.bottom + 8;
    if(top + p.offsetHeight > window.innerHeight - 10) top = Math.max(10, r.top - p.offsetHeight - 8);
    p.style.top = top + 'px';
  }
  document.addEventListener('click', e => {
    if(e.target.closest('.motto-pop') || e.target.closest('.date-pop')
      || e.target.closest('.motto-edit') || e.target.closest('.date-chip') || e.target.closest('.tn-countdown')) return;
    closeLcPops();
  });
  function bindLearnCenterUI(){
    const me = document.getElementById('motto-edit');
    if(me && !me.dataset.bound){ me.dataset.bound = '1'; me.addEventListener('click', () => { toggleLcPop('motto-pop', me); }); }
    document.querySelectorAll('.date-chip').forEach(chip => {
      if(!chip.dataset.bound){ chip.dataset.bound = '1'; chip.addEventListener('click', e => { e.stopPropagation(); toggleLcPop('date-pop', chip); }); }
    });
    const mt = document.getElementById('motto-txt');
    if(mt && mt.textContent !== mottoText()) mt.textContent = mottoText();
  }

  // 科目切换入口（已改为「学习中心选择科目」：左上角仅显示当前考试模块·科目，点击回学习中心）
  function initSubjectSwitch(){
    const el = document.getElementById('subject-switcher');
    if(!el) return;
    const ex = currentExam();
    let subName = '';
    const cur = getSubject();
    const meta = subjectMeta(cur);
    if(meta && meta.name){
      subName = meta.name;
    } else {
      const first = (ex.subjects && ex.subjects[0]) ? ex.subjects[0].name : '';
      subName = first || '未选择科目';
    }
    el.innerHTML = `<a href="#dashboard" title="在学习中心切换考试模块与科目">${ex.short} · ${subName}</a>`;
  }

  function showEmpty(){
    const page = document.querySelector('.page');
    if(!page) return;
    const sub = subjects.find(s => s.id === getSubject());
    const subName = sub?.name || '当前科目';
    page.innerHTML = `<div class="subject-empty"><h3>《${subName}》暂无题目数据</h3><p>题目统一从 <code>E:\\Obsidian仓库\\会计考试\\知识库\\电子资料\\题刷刷\\注会-${subName}</code> 读取。</p><p>请在该目录下添加章节题目（Markdown 题库或 questions_* 文件）后刷新页面。</p></div>`;
    const tnSub = document.getElementById('tn-sub');
    if(tnSub) tnSub.textContent = '暂无题目数据 · 待补充';
  }

  // ============ 学习中心（模块 + 科目入口） ============
  function renderLearnCenter(){
    const modCont = document.getElementById('lc-modules');
    const subCont = document.getElementById('lc-subjects');
    if(!modCont || !subCont) return;
    const cur = currentExam();
    const sn = document.getElementById('subj-name');
    if(sn) sn.textContent = cur.name;
    // 模块卡（v2：等大卡片 + 顶部色条 + 图标 + 名称 + 选中「已选」+ 卡内倒计时/考试日期）
    const colors = { cpa:'#C0392B', mid:'#B8860B', taxp:'#2F8F6B' };
    let wrongCount = 0;
    try{ wrongCount = getQuestions().filter(q => isWrong(q)).length; }catch(e){}
    modCont.innerHTML = EXAMS.map(ex => {
      const active = ex.id === cur.id ? ' active' : '';
      const c = colors[ex.id] || '#C03B2B';
      const days = getCountdownDays(getExamDateOf(ex));
      const date = getExamDateOf(ex);
      return `<div class="mod-card${active}" data-exam="${ex.id}">
        <div class="topline" style="background:${c}"></div>
        <h3><span class="ic" style="background:${c}">${zesc(ex.icon || ex.short)}</span><span class="name">${zesc(ex.name)}</span><span class="cnt">· ${(ex.subjects || []).length}科</span></h3>
        <div class="meta"><span class="chip">距考试 <b>${days}</b> 天</span><span class="chip date-chip" data-exam="${ex.id}" title="点击调整考试日期">考试日期 ${date}</span></div>
      </div>`;
    }).join('');
    modCont.querySelectorAll('.mod-card[data-exam]').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-exam');
        if(id !== getExam()){ setExam(id); renderLearnCenter(); renderCountdown(); }
      });
    });
    // 科目卡（v2：双字图标 + 名称 + 箭头；无可用题库时置灰不可点）
    if(cur.subjects && cur.subjects.length){
      const cs = { cpa:['#9E2F20','#7A5C9E','#A8752B','#3E5C8A','#2F6B4F','#8A5A2B'], mid:['#9A6B14','#B0652B','#3E5C8A'], taxp:['#2F8F6B','#A8752B','#3E5C8A','#7A5C9E','#9E2F20'] }[cur.id] || ['#C03B2B'];
      subCont.innerHTML = cur.subjects.map((s, i) => {
        const meta = subjectMeta(s.id);
        const has = !!(meta && meta.hasData);
        return `<div class="sub-card${has ? '' : ' disabled'}" data-subject="${s.id}" data-has="${has ? 1 : 0}">
          <span class="ic2" style="background:${cs[i % cs.length]};${has ? '' : 'opacity:.5'}">${zesc(s.name.slice(0,2))}</span>
          <div class="hd">
            <h3 style="${has ? '' : 'color:var(--color-text-secondary)'}">${zesc(s.name)}</h3>
            ${has ? '' : '<span class="tag-wip">待建设</span>'}
          </div>
          <span class="arr" style="${has ? '' : 'visibility:hidden'}">›</span>
        </div>`;
      }).join('');
      subCont.querySelectorAll('.sub-card[data-subject]').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-subject');
          const meta = subjectMeta(id);
          if(!(meta && meta.hasData)) return;
          location.hash = '#chapter';
          setSubject(id); // setSubject 内部会 reload，reload 后停留在 #chapter
        });
      });
    } else {
      subCont.innerHTML = `<div class="lc-empty">
        <div class="lc-empty-ico">🚧</div>
        <h3>《${cur.name}》题库建设中</h3>
        <p>该考试模块的章节题库正在整理，上线后将在此处选择科目开始刷题。</p>
      </div>`;
    }
    bindLearnCenterUI();
  }

  // ============ 小小红书（语录笔记本）：语录明细卡片流 ============
  function renderRedBook(){
    const stats = document.getElementById('rb-stats');
    const cur = document.getElementById('rb-current');
    const grid = document.getElementById('rb-grid');
    if(cur) cur.textContent = mottoText();
    const list = mottoHistory().filter(x => x && x.text);
    if(stats){
      const u = list.map(x => x.usedAt).filter(Boolean);
      stats.innerHTML = '<span>累计收录 <b>' + list.length + '</b> 条</span><span>最近使用 <b>' + zesc(u[0] || '—') + '</b></span>';
    }
    if(!grid) return;
    const TRASH = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>';
    grid.innerHTML = '<div class="rb-list-card">'
      + list.slice().sort((a,b) => String(a.createdAt || a.usedAt || '').localeCompare(String(b.createdAt || b.usedAt || ''))).map((o, i) => {
        const isCur = o.text === mottoText();
        const date = o.createdAt || o.usedAt || '—';
        return '<div class="rb-row' + (isCur ? ' cur' : '') + '">'
          + '<span class="rb-row-no">' + (i + 1) + '.</span>'
          + '<label class="rb-check" title="勾选即选用为当前语录"><input type="checkbox"' + (isCur ? ' checked' : '') + ' data-t="' + zesc(o.text) + '"></label>'
          + '<p class="rb-row-txt">' + zesc(o.text) + '</p>'
          + '<span class="rb-row-date">' + zesc(date) + '</span>'
          + '<button class="rb-row-edit" data-t="' + zesc(o.text) + '" type="button" title="修改语录">✎</button>'
          + '<button class="rb-row-del" data-t="' + zesc(o.text) + '" type="button" title="删除语录">' + TRASH + '</button>'
          + '</div>';
      }).join('')
      + '<div class="rb-row rb-newrow"><span class="rb-new-space"></span><div class="rb-new-box"><span class="rb-new-plus">＋</span><input class="rb-new-input" type="text" maxlength="50"></div><button class="rb-new-save" type="button" title="保存新增语录">✓</button></div>'
      + '</div>';
    grid.querySelectorAll('.rb-check input').forEach(cb => cb.addEventListener('change', () => {
      if(cb.checked){ mottoSave(cb.getAttribute('data-t')); renderRedBook(); }
    }));
    grid.querySelectorAll('.rb-row-del').forEach(b => b.addEventListener('click', () => { mottoDelete(b.getAttribute('data-t')); renderRedBook(); }));
    // 修改：点击 ✎ 后该行语录原地变为输入框，回车/失焦即保存（不弹窗）
    grid.querySelectorAll('.rb-row-edit').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = b.closest('.rb-row');
      const txt = row.querySelector('.rb-row-txt');
      if(!txt) return;
      const old = b.getAttribute('data-t');
      const inp = document.createElement('input');
      inp.type = 'text'; inp.maxLength = 50; inp.className = 'rb-row-input'; inp.value = old;
      txt.replaceWith(inp);
      inp.focus();
      let done = false;
      function commit(){
        if(done) return; done = true;
        const val = inp.value.trim();
        if(val && val !== old){ mottoDelete(old); mottoSave(val); }
        renderRedBook();
      }
      inp.addEventListener('keydown', ev => { if(ev.key === 'Enter') commit(); else if(ev.key === 'Escape') renderRedBook(); });
      inp.addEventListener('blur', commit);
    }));
    // 底部空行新增语录：＋号居中占位，回车或点「保存」新增后自动再生成空行
    const newRow = grid.querySelector('.rb-newrow');
    if(newRow){
      const ni = newRow.querySelector('.rb-new-input');
      const plus = newRow.querySelector('.rb-new-plus');
      const save = newRow.querySelector('.rb-new-save');
      function syncPlus(){ if(plus) plus.style.visibility = ni.value ? 'hidden' : 'visible'; }
      if(ni) ni.addEventListener('input', syncPlus);
      function addNew(){
        const v = ni.value.trim();
        if(v){ mottoSave(v); renderRedBook(); }
      }
      if(ni) ni.addEventListener('keydown', ev => { if(ev.key === 'Enter') addNew(); });
      if(save) save.addEventListener('click', addNew);
    }
  }

  // ============ Dashboard（保留，历史视图未再使用） ============
  function renderDashboard(){
    const tnSub = document.getElementById('tn-sub');
    const phSub = document.getElementById('ph-sub');
    const recPanel = document.getElementById('rec-panel');
    const asGrid = document.getElementById('as-grid');
    const asTip = document.getElementById('as-tip');
    const m1 = document.getElementById('stage-meta-1');
    const m2 = document.getElementById('stage-meta-2');
    const m3 = document.getElementById('stage-meta-3');
    if(!tnSub && !recPanel) return; // 仅 dashboard 页执行
    const qs = getQuestions();
    const chCount = Object.keys(APP.chapters || {}).length;
    const total = qs.length;
    const totalDone = qs.filter(q => q.user_answer || q.practiced || getLastAnswerFor(q._uid)).length;
    const wrongCount = qs.filter(q => isWrong(q)).length;
    const realDone = qs.filter(q => isVerified(q) && getLastAnswerFor(q._uid)).length;
    const subjName = APP.subject || '当前科目';
    if(tnSub) tnSub.textContent = `全书 ${chCount} 章 · ${total} 题 · 基础阶段`;
    const wrongText = realDone ? `<b>${wrongCount}</b>` : '待校验';
    if(phSub) phSub.innerHTML = `《${subjName}》共 <b class="num">${total}</b> 道真题 · 已练习 <b>${totalDone}</b> · 已判分 <b>${realDone}</b> · 错题 ${wrongText} · ${totalDone ? '继续复盘' : '开始你的第一刷'}`;
    if(m1) m1.innerHTML = `<span>教材章节 <b>${chCount}</b> 章</span><span>已做 <b>0</b></span>`;
    if(m2) m2.innerHTML = `<span>错题随机训练</span><span>${wrongCount > 0 ? wrongCount + ' 题' : '暂无错题'}</span>`;
    if(m3) m3.innerHTML = '<span>全真模考</span><span>' + EXAM_COUNT + ' 题 · 60 分钟</span>';
    // 三阶段大卡进度条归零（无真实进度数据）
    document.querySelectorAll('.stage-card .bar i').forEach(el => el.style.width = '0%');
    if(recPanel){
      recPanel.innerHTML = `
        <a class="rec" href="#"><div class="rec-ico"><svg viewBox="0 0 24 24"><rect x="5" y="4.2" width="14" height="16.6" rx="2"/><path d="M9.4 4.2V3h5.2v1.2"/><path d="M8.8 12.4l2 2 4.4-4.4"/></svg></div><div><div class="rec-l">累计做题</div><div class="rec-v">${totalDone}<small>题</small></div></div><span class="rec-arrow">›</span></a>
        <a class="rec" href="#"><div class="rec-ico"><svg viewBox="0 0 24 24"><path d="M6.4 4.2h11.2v16.4L12 16.4l-5.6 4.2z"/></svg></div><div><div class="rec-l">收藏题目</div><div class="rec-v">0<small>题</small></div></div><span class="rec-arrow">›</span></a>
        <a class="rec" href="#"><div class="rec-ico"><svg viewBox="0 0 24 24"><path d="M4.4 19.6h4L18.2 9.8l-4-4L4.4 15.6z"/><path d="M14.2 5.8 18.2 9.8"/></svg></div><div><div class="rec-l">学习笔记</div><div class="rec-v">—</div></div><span class="rec-arrow">›</span></a>
        <a class="rec" href="#"><div class="rec-ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.8"/><path d="M12 7.2V12l3.4 2"/></svg></div><div><div class="rec-l">累计学习时长</div><div class="rec-v">—</div></div><span class="rec-arrow">›</span></a>
        <a class="rec" href="#"><div class="rec-ico"><svg viewBox="0 0 24 24"><rect x="4" y="5.2" width="16" height="15.2" rx="2"/><path d="M8.4 3.4v3.6M15.6 3.4v3.6M4 10.4h16"/><path d="M9.4 14.6l1.9 1.9 3.4-3.4"/></svg></div><div><div class="rec-l">连续打卡</div><div class="rec-v">—</div></div><span class="rec-arrow">›</span></a>
        <a class="rec" href="#wrong"><div class="rec-ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1"/></svg></div><div><div class="rec-l">错题本 · 待复习</div><div class="rec-v">${wrongCount === null ? '待校验' : wrongCount + '<small>题</small>'}</div></div><span class="rec-arrow">›</span></a>`;
    }
    if(asGrid){
      const vDone = qs.filter(q => isVerified(q) && getLastAnswerFor(q._uid)).length;
      const vCorrect = qs.filter(q => isVerified(q) && getLastAnswerFor(q._uid) && isCorrect(q)).length;
      const realRate = vDone ? (vCorrect / vDone * 100) : null;
      asGrid.innerHTML = `
        <div class="stat"><div class="stat-l"><span class="d" style="background:var(--color-secondary)"></span>预估分</div><div class="stat-num">—<span class="u">/ 100</span></div><div class="stat-foot"><span class="chip chip-up">已练习</span><span>已练 ${totalDone} 题</span></div></div>
        <div class="stat"><div class="stat-l"><span class="d" style="background:var(--color-primary)"></span>知识点掌握度</div><div class="stat-num">—<span class="u">%</span></div><div class="mini-bar"><i style="width:0%;background:var(--gradient-brand)"></i></div><div class="stat-foot"><span class="chip chip-up">已练习</span><span>已练 ${totalDone} / ${total} 题</span></div></div>
        <div class="stat"><div class="stat-l"><span class="d" style="background:var(--color-success)"></span>做题正确率</div><div class="stat-num">${realRate !== null ? realRate.toFixed(1) : '—'}<span class="u">%</span></div><div class="mini-bar"><i style="width:${realRate !== null ? realRate : 0}%;background:var(--color-success)"></i></div><div class="stat-foot"><span class="chip chip-down">—</span><span>仅记录完成度</span></div></div>`;
    }
    if(asTip && asTip.querySelector('p')) asTip.querySelector('p').innerHTML = `本周建议：先刷完《${subjName}》的 <b>${total}</b> 道真题，建立第一手错题本，再针对性复盘易错点。`;
  }

  // ============ Chapter Practice ============
  let chapterFilterState = 'all'; // 章节训练页分段筛选：all / not_started / done / has_wrong
  let historyModeFilter = 'all';  // 练习历史页模式筛选：all / chapter / wrong_random / imported
  let historyDateFilter = 'today'; // 练习历史页日期筛选：today / all
  function renderChapters(){
    const list = document.querySelector('.ch-list');
    if(!list) return;
    const qs = getQuestions();
    if(!qs.length){ list.innerHTML = '<div class="subject-empty"><h3>暂无章节数据</h3></div>'; return; }

    // 关卡状态判定（用户规则）：
    //   - 该关存在【已交卷】历史（含导入归档）→ 视为「已完成」，即使交卷时未做满全部题目
    //   - 该关存在【未交卷】进行中（current_session 未交卷）→ 显示「继续做题」（续做）
    //   - 都没有 → 「开始做题」
    const submittedScopes = new Set();
    const ongoingScopes = new Set();
    getSessions().forEach(s => {
      if(s.submitted === true && s.chapter && s.section) submittedScopes.add(s.chapter + '||' + s.section);
    });
    const cur = getCurrentSession();
    if(cur && cur.submitted !== true && cur.chapter && cur.section) ongoingScopes.add(cur.chapter + '||' + cur.section);

    function calcProgress(chTitle, secTitle, sec){
      // 章节进度/正确率/有错题统一以【已交卷历史】的最近作答为准（不含未交卷/进行中作答），
      // 配合「只有交卷才生成历史」的规则：刷过的关要交卷才会累计进度，未交卷不积累。
      const scope = chTitle + '||' + secTitle;
      const hasSubmitted = submittedScopes.has(scope);
      const hasOngoing = ongoingScopes.has(scope);
      const questions = sec.questions || [];
      const realTotal = questions.length;
      const isEmpty = realTotal === 0;
      let done = 0, vDone = 0, vCorrect = 0, hasWrong = false;
      questions.forEach(q => {
        const uid = q._uid;
        const eff = getLastAnswerFor(uid);
        if(eff && String(eff).trim()){
          done++;
          if(isVerified(q)){
            vDone++;
            const ok = isObjective(q) ? (eff.toUpperCase() === String(q.answer || '').toUpperCase()) : false;
            if(ok) vCorrect++;
            if(isObjective(q) && !ok) hasWrong = true;
          }
        }
        const g = getManualGrade(uid);
        if(isWrong(q)) hasWrong = true;
      });
      return {
        total: realTotal,
        done: done,
        realDone: done,
        correct: vCorrect,
        accuracy: vDone ? (vCorrect / vDone * 100) : null,
        vDone, vCorrect, isEmpty, hasWrong, hasSubmitted, hasOngoing
      };
    }
    function starRating(accuracy, done){
      if(!done) return '☆☆☆';
      if(accuracy === null) return '☆☆☆'; // 已练习但正确率未知
      if(accuracy < 30) return '★☆☆';
      if(accuracy < 70) return '★★☆';
      return '★★★';
    }

    const filter = chapterFilterState || 'all';

    let html = '';
    let chIdx = 0;
    Object.entries(APP.chapters || {}).forEach(([chTitle, ch], ci) => {
      const allSections = Object.entries(ch.sections || {});
      // 预计算每个关卡的进度，并按当前筛选条件过滤（空关仅在「全部章节」下展示）
      const infos = allSections.map(([secTitle, sec]) => ({ secTitle, sec, prog: calcProgress(chTitle, secTitle, sec) }));
      const visible = filter === 'all'
        ? infos
        : infos.filter(it => !it.prog.isEmpty && (
            filter === 'not_started' ? (!it.prog.hasSubmitted && !it.prog.hasOngoing) :
            filter === 'done'        ? (it.prog.total > 0 && it.prog.hasSubmitted) :
            filter === 'has_wrong'   ? (it.prog.hasWrong) :
            true
          ));
      if(filter !== 'all' && visible.length === 0) return; // 整章无匹配关卡 → 跳过

      chIdx++;
      let chRealTotal = 0, chDoneDisplay = 0, chRealDone = 0, chRealCorrect = 0, chVDone = 0, chVCorrect = 0;
      let subHtml = '';
      visible.forEach(({ secTitle, sec, prog }) => {
        const { total, done, realDone, correct, accuracy, vDone, vCorrect, isEmpty, hasWrong, hasSubmitted, hasOngoing } = prog;
        // 章节头汇总只统计可见（非空）关卡，避免空关的导入进度放大数字
        chRealTotal += total; chDoneDisplay += done; chRealDone += realDone; chRealCorrect += correct; chVDone += vDone; chVCorrect += vCorrect;
        const pct = total ? Math.round(done / total * 100) : 0;
        // 空关：没有实际题目数据，不点亮星级，按钮置灰
        const stars = isEmpty ? '☆☆☆' : starRating(accuracy, done);
        const secName = escapeHtml(secTitle.replace(/^第\d+关\s*/,''));
        const secIdx = (secTitle.match(/^第(\d+)关/) || [,0])[1];
        // 状态仅作为背景信息，不再显示操作按钮与有错题标签：点击关卡卡片直接进入练习
        const isDone = !isEmpty && hasSubmitted;
        const href = isEmpty ? '#' : `题刷刷.html?chapter=${encodeURIComponent(chTitle)}&section=${encodeURIComponent(secTitle)}#practice`;
        const clickAttr = isEmpty ? '' : ` onclick="location.href='${href}'" style="cursor:pointer"`;
        subHtml += `
          <div class="sub ${isEmpty ? 'empty' : ''} ${isDone ? 'done' : ''}"${clickAttr}>
            <span class="sub-idx">${secIdx}</span>
            <span class="sub-stars" title="正确率 ${done ? (accuracy === null ? '—' : accuracy.toFixed(1)) : '—'}%">${stars}</span>
            <div class="sub-name"><div class="t">${secName}</div></div>
            <div class="sub-progress">
              <span class="sub-progress-text">进度：${done}/${total}</span>
              <div class="progress-bar"><i style="width:${pct}%"></i></div>
              <span class="sub-percent">${pct}%</span>
            </div>
          </div>
        `;
      });
      const chHasAccuracy = chVDone > 0;
      const chAccuracy = chHasAccuracy ? (chVCorrect / chVDone * 100) : null;
      const chPct = chRealTotal ? Math.round(chDoneDisplay / chRealTotal * 100) : 0;
      // 章级状态：整章所有非空关都已交卷 = 已完成；有部分已交卷或有未交卷进行中 = 进行中；否则未开始
      const anyNonEmpty = visible.some(it => !it.prog.isEmpty);
      const chDoneAll = anyNonEmpty && visible.every(it => it.prog.isEmpty || it.prog.hasSubmitted);
      const chAnyOngoing = visible.some(it => it.prog.hasOngoing);
      const chActive = chDoneDisplay > 0 || chAnyOngoing;
      const chTagText = chDoneAll ? '已完成' : (chActive ? '进行中' : '未开始');
      const chTagCls = chDoneAll ? 'tag-green' : (chActive ? 'tag-teal' : 'tag-gray');
      const rateVal = chHasAccuracy ? chAccuracy.toFixed(1) + '%' : '—';
      const rateColor = chHasAccuracy ? 'var(--color-success-text)' : (chDoneDisplay ? 'var(--color-primary-strong)' : 'var(--color-text-secondary)');
      const ringBg = chHasAccuracy ? 'var(--color-success)' : (chDoneDisplay ? 'var(--color-primary)' : '#E6E8EB');
      const chOpen = (filter !== 'all') ? true : (chIdx === 1); // 筛选态下默认展开首章，方便查看过滤结果
      html += `
        <div class="ch-item ${chOpen ? 'open' : ''} ${chDoneAll ? 'done' : ''}" id="ch${chIdx}">
          <button class="ch-head" onclick="toggleCh('ch${chIdx}')">
            <div class="ch-num">${String(chIdx).padStart(2,'0')}</div>
            <div class="ch-main">
              <div class="ch-title">${escapeHtml(chTitle)} <span class="tag tag-gray">基础</span></div>
              <div class="ch-meta">
                <span>共 <b>${chRealTotal}</b> 题</span><span class="vline"></span>
                <span>已做 <b>${chDoneDisplay}</b></span><span class="vline"></span>
                <span>正确率 <b>${rateVal}</b></span>
              </div>
            </div>
            <div class="ch-rate"><div class="v" style="color:${rateColor}">${rateVal}</div><div class="l">正确率</div></div>
            <div class="ring" style="background:conic-gradient(${ringBg} 0% ${chPct}%,#F1F5F9 0)"><span style="color:${rateColor}">${chPct}%</span></div>
            <div class="ch-cta"><span class="tag ${chTagCls}">${chTagText}</span><span class="caret"><svg viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6"/></svg></span></div>
          </button>
          <div class="ch-panel">${subHtml}</div>
        </div>
      `;
    });
    if(!html && filter !== 'all'){
      const tipMap = { not_started: '当前没有「未开始」的有题章节，试试「全部章节」吧。', done: '当前没有已完成的章节，继续加油。', has_wrong: '恭喜，当前没有带错题的章节。' };
      list.innerHTML = '<div class="subject-empty"><h3>暂无匹配章节</h3><p>' + escapeHtml(tipMap[filter] || '当前筛选下没有符合条件的章节。') + '</p></div>';
    } else {
      list.innerHTML = html;
    }

    // 同步工具条与底部统计（始终基于整本书，不随筛选变化）
    let totalSections = 0, totalQuestions = 0;
    Object.values(APP.chapters || {}).forEach(ch => {
      totalSections += Object.keys(ch.sections || {}).length;
      Object.values(ch.sections || {}).forEach(sec => totalQuestions += sec.questions.length);
    });
    const summary = document.getElementById('ch-summary');
    if(summary) summary.textContent = `共 ${Object.keys(APP.chapters || {}).length} 章 · ${totalSections} 关 · ${totalQuestions} 题`;
    const tbar = document.getElementById('toolbar-count');
    if(tbar) tbar.innerHTML = `共 <b>${Object.keys(APP.chapters || {}).length}</b> 章 · <b>${totalQuestions}</b> 题`;

    // 绑定分段筛选：点击后切换 chapterFilterState 并真实重渲染（不再只是改样式）
    const seg = document.getElementById('ch-seg');
    if(seg && !seg.dataset.bound){
      seg.dataset.bound = '1';
      seg.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          chapterFilterState = b.getAttribute('data-filter') || 'all';
          seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
          b.classList.add('on');
          renderChapters();
        });
      });
    }
  }

  // ============ 章节页搜索：匹配文字加重高亮并跳转到所在行 ============
  function clearChapterSearch(){
    document.querySelectorAll('.ch-search-hl').forEach(el => el.classList.remove('ch-search-hl'));
    document.querySelectorAll('mark.ch-search-mark').forEach(m => {
      const p = m.parentNode;
      if(p){ p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); }
    });
  }
  function markText(el, kw){
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while(walker.nextNode()){ if(walker.currentNode.textContent.indexOf(kw) > -1) nodes.push(walker.currentNode); }
    nodes.forEach(node => {
      const idx = node.textContent.indexOf(kw);
      if(idx === -1) return;
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(node.textContent.slice(0, idx)));
      const m = document.createElement('mark'); m.className = 'ch-search-mark'; m.textContent = node.textContent.slice(idx, idx + kw.length);
      frag.appendChild(m);
      frag.appendChild(document.createTextNode(node.textContent.slice(idx + kw.length)));
      node.parentNode.replaceChild(frag, node);
    });
  }
  function searchChapters(kw){
    clearChapterSearch();
    if(!kw) return;
    const list = document.querySelector('.ch-list');
    if(!list) return;
    let first = null;
    list.querySelectorAll('.ch-item').forEach(item => {
      let hit = false;
      const title = item.querySelector('.ch-title');
      if(title && title.textContent.indexOf(kw) > -1){ hit = true; markText(title, kw); }
      item.querySelectorAll('.sub-name .t').forEach(t => { if(t.textContent.indexOf(kw) > -1){ hit = true; markText(t, kw); } });
      if(hit){ item.classList.add('ch-search-hl'); if(!first) first = item; }
    });
    if(first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function initChapterSearch(){
    const box = document.getElementById('tb-search');
    if(!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    box.addEventListener('input', () => searchChapters(box.value.trim()));
    box.addEventListener('keydown', e => { if(e.key === 'Escape'){ box.value = ''; searchChapters(''); box.blur(); } });
  }

  // ============ 通用页面搜索（错题/收藏/历史/笔记/冲刺模考） ============
  function clearPageSearch(){
    document.querySelectorAll('.page-search-hl').forEach(el => el.classList.remove('page-search-hl'));
    document.querySelectorAll('mark.page-search-mark').forEach(m => {
      const p = m.parentNode;
      if(p){ p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); }
    });
  }
  function markPageText(el, kw){
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while(walker.nextNode()){ if(walker.currentNode.textContent.indexOf(kw) > -1) nodes.push(walker.currentNode); }
    nodes.forEach(node => {
      const idx = node.textContent.indexOf(kw);
      if(idx === -1) return;
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(node.textContent.slice(0, idx)));
      const m = document.createElement('mark'); m.className = 'page-search-mark'; m.textContent = node.textContent.slice(idx, idx + kw.length);
      frag.appendChild(m);
      frag.appendChild(document.createTextNode(node.textContent.slice(idx + kw.length)));
      node.parentNode.replaceChild(frag, node);
    });
  }
  function searchPageRows(kw, containerSel, rowSel){
    clearPageSearch();
    if(!kw) return;
    const c = document.querySelector(containerSel);
    if(!c) return;
    let first = null;
    c.querySelectorAll(rowSel).forEach(row => {
      if(row.textContent.indexOf(kw) > -1){
        row.classList.add('page-search-hl');
        markPageText(row, kw);
        if(!first) first = row;
      }
    });
    if(first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function bindPageSearch(boxId, containerSel, rowSel){
    const box = document.getElementById(boxId);
    if(!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    box.addEventListener('input', () => searchPageRows(box.value.trim(), containerSel, rowSel));
    box.addEventListener('keydown', e => { if(e.key === 'Escape'){ box.value = ''; searchPageRows('', containerSel, rowSel); box.blur(); } });
  }
  function initAllPageSearch(){
    bindPageSearch('tb-search-wrong', '#wq-list', '.wq');
    bindPageSearch('tb-search-fav', '#fav-list', '.wq');
    bindPageSearch('tb-search-history', '#history-page', '.hist-row-card');
    bindPageSearch('tb-search-note', '#note-list', '.note-card');
  }
  function initAllSearch(){
    initChapterSearch();
    initAllPageSearch();
  }
  document.addEventListener('DOMContentLoaded', () => { setTimeout(initAllSearch, 200); });
  window.addEventListener('hashchange', () => { setTimeout(initAllSearch, 200); });
  document.addEventListener('click', () => { setTimeout(initAllSearch, 120); });

  // ============ 倒计时 / 面包屑 / 阶段条 / 侧边栏统计 ============
  function renderCountdown(){
    const ex = currentExam();
    const date = getExamDateOf(ex);
    const days = getCountdownDays(date);
    // 通用倒计时胶囊（侧栏/做题页等）
    document.querySelectorAll('.cd-mini .cd-num, #tn-cd-num').forEach(el => el.textContent = days);
    // 学习中心右上角：显示当前考试日期 + 倒计时
    const cdLabel = document.querySelector('.tn-countdown .cd-label');
    if(cdLabel) cdLabel.textContent = `考试日期 ${date}`;
    const cdNum = document.querySelector('.tn-countdown .cd-num');
    if(cdNum && cdNum !== document.getElementById('tn-cd-num')) cdNum.textContent = days;
  }

  // 科目简称（按考试模块），用于顶部导航"CPA·会计"等
  const SUBJ_SHORT = {
    cpa: { accounting:'会计', auditing:'审计', finance:'财管', tax:'税法', economics:'经济', strategy:'战略' },
    mid: { 'mid-practice':'实务', 'mid-finance':'财管', 'mid-econ':'经济' },
    taxp: { 'tax-law1':'税一', 'tax-law2':'税二', 'tax-practice':'实务', 'tax-lawsvc':'法律', 'tax-fa':'财会' }
  };
  function subjectLabel(){
    const ex = currentExam() || EXAMS[0];
    const map = SUBJ_SHORT[ex.id] || {};
    const s = getSubject();
    const short = map[s] || s;
    return (ex.short || ex.id) + '·' + short;
  }
  function renderBreadcrumbs(){
    const label = subjectLabel();
    document.querySelectorAll('#crumb-subj').forEach(el => { if(el) el.textContent = label; });
    const sb = document.getElementById('sb-subj'); if(sb) sb.textContent = label;
    const chCount = Object.keys(APP.chapters || {}).length;
    const stat = '全书 ' + chCount + ' 章';
    const el = document.getElementById('crumb-subject');
    if(el) el.textContent = stat;
    const tn = document.getElementById('tn-title');
    if(tn) tn.textContent = '学习中心 / ' + label + ' / 练习历史';
    const tnSub = document.getElementById('tn-sub');
    if(tn && tnSub) tnSub.textContent = stat;
  }

  function renderStageBar(){
    const bar = document.querySelector('.stage-bar');
    if(!bar) return;
    const qs = getQuestions();
    const chCount = Object.keys(APP.chapters || {}).length;
    const answered = qs.filter(q => getLastAnswerFor(q._uid));
    const doneCount = answered.length;
    const strengthened = new Set(answered.map(q => q.chapter)).size;
    const correct = answered.filter(q => isVerified(q) && isCorrect(q));
    const vAnswered = answered.filter(q => isVerified(q));
    const accuracy = vAnswered.length ? (correct.length / vAnswered.length * 100).toFixed(1) : null;

    const m1 = document.getElementById('stage-metric-strengthened');
    const m2 = document.getElementById('stage-metric-done');
    const m3 = document.getElementById('stage-metric-accuracy');
    const track = document.getElementById('stage-track');
    if(m1) m1.querySelector('.v').innerHTML = `${strengthened}<small>/ ${chCount}</small>`;
    if(m2) m2.querySelector('.v').innerHTML = `${doneCount}<small>题</small>`;
    if(m3 && accuracy !== null){
      m3.querySelector('.v').innerHTML = `${accuracy}<small>%</small>`;
      const tag = m3.querySelector('.no-source-tag');
      if(tag) tag.remove();
    }
    if(track && chCount) track.querySelector('i').style.width = `${(strengthened / chCount * 100).toFixed(1)}%`;
  }

  function renderSidebarStats(){
    // 侧边栏「我的错题」数量角标已移除
  }

  // ============ Wrong Questions ============
  const WRONG_PAGE_SIZE = 10;
  let wrongPageState = { filter: 'all', page: 1 };

  function wrongMasteredKey(){ return 'wrong_mastered_' + getSubject(); }
  function getMasteredSet(){
    try{ const raw = store.get(wrongMasteredKey()); if(raw){ const arr = JSON.parse(raw); if(Array.isArray(arr)) return new Set(arr); } }catch(e){}
    return new Set();
  }
  function saveMasteredSet(set){
    try{ store.set(wrongMasteredKey(), JSON.stringify([...set])); }catch(e){}
  }
  function toggleMastered(uid){
    const set = getMasteredSet();
    if(set.has(uid)) set.delete(uid); else set.add(uid);
    saveMasteredSet(set);
    renderWrongQuestions();
  }

  function renderWrongCard(q, idx){
    const uid = q._uid || q.uid;
    const mastered = !!(q.mastered || getMasteredSet().has(uid));
    const lastAns = q.lastAnswer || getLastAnswerFor(uid);
    const practiced = !!(q.wrongCount || q.practiced);
    const manualWrong = isManualWrong(q);
    const statusTag = mastered ? '<span class="tag tag-green">已掌握</span>' : (practiced ? '<span class="tag tag-teal">待复习</span>' : '<span class="tag tag-red">未掌握</span>');
    const opts = (q.options ? Object.entries(q.options) : []).map(([k, v]) => {
      const isRight = q.answer && q.answer.toUpperCase().indexOf(k.toUpperCase()) >= 0;
      const isPick = String(lastAns || '').toUpperCase().indexOf(k.toUpperCase()) >= 0;
      let cls = '', mk = '';
      if(isRight){ cls = 'is-right'; mk = '<em class="mk mk-green">正确答案</em>'; }
      else if(isPick){ cls = 'is-wrong'; mk = '<em class="mk mk-red">你的答案</em>'; }
      return '<li class="'+cls+'"><span class="k">'+k+'</span><span>'+fmtRich(v)+'</span>'+mk+'</li>';
    }).join('');
    const wrongLabel = manualWrong ? '<span class="tag tag-orange" style="margin-left:8px">手动判错</span>' : '';
    const wrongCountTag = q.wrongCount ? '<span class="wq-src" style="margin-left:6px">错'+q.wrongCount+'次</span>' : '';
    const analysisHtml = q.analysis ? '<details class="wq-exp"><summary>查看解析</summary><div class="exp-body">'+fmtRich(q.analysis)+'</div></details>' : (q.tag ? '<details class="wq-exp"><summary>查看解析</summary><div class="exp-body"><p>'+escapeHtml(q.tag)+'</p></div></details>' : '');
    const draftText = getDraft(uid);
    const draftHtml = '<details class="wq-exp wq-draft" open><summary><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>作答草稿</summary><div class="body"><textarea class="wq-draft-ta" data-uid="'+escapeHtml(uid)+'" rows="3" placeholder="记录你的思考，保存后同步到做题页…">'+escapeHtml(draftText)+'</textarea><div class="wq-draft-actions"><button class="btn btn-sm btn-primary wq-draft-save" type="button">保存</button><span class="wq-draft-msg"></span></div></div></details>';
    return `
      <article class="wq" data-uid="${escapeHtml(uid)}">
        <div class="wq-head">
          <span class="wq-idx">${String(idx+1).padStart(2,'0')}</span>
          <span class="tag tag-gray">${getTypeLabel(q.type)}</span>
          <span class="wq-src">${escapeHtml(q.chapter)} · <b>${escapeHtml(q.section)}</b></span>
          <div class="sp">
            ${statusTag}${wrongLabel}${wrongCountTag}
            <span class="wq-src">${practiced ? '已练习' : '未练习'}</span>
          </div>
        </div>
        <p class="wq-stem">${fmtRich(q.stem)}</p>
        ${opts ? '<ul class="wq-opts">'+opts+'</ul>' : ''}
        <div class="ans-line">
          <span class="b">正确答案 <strong style="color:var(--color-success-text)">${q.answer || '—'}</strong></span>
          <span class="vline"></span>
          <span class="b">你的答案 <strong style="color:var(--color-danger-text)">${lastAns || '—'}</strong></span>
        </div>
        ${draftHtml}
        ${analysisHtml}
        <div class="wq-act">
          <a class="btn btn-ghost btn-sm" href="题刷刷.html?chapter=${encodeURIComponent(q.chapter)}&section=${encodeURIComponent(q.section)}#practice">重做本题</a>
          <button class="btn btn-quiet btn-sm btn-master">${mastered ? '取消已掌握' : '标记已掌握'}</button>
          <span class="rate">${mastered ? '已掌握' : (practiced ? '待复习' : '未掌握')}</span>
        </div>
      </article>
    `;
  }
  // 错题卡作答草稿：保存按钮（事件委托，动态渲染卡片也生效；保存后同步到 drafts，做题页/复盘可见）
  document.addEventListener('click', function(e){
    const btn = e.target.closest('.wq-draft-save');
    if(!btn) return;
    const box = btn.closest('.wq-draft');
    if(!box) return;
    const ta = box.querySelector('.wq-draft-ta');
    if(!ta) return;
    setDraft(ta.dataset.uid, ta.value);
    const msg = box.querySelector('.wq-draft-msg');
    if(msg){ msg.textContent = '已保存'; msg.classList.add('ok'); setTimeout(function(){ msg.textContent=''; msg.classList.remove('ok'); }, 1600); }
  });
  function renderWrongPager(total, totalPages){
    const pager = document.getElementById('wq-pager');
    if(!pager) return;
    if(totalPages <= 1){ pager.innerHTML = '<span style="font-size:12px;color:var(--color-text-secondary)">每页 ' + WRONG_PAGE_SIZE + ' 题</span>'; return; }
    let html = '<button class="pg" data-page="prev" ' + (wrongPageState.page <= 1 ? 'disabled style="opacity:.5;cursor:not-allowed"' : '') + '>&lsaquo;</button>';
    for(let i = 1; i <= totalPages; i++){
      if(i === 1 || i === totalPages || (i >= wrongPageState.page - 1 && i <= wrongPageState.page + 1)){
        html += `<button class="pg ${i === wrongPageState.page ? 'on' : ''}" data-page="${i}">${i}</button>`;
      } else if(i === wrongPageState.page - 2 || i === wrongPageState.page + 2){
        html += '<button class="pg" disabled style="opacity:.5;cursor:default">…</button>';
      }
    }
    html += '<button class="pg" data-page="next" ' + (wrongPageState.page >= totalPages ? 'disabled style="opacity:.5;cursor:not-allowed"' : '') + '>&rsaquo;</button>';
    html += '<span style="margin-left:8px">每页 ' + WRONG_PAGE_SIZE + ' 题</span>';
    pager.innerHTML = html;
    pager.querySelectorAll('.pg[data-page]').forEach(b => {
      b.addEventListener('click', () => {
        if(b.disabled) return;
        const p = b.getAttribute('data-page');
        if(p === 'prev') wrongPageState.page--;
        else if(p === 'next') wrongPageState.page++;
        else wrongPageState.page = parseInt(p, 10);
        renderWrongQuestions();
      });
    });
  }

  function updateWrongSummary(all, filtered){
    const mastered = getMasteredSet();
    const mCount = all.filter(w => w.mastered || mastered.has(w.uid || w._uid)).length;
    const pCount = all.filter(w => !(w.mastered || mastered.has(w.uid || w._uid)) && (w.wrongCount || w.practiced)).length;
    const uCount = all.filter(w => !(w.mastered || mastered.has(w.uid || w._uid)) && !(w.wrongCount || w.practiced)).length;
    const total = all.length;
    const setCount = (id, n) => { const el = document.getElementById(id); if(el) el.innerHTML = n + '<small>题</small>'; };
    setCount('wq-total', total);
    setCount('wq-unmastered', uCount);
    setCount('wq-pending', pCount);
    setCount('wq-mastered', mCount);
    setCount('wq-today', pCount);
    const redoRate = document.getElementById('wq-redo-rate');
    if(redoRate) redoRate.innerHTML = '—<small>%</small>';
    const from = filtered.length ? ((wrongPageState.page - 1) * WRONG_PAGE_SIZE + 1) : 0;
    const to = Math.min(wrongPageState.page * WRONG_PAGE_SIZE, filtered.length);
    const cnt = document.getElementById('wq-count');
    if(cnt) cnt.textContent = filtered.length;
    const fromEl = document.getElementById('wq-from');
    const toEl = document.getElementById('wq-to');
    if(fromEl) fromEl.textContent = from;
    if(toEl) toEl.textContent = to;
  }

  function getWrongList(){
    try{
      const raw = store.get('wrong_list_' + getSubject());
      if(raw){
        const arr = JSON.parse(raw);
        if(Array.isArray(arr) && arr.length) return arr;
      }
    }catch(e){}
    // 回退：从题库+历史派生旧版错题
    return getQuestions().filter(q => isWrong(q)).map(q => ({
      uid: q._uid, chapter: q.chapter, section: q.section, type: q.type,
      raw_type: q.raw_type, stem: q.stem, options: q.options,
      answer: q.answer, analysis: q.analysis, lastAnswer: getLastAnswerFor(q._uid),
      wrongCount: 1, lastWrongTime: 0, mastered: getMasteredSet().has(q._uid)
    }));
  }
  function renderWrongQuestions(){
    const list = document.getElementById('wq-list');
    if(!list) return;
    let all = getWrongList();
    const masteredSet = getMasteredSet();
    // 同步 mastered 状态
    all = all.map(w => ({ ...w, mastered: w.mastered || masteredSet.has(w.uid) }));

    let filtered = all;
    if(wrongPageState.filter === 'unmastered') filtered = all.filter(w => !w.mastered);
    else if(wrongPageState.filter === 'pending') filtered = all.filter(w => !w.mastered);
    else if(wrongPageState.filter === 'mastered') filtered = all.filter(w => w.mastered);

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / WRONG_PAGE_SIZE));
    wrongPageState.page = Math.min(Math.max(wrongPageState.page, 1), totalPages);
    const start = (wrongPageState.page - 1) * WRONG_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + WRONG_PAGE_SIZE);

    if(!pageItems.length){ list.innerHTML = '<div class="subject-empty" style="padding:60px 24px"><h3>暂无错题数据</h3><p>交卷后答错的题目会自动收录到这里。</p></div>'; }
    else { list.innerHTML = pageItems.map((w, i) => renderWrongCard(w, start + i)).join(''); }

    renderWrongPager(total, totalPages);
    updateWrongSummary(all, filtered);

    list.querySelectorAll('.btn-master').forEach((btn, i) => {
      btn.addEventListener('click', () => toggleMastered(pageItems[i].uid));
    });

    const seg = document.getElementById('wq-seg');
    if(seg && !seg.dataset.bound){
      seg.dataset.bound = '1';
      seg.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          wrongPageState.filter = b.getAttribute('data-filter') || 'all';
          wrongPageState.page = 1;
          seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
          b.classList.add('on');
          renderWrongQuestions();
        });
      });
    }
  }

  // ============ My Favorites ============
  const FAV_PAGE_SIZE = 10;
  let favPageState = { page: 1 };

  function renderFavoriteCard(q, idx){
    const opts = Object.entries(q.options).map(([k, v]) => `<li><span class="k">${k}</span><span>${fmtRich(v)}</span></li>`).join('');
    return `
      <article class="wq" data-uid="${escapeHtml(q._uid)}">
        <div class="wq-head">
          <span class="wq-idx">${String(idx+1).padStart(2,'0')}</span>
          <span class="tag tag-gray">${getTypeLabel(q.type)}</span>
          <span class="wq-src">${escapeHtml(q.chapter)} · <b>${escapeHtml(q.section)}</b></span>
          <div class="sp">
            <button class="ico-btn" title="取消收藏" data-uid="${escapeHtml(q._uid)}">
              <svg viewBox="0 0 24 24"><path d="M6.4 4.2h11.2v16.4L12 16.4l-5.6 4.2z"/></svg>
            </button>
          </div>
        </div>
        <p class="wq-stem">${fmtRich(q.stem)}</p>
        <ul class="wq-opts">${opts}</ul>
        ${q.tag ? `<details class="wq-exp"><summary>查看解析</summary><div class="exp-body"><p>${escapeHtml(q.tag)}</p></div></details>` : ''}
        <div class="wq-act">
          <a class="btn btn-ghost btn-sm" href="题刷刷.html?chapter=${encodeURIComponent(q.chapter)}&section=${encodeURIComponent(q.section)}#practice">重做本题</a>
        </div>
      </article>
    `;
  }

  function renderFavoritesPager(total, totalPages){
    const pager = document.getElementById('fav-pager');
    if(!pager) return;
    if(totalPages <= 1){ pager.innerHTML = '<span style="font-size:12px;color:var(--color-text-secondary)">每页 ' + FAV_PAGE_SIZE + ' 题</span>'; return; }
    let html = '<button class="pg" data-page="prev" ' + (favPageState.page <= 1 ? 'disabled style="opacity:.5;cursor:not-allowed"' : '') + '>&lsaquo;</button>';
    for(let i = 1; i <= totalPages; i++){
      if(i === 1 || i === totalPages || (i >= favPageState.page - 1 && i <= favPageState.page + 1)){
        html += `<button class="pg ${i === favPageState.page ? 'on' : ''}" data-page="${i}">${i}</button>`;
      } else if(i === favPageState.page - 2 || i === favPageState.page + 2){
        html += '<button class="pg" disabled style="opacity:.5;cursor:default">…</button>';
      }
    }
    html += '<button class="pg" data-page="next" ' + (favPageState.page >= totalPages ? 'disabled style="opacity:.5;cursor:not-allowed"' : '') + '>&rsaquo;</button>';
    html += '<span style="margin-left:8px">每页 ' + FAV_PAGE_SIZE + ' 题</span>';
    pager.innerHTML = html;
    pager.querySelectorAll('.pg[data-page]').forEach(b => {
      b.addEventListener('click', () => {
        if(b.disabled) return;
        const p = b.getAttribute('data-page');
        if(p === 'prev') favPageState.page--;
        else if(p === 'next') favPageState.page++;
        else favPageState.page = parseInt(p, 10);
        renderFavorites();
      });
    });
  }

  function renderFavorites(){
    const list = document.getElementById('fav-list');
    if(!list) return;
    const favMap = getFavorites();
    // 优先用收藏里存的完整题目；旧版收藏（只有 uid 没有 stem）从题库补全
    let qs = [...favMap.values()].map(item => {
      if(item.stem) return item;
      const q = getQuestions().find(x => x._uid === item.uid);
      return q || item;
    });
    const total = qs.length;
    const totalPages = Math.max(1, Math.ceil(total / FAV_PAGE_SIZE));
    favPageState.page = Math.min(Math.max(favPageState.page, 1), totalPages);
    const start = (favPageState.page - 1) * FAV_PAGE_SIZE;
    const pageItems = qs.slice(start, start + FAV_PAGE_SIZE);

    if(!pageItems.length){ list.innerHTML = '<div class="subject-empty" style="padding:60px 24px"><h3>暂无收藏题目</h3><p>在做题页点击「收藏」按钮，题目会出现在这里。</p></div>'; }
    else { list.innerHTML = pageItems.map((q, i) => renderFavoriteCard(q, start + i)).join(''); }

    renderFavoritesPager(total, totalPages);

    list.querySelectorAll('.ico-btn[data-uid]').forEach(btn => {
      btn.addEventListener('click', () => {
        removeFavorite(btn.getAttribute('data-uid'));
        renderFavorites();
      });
    });

    const cnt = document.getElementById('fav-count');
    if(cnt) cnt.textContent = total;
    const from = total ? (start + 1) : 0;
    const to = Math.min(start + FAV_PAGE_SIZE, total);
    const fromEl = document.getElementById('fav-from');
    const toEl = document.getElementById('fav-to');
    if(fromEl) fromEl.textContent = from;
    if(toEl) toEl.textContent = to;
  }

  // ============ 待纠错 ============
  const ERR_PAGE_SIZE = 10;
  let errPageState = { page: 1 };

  function renderErrorCard(q, idx){
    const opts = Object.entries(q.options).map(([k, v]) => `<li><span class="k">${k}</span><span>${fmtRich(v)}</span></li>`).join('');
    return `
      <article class="wq" data-uid="${escapeHtml(q.uid || q._uid)}">
        <div class="wq-head">
          <span class="wq-idx">${String(idx+1).padStart(2,'0')}</span>
          <span class="tag tag-gray">${getTypeLabel(q.type)}</span>
          <span class="wq-src">${escapeHtml(q.chapter)} · <b>${escapeHtml(q.section)}</b></span>
          <div class="sp">
            <button class="ico-btn" title="取消纠错" data-uid="${escapeHtml(q.uid || q._uid)}">
              <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            </button>
          </div>
        </div>
        <p class="wq-stem">${fmtRich(q.stem)}</p>
        <ul class="wq-opts">${opts}</ul>
        ${q.analysis ? `<details class="wq-exp"><summary>查看解析</summary><div class="exp-body"><p>${escapeHtml(q.analysis)}</p></div></details>` : ''}
        <div class="wq-act">
          <a class="btn btn-ghost btn-sm" href="题刷刷.html?chapter=${encodeURIComponent(q.chapter)}&section=${encodeURIComponent(q.section)}#practice">重做本题</a>
        </div>
      </article>
    `;
  }

  function renderErrorCorrectedPager(total, totalPages){
    const pager = document.getElementById('err-pager');
    if(!pager) return;
    if(totalPages <= 1){ pager.innerHTML = '<span style="font-size:12px;color:var(--color-text-secondary)">每页 ' + ERR_PAGE_SIZE + ' 题</span>'; return; }
    let html = '<button class="pg" data-page="prev" ' + (errPageState.page <= 1 ? 'disabled style="opacity:.5;cursor:not-allowed"' : '') + '>&lsaquo;</button>';
    for(let i = 1; i <= totalPages; i++){
      if(i === 1 || i === totalPages || (i >= errPageState.page - 1 && i <= errPageState.page + 1)){
        html += `<button class="pg ${i === errPageState.page ? 'on' : ''}" data-page="${i}">${i}</button>`;
      } else if(i === errPageState.page - 2 || i === errPageState.page + 2){
        html += '<button class="pg" disabled style="opacity:.5;cursor:default">…</button>';
      }
    }
    html += '<button class="pg" data-page="next" ' + (errPageState.page >= totalPages ? 'disabled style="opacity:.5;cursor:not-allowed"' : '') + '>&rsaquo;</button>';
    html += '<span style="margin-left:8px">每页 ' + ERR_PAGE_SIZE + ' 题</span>';
    pager.innerHTML = html;
    pager.querySelectorAll('.pg[data-page]').forEach(b => {
      b.addEventListener('click', () => {
        if(b.disabled) return;
        const p = b.getAttribute('data-page');
        if(p === 'prev') errPageState.page--;
        else if(p === 'next') errPageState.page++;
        else errPageState.page = parseInt(p, 10);
        renderErrorCorrected();
      });
    });
  }

  function updateErrorStats(qs){
    const total = qs.length;
    const single = qs.filter(q => q.type === 'single' || q.ptype === 'single').length;
    const multi = qs.filter(q => q.type === 'multi' || q.ptype === 'multi').length;
    const judge = qs.filter(q => q.type === 'judge' || q.ptype === 'judge').length;
    const chapters = new Set(qs.map(q => q.chapter).filter(Boolean)).size;
    const allQ = getQuestions().length || 1;
    const ratio = Math.round(total / allQ * 100);

    const set = (id, val) => { const el = document.getElementById(id); if(el) el.innerHTML = val + '<small>' + (id === 'err-chapters' ? '章' : id === 'err-ratio' ? '%' : '题') + '</small>'; };
    set('err-total', total);
    set('err-single', single);
    set('err-multi', multi);
    set('err-judge', judge);
    set('err-chapters', chapters);
    set('err-ratio', ratio);
  }

  function renderErrorCorrected(){
    const list = document.getElementById('err-list');
    if(!list) return;
    const errMap = getErrorCorrected();
    let qs = [...errMap.values()].map(item => {
      if(item.stem) return item;
      const q = getQuestions().find(x => x._uid === item.uid);
      return q || item;
    });
    const total = qs.length;
    const totalPages = Math.max(1, Math.ceil(total / ERR_PAGE_SIZE));
    errPageState.page = Math.min(Math.max(errPageState.page, 1), totalPages);
    const start = (errPageState.page - 1) * ERR_PAGE_SIZE;
    const pageItems = qs.slice(start, start + ERR_PAGE_SIZE);

    if(!pageItems.length){ list.innerHTML = '<div class="subject-empty" style="padding:60px 24px"><h3>暂无纠错题目</h3><p>在做题页点击「纠错」按钮，标记答案有问题的题目会出现在这里。</p></div>'; }
    else { list.innerHTML = pageItems.map((q, i) => renderErrorCard(q, start + i)).join(''); }

    renderErrorCorrectedPager(total, totalPages);
    updateErrorStats(qs);

    list.querySelectorAll('.ico-btn[data-uid]').forEach(btn => {
      btn.addEventListener('click', () => {
        removeErrorCorrected(btn.getAttribute('data-uid'));
        renderErrorCorrected();
      });
    });

    const cnt = document.getElementById('err-count');
    if(cnt) cnt.textContent = total;
    const from = total ? (start + 1) : 0;
    const to = Math.min(start + ERR_PAGE_SIZE, total);
    const fromEl = document.getElementById('err-from');
    const toEl = document.getElementById('err-to');
    if(fromEl) fromEl.textContent = from;
    if(toEl) toEl.textContent = to;
  }

  // ============ 学习笔记（记录知识点 + 卡片抽查） ============
  function notesKey(){ return 'notes_' + getSubject(); }
  function getNotes(){
    try{
      const raw = store.get(notesKey());
      if(raw){ const obj = typeof raw === 'string' ? JSON.parse(raw) : raw; if(obj && Array.isArray(obj.list)) return obj; }
    }catch(e){}
    return { list: [] };
  }
  function saveNotes(obj){
    try{ store.set(notesKey(), JSON.stringify(obj)); }catch(e){}
  }
  let noteFilter = 'all';
  let quizState = null;

  function noteCrumbName(){
    const sub = (subjects || []).find(s => s.id === getSubject());
    const exam = currentExam ? currentExam() : null;
    const examName = exam ? (exam.name || exam.id || '') : '注会';
    return (sub ? (examName + ' · ' + sub.name) : examName);
  }

  function renderNotes(){
    const root = document.getElementById('view-root');
    if(!root || !root.querySelector('#note-list')) return;
    setText('note-crumb', noteCrumbName());
    const notes = getNotes().list.slice().sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));
    const shown = noteFilter === 'review' ? notes.filter(n=>!n.mastered) : notes;
    const cntEl = document.getElementById('note-count');
    if(cntEl) cntEl.innerHTML = '共 <b>' + notes.length + '</b> 条 · <b style="color:var(--color-danger-text)">' + notes.filter(n=>!n.mastered).length + '</b> 待复习';
    const sumEl = document.getElementById('note-summary');
    if(sumEl) sumEl.textContent = notes.length ? (shown.length + ' 条笔记 · 点击卡片可单独抽查，或进入「卡片抽查」整体过一遍') : '用笔记把重要的知识点留在这里';
    const seg = document.getElementById('note-seg');
    if(seg) seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.getAttribute('data-filter') === noteFilter));
    const list = document.getElementById('note-list');
    if(!shown.length){
      list.innerHTML = '<div class="note-empty"><div class="ne-ico"><svg viewBox="0 0 24 24"><path d="M4.4 19.6h4L18.2 9.8l-4-4L4.4 15.6z"/><path d="M14.2 5.8 18.2 9.8"/></svg></div><p>' + (noteFilter==='review' ? '太棒了，当前没有待复习的笔记' : '还没有笔记。<br>把易错点、公式、关键结论记下来，之后转成卡片抽查。') + '</p>' + (noteFilter!=='review' ? '<button class="btn btn-primary" id="btn-note-add-inline" type="button">＋ 写第一条笔记</button>' : '') + '</div>';
      const inline = list.querySelector('#btn-note-add-inline');
      if(inline) inline.addEventListener('click', () => openNoteEditor());
      return;
    }
    list.innerHTML = shown.map(n => {
      const brief = (n.content||'').replace(/\t/g,'     ').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,4).join('\n');
      const time = new Date(n.updatedAt||n.createdAt||Date.now());
      const timestr = time.getFullYear() + '-' + String(time.getMonth()+1).padStart(2,'0') + '-' + String(time.getDate()).padStart(2,'0');
      const badge = n.mastered
        ? '<span class="nc-badge done">已掌握</span>'
        : '<span class="nc-badge review">待复习</span>';
      return '<div class="note-card' + (n.mastered?' is-mastered':'') + '" data-id="' + n.id + '">' +
        '<div class="nc-top">' + badge + (n.reviewCount ? '<span class="nc-badge">抽查 ' + n.reviewCount + ' 次</span>' : '') + '</div>' +
        '<h4>' + escapeHtml(n.title||'未命名知识点') + '</h4>' +
        '<div class="nc-body">' + escapeHtml(brief) + '</div>' +
        '<div class="nc-foot">' +
          '<span class="nc-time">更新于 ' + timestr + '</span>' +
          '<div class="nc-ops">' +
            '<button data-act="quiz" data-id="' + n.id + '" title="抽查这条" aria-label="抽查这条"><svg viewBox="0 0 24 24"><path d="M8 3h8M12 3v4M6.5 7.5h11A1.5 1.5 0 0 1 19 9v9.5A2.5 2.5 0 0 1 16.5 21h-9A2.5 2.5 0 0 1 5 18.5V9a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M9 13.5l2 2 4-4"/></svg></button>' +
            '<button data-act="edit" data-id="' + n.id + '" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24"><path d="M4.4 19.6h4L18.2 9.8l-4-4L4.4 15.6z"/><path d="M14.2 5.8 18.2 9.8"/></svg></button>' +
            '<button class="nc-del" data-act="del" data-id="' + n.id + '" title="删除" aria-label="删除"><svg viewBox="0 0 24 24"><path d="M5 7h14M9.5 7V4.8h5V7M7.5 7l.9 12h7.2l.9-12"/><path d="M10.2 11v5M13.8 11v5"/></svg></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function openNoteEditor(id){
    const mask = document.getElementById('note-editor');
    if(!mask) return;
    const notes = getNotes().list;
    let editing = null;
    if(id){
      editing = notes.find(n => n.id === id) || null;
      if(!editing) return;
    }
    mask._editingId = editing ? editing.id : null;
    document.getElementById('note-editor-title').textContent = editing ? '编辑笔记' : '新建笔记';
    document.getElementById('note-title').value = editing ? (editing.title||'') : '';
    document.getElementById('note-content').value = editing ? (editing.content||'') : '';
    mask.style.display = 'flex';
    document.getElementById('note-title').focus();
  }
  function closeNoteEditor(){
    const mask = document.getElementById('note-editor');
    if(mask) mask.style.display = 'none';
  }
  function saveNoteEditor(){
    const mask = document.getElementById('note-editor');
    if(!mask) return;
    const title = document.getElementById('note-title').value.trim();
    const content = document.getElementById('note-content').value.replace(/\r\n/g,'\n');
    if(!title && !content){ closeNoteEditor(); return; }
    const obj = getNotes();
    const now = Date.now();
    if(mask._editingId){
      const n = obj.list.find(x => x.id === mask._editingId);
      if(n){ n.title = title; n.content = content; n.updatedAt = now; }
    } else {
      obj.list.push({ id: 'n_' + now + '_' + Math.random().toString(36).slice(2,7), title: title || '未命名知识点', content: content, createdAt: now, updatedAt: now, mastered: 0, reviewCount: 0, lastReview: null });
    }
    saveNotes(obj);
    closeNoteEditor();
    renderNotes();
  }
  function deleteNote(id){
    const obj = getNotes();
    obj.list = obj.list.filter(n => n.id !== id);
    saveNotes(obj);
    renderNotes();
  }

  // ---- 抽查 ----
  function shuffleList(arr){
    const a = arr.slice();
    for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // 重建卡片基础结构（完成页/关闭后恢复两面卡）
  function buildQuizInner(){
    const card = document.getElementById('quiz-card');
    if(!card) return;
    card.style.cursor = 'pointer';
    card.classList.remove('flipped');
    card.querySelector('.quiz-inner').innerHTML =
      '<div class="quiz-face quiz-front">' +
        '<span class="qf-tag">知识点</span><div class="qf-title" id="quiz-q">—</div><div class="qf-hint">点击卡片查看要点</div>' +
      '</div>' +
      '<div class="quiz-face quiz-back">' +
        '<span class="qb-tag">要点回顾</span><div class="qb-body" id="quiz-a">—</div><div class="qb-hint">点击回到正面</div>' +
      '</div>';
  }
  function startNoteQuiz(scope){
    const notes = getNotes().list.slice();
    let pool = (scope === 'review') ? notes.filter(n => !n.mastered) : notes.slice();
    pool = shuffleList(pool);
    if(!pool.length) return;
    quizState = { pool, idx: 0, scope: scope || 'all', flipped: false, noFlip: false, done: 0, won: 0, lost: 0, total: pool.length };
    buildQuizInner();
    const mask = document.getElementById('note-quiz');
    mask.style.display = 'flex';
    setQuizCard();
  }
  function setQuizCard(){
    const s = quizState;
    if(!s) return;
    const card = document.getElementById('quiz-card');
    card.classList.remove('flipped');
    s.flipped = false;
    const n = s.pool[s.idx];
    document.getElementById('quiz-q').textContent = n.title || '未命名知识点';
    document.getElementById('quiz-a').innerHTML = fmtRich(n.content || '—');
    document.getElementById('quiz-progress').textContent = (s.idx + 1) + ' / ' + s.total;
    document.getElementById('quiz-mode').textContent = (s.scope === 'review' ? '仅待复习 · 已记 ' : '全部 · 已记 ') + s.won + ' · 待复 ' + s.lost;
  }
  function flipNoteCard(){
    const s = quizState;
    if(!s || s.noFlip) return;
    const card = document.getElementById('quiz-card');
    card.classList.toggle('flipped');
    s.flipped = card.classList.contains('flipped');
  }
  function quizNext(){
    const s = quizState;
    if(!s) return;
    if(s.idx < s.pool.length - 1){ s.idx++; setQuizCard(); }
    else doneQuiz();
  }
  function quizPrev(){
    const s = quizState;
    if(!s) return;
    if(s.idx > 0){ s.idx--; setQuizCard(); }
  }
  function quizMark(mastered){
    const s = quizState;
    if(!s) return;
    const n = s.pool[s.idx];
    const obj = getNotes();
    const rec = obj.list.find(x => x.id === n.id);
    if(rec){
      rec.mastered = mastered ? 1 : 0;
      rec.reviewCount = (rec.reviewCount || 0) + 1;
      rec.lastReview = Date.now();
      rec.updatedAt = Date.now();
      saveNotes(obj);
    }
    if(mastered) s.won++; else s.lost++;
    s.done++;
    s.pool.splice(s.idx, 1);
    if(s.idx >= s.pool.length) s.idx = 0;
    if(s.pool.length){ setQuizCard(); }
    else doneQuiz();
  }
  function quizShuffleCurrent(){
    const s = quizState;
    if(!s || s.pool.length < 2) return;
    s.pool = shuffleList(s.pool);
    s.idx = 0;
    setQuizCard();
  }
  function doneQuiz(){
    const s = quizState;
    if(!s) return;
    s.noFlip = true;
    const card = document.getElementById('quiz-card');
    const inner = card.querySelector('.quiz-inner');
    card.classList.remove('flipped');
    card.style.cursor = 'default';
    s.flipped = false;
    inner.innerHTML = '<div class="quiz-face quiz-front" style="align-items:center;justify-content:center;text-align:center;gap:8px">' +
      '<div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,.16);display:grid;place-items:center;font-size:26px">✓</div>' +
      '<div style="font-size:19px;font-weight:700">本轮抽查完成</div>' +
      '<div style="font-size:13px;opacity:.8">共 ' + s.total + ' 条 · 记住 ' + s.won + ' · 待复习 ' + s.lost + '</div>' +
      '<div style="margin-top:10px;display:flex;gap:10px"><button id="quiz-again" style="border:none;background:rgba(255,255,255,.2);color:#fff;padding:9px 18px;border-radius:10px;font:inherit;font-size:13px;cursor:pointer">再抽一轮</button>' +
      '<button id="quiz-exit" style="border:none;background:rgba(255,255,255,.2);color:#fff;padding:9px 18px;border-radius:10px;font:inherit;font-size:13px;cursor:pointer">返回</button></div>' +
    '</div>';
    const again = document.getElementById('quiz-again');
    const exit = document.getElementById('quiz-exit');
    if(again) again.addEventListener('click', () => { card.style.cursor='pointer'; startNoteQuiz(s.scope); });
    if(exit) exit.addEventListener('click', closeNoteQuiz);
  }
  function closeNoteQuiz(){
    quizState = null;
    const mask = document.getElementById('note-quiz');
    if(mask){ mask.style.display = 'none'; buildQuizInner(); }
    renderNotes();
  }

  function initNotesUI(){
    document.addEventListener('click', e => {
      const t = e.target;
      if(t.closest && t.closest('#btn-note-add')){ openNoteEditor(); return; }
      if(t.closest && t.closest('#btn-note-save')){ saveNoteEditor(); return; }
      if(t.closest && t.closest('#btn-note-cancel')){ closeNoteEditor(); return; }
      if(t.closest && t.closest('#btn-note-quiz')){ startNoteQuiz(noteFilter); return; }
      if(t.closest && t.closest('#btn-quiz-close')){ closeNoteQuiz(); return; }
      if(t.closest && t.closest('#btn-quiz-prev')){ quizPrev(); return; }
      if(t.closest && t.closest('#btn-quiz-shuffle')){ quizShuffleCurrent(); return; }
      if(t.closest && t.closest('#btn-quiz-wrong')){ quizMark(false); return; }
      if(t.closest && t.closest('#btn-quiz-right')){ quizMark(true); return; }
      if(t.closest && t.closest('#quiz-card')){ flipNoteCard(); return; }
      if(t.closest && t.closest('#note-seg button')){ noteFilter = t.closest('#note-seg button').getAttribute('data-filter') || 'all'; renderNotes(); return; }
      const op = t.closest && t.closest('#note-list .nc-ops button');
      if(op){
        const act = op.getAttribute('data-act');
        const id = op.getAttribute('data-id');
        if(act === 'edit') openNoteEditor(id);
        else if(act === 'del') deleteNote(id);
        else if(act === 'quiz'){
          const obj = getNotes().list.filter(n => n.id === id);
          if(obj.length){ quizState = { pool: obj, idx: 0, scope: 'all', flipped: false, done: 0, won: 0, lost: 0, total: 1 }; buildQuizInner(); const mask = document.getElementById('note-quiz'); if(mask) mask.style.display = 'flex'; setQuizCard(); }
        }
        return;
      }
    });
  }

  // ============ Practice Review（做题页：计时 / 答题卡 / 标记收藏 / 交卷判分） ============
  // 设计原则：
  //  · 做题中绝不暴露正确答案（选项只显示 is-pick 选中态）；交卷后才显示 is-right / is-wrong
  //  · renderCurrentQuestion 只更新题干/选项/判定，不重建 .q-head 外壳与 .q-foot 底部导航
  //  · 全部状态走 localStorage（key 按 chapter+section 隔离），刷新可恢复；file:// 下 store 自动降级
  //  · 判分：单选对=1 分，多选全对=2 分（少选/多选/错选均 0 分），未校验题(verified=false)不计分
  let practiceQuestions = [];
  let currentIndex = 0;
  let practiceState = null;     // {answers, marked, starred, elapsed, lastActive, submitted, currentIndex}
  let practiceSubmitted = false;
  let practiceTimerId = null;
  let practiceChapter = '';
  let practiceSection = '';
  let practiceSessionId = '';
  let practiceEventsBound = false;
  // 机考模式（mode=exam）：每次进入抽全新试卷、随机乱序、限时倒计时、到点自动交卷
  let practiceIsWrongRandom = false;
  let practiceIsExam = false;
  let practicePaperId = '';       // 冲刺模考·套卷模式：当前套卷 id（?mode=paper&paperId=）
  let practiceExamDuration = 0;   // 机考剩余秒上限；0 = 不限时（章节/错题训练正向计时）
  const EXAM_COUNT = 30;          // 机考抽题数量
  const EXAM_DURATION_SEC = 60 * 60; // 机考时长（秒）60 分钟
  const EXAM_MIN_POOL = 10;       // 客观题池不足提示阈值
  // 右栏两区块（草稿 / 正确答案与解析）的折叠状态：全局、跨题目保持（点任意题隐藏，切到别的题仍隐藏）
  let rightCollapsed = { draft: false, ans: true };
  function applyRightCollapsed(){
    const map = { 'draft-section': 'draft', 'ans-section': 'ans' };
    Object.keys(map).forEach(id => {
      const el = document.getElementById(id);
      if(el) el.classList.toggle('collapsed', !!rightCollapsed[map[id]]);
    });
  }

  function setText(id, txt){ const el = document.getElementById(id); if(el) el.textContent = txt == null ? '' : txt; }
  function fmtSec(sec){
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
    const p = n => (n < 10 ? '0' : '') + n;
    return p(h) + ':' + p(m) + ':' + p(s);
  }
  function secShort(sec){ // 已用时简写 mm:ss 或 hh:mm:ss
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
    const p = n => (n < 10 ? '0' : '') + n;
    return h > 0 ? (p(h)+':'+p(m)+':'+p(s)) : (p(m)+':'+p(s));
  }
  function shuffleArray(arr){
    const a = arr.slice();
    for(let i = a.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function stateKey(){ return 'practice_state_' + practiceChapter + '__' + practiceSection; }

  function loadState(){
    const raw = store.get(stateKey());
    if(raw){
      try{
        const s = JSON.parse(raw);
        const state = {
          answers: s.answers || {}, marked: s.marked || {}, starred: s.starred || {}, errorCorrected: s.errorCorrected || {},
          elapsed: s.elapsed || 0, lastActive: s.lastActive || 0,
          submitted: !!s.submitted, currentIndex: s.currentIndex || 0
        };
        // 同步全局收藏到本节 starred，保证跨节收藏状态一致
        const fav = getFavorites();
        practiceQuestions.forEach((q, i) => { if(q._uid && fav.has(q._uid)) state.starred[i] = true; });
        // 同步全局纠错到本节 errorCorrected，保证跨节纠错状态一致
        const err = getErrorCorrected();
        practiceQuestions.forEach((q, i) => { if(q._uid && err.has(q._uid)) state.errorCorrected[i] = true; });
        return state;
      }catch(e){}
    }
    // 首次进入（无续做状态）：从空白开始，不预填任何历史作答；仅同步全局收藏标记
    // （历史作答已存入 sessions_ 留痕，可在「练习历史」中查看，不会覆盖/预填到当前训练）
    const starred = {};
    const errorCorr = {};
    practiceQuestions.forEach((q, i) => {
      if(q._uid && isFavorite(q._uid)) starred[i] = true;
      if(q._uid && isErrorCorrected(q._uid)) errorCorr[i] = true;
    });
    return { answers: {}, marked: {}, starred, errorCorrected: errorCorr, elapsed: 0, lastActive: Date.now(), submitted: false, currentIndex: 0 };
  }
  function saveState(){
    if(!practiceState) return;
    practiceState.currentIndex = currentIndex;
    practiceState.submitted = practiceSubmitted;
    practiceState.lastActive = Date.now();
    try{ store.set(stateKey(), JSON.stringify(practiceState)); }catch(e){ console.warn('[quiz] 做题状态存档失败:', e); }
    syncGlobalAnswers();
  }
  // 把本节作答写入全局映射，供 dashboard/chapter-practice/wrong-questions 跨页读取
  function syncGlobalAnswers(){
    let map = {};
    try{ const raw = store.get(globalAnswersKey()); if(raw) map = JSON.parse(raw) || {}; }catch(e){}
    practiceQuestions.forEach((q, i) => {
      if(!q._uid) return;
      const ans = practiceState.answers[i];
      if(ans){
        map[q._uid] = ans;  // 只写有作答的题
      }else{
        delete map[q._uid]; // 未作答的删除，不写空串
      }
    });
    try{ store.set(globalAnswersKey(), JSON.stringify(map)); }catch(e){}
  }

  function countAnswered(){ let n = 0; practiceQuestions.forEach((q,i) => { if(practiceState.answers[i]) n++; }); return n; }

  // 单题判分：返回 {state, earned, max} —— 未作答不在 earned/max 内体现
  function judgeOne(q, ans){
    // 主观题优先走手动判定（不受verified拦截影响）
    if(isSubjective(q)){
      const max = questionMaxScore(q);
      if(!ans) return { state: 'blank', earned: 0, max };
      const g = getManualGrade(q._uid);
      if(!g) return { state: 'pending', earned: 0, max };
      return { state: g.state, earned: g.state === 'correct' ? (Number(g.score) || max) : 0, max: Number(g.score) || max };
    }
    // 客观题：未verified的不计分
    if(!isVerified(q)) return { state: ans ? 'pending' : 'blank', earned: 0, max: 0 };
    const max = questionMaxScore(q);
    if(!ans) return { state: 'blank', earned: 0, max };
    const ok = normAns(ans) === normAns(q.answer);
    return { state: ok ? 'correct' : 'wrong', earned: ok ? max : 0, max };
  }
  function normAns(a){ return Array.from(new Set(String(a || '').toUpperCase().match(/[A-Z]/g) || [])).sort().join(''); }

  function computeScore(){
    let score = 0, maxScore = 0, correct = 0, wrong = 0, pending = 0, unanswered = 0;
    practiceQuestions.forEach((q, i) => {
      const ans = practiceState.answers[i];
      const r = judgeOne(q, ans);
      maxScore += questionMaxScore(q);  // 分母恒定：所有题目满分都计入
      if(r.state === 'pending') pending++;
      else if(r.state === 'correct'){ correct++; score += r.earned; }
      else if(r.state === 'wrong'){ wrong++; }
      else if(r.state === 'blank'){ unanswered++; }
    });
    return { score, maxScore, correct, wrong, pending, unanswered, total: practiceQuestions.length };
  }

  function renderPractice(){
    const sheet = document.getElementById('sheet');
    if(!sheet) return; // 仅做题页执行
    const params = new URLSearchParams(location.search);
    
    practiceIsWrongRandom = params.get('mode') === 'wrong_random';
    practiceIsExam = params.get('mode') === 'exam';
    practiceChapter = params.get('chapter') || '';
    practiceSection = params.get('section') || '';
    practiceExamDuration = 0; // 默认正向计时
    // 冲刺模考·选套卷视图：列出历年真题/全真模拟，点选后进入对应套卷整卷训练
    if(params.get('mode') === 'select'){ renderPaperSelector(); return; }
    if(params.get('mode') === 'paper'){
      practicePaperId = params.get('paperId') || '';
      const isIntensive = params.get('module') === 'intensive';
      const moduleLabel = isIntensive ? '强化训练' : '冲刺模考';
      // 运行时动态获取当前科目的题库
      let paperBank;
      if(isIntensive){
        const b = window.BANK_INTENSIVE;
        const s = __bankSubj__();
        paperBank = b ? ((b[s] != null) ? b[s] : b) : [];
      } else {
        paperBank = (APP.papers || []);
      }
      const paper = paperBank.find(p => p.id === practicePaperId);
      
      if(!paper){
        const qc = document.querySelector('.q-card');
        if(qc) qc.innerHTML = '<div class="subject-empty"><h3>套卷未找到</h3><p>请返回' + moduleLabel + '重新选择套卷。</p></div>';
        const sp = document.getElementById('sheet-sp'); if(sp) sp.textContent = '0 题';
        return;
      }
      practiceChapter = paper.name || ('paper:' + practicePaperId);
      
      try {
        const psess = ensureSession('paper', practiceChapter, ''); // 传套卷名作 chapter：显示友好 + 同卷判定
        practiceSessionId = psess.id;
        
      } catch(e) {
        
      }
      
      try {
        practiceQuestions = getQuestions();
        
      } catch(e) {
        
      }
      
      if(!practiceQuestions.length){
        const qc = document.querySelector('.q-card');
        if(qc) qc.innerHTML = '<div class="subject-empty"><h3>该套卷暂无题目</h3></div>';
        return;
      }
      enterPracticeSession();
      return;
    }
    // 每次进入训练都确保一个独立 session：错题训练/新章节强制清空历史作答；同章节未交卷则续做。
    let sess;
    if(practiceIsExam){
      // 机考：每次进入都是全新试卷，不续做旧卷；先归档未交卷的旧训练，再从零开卷
      const cur = getCurrentSession();
      if(cur && Object.keys(cur.answers || {}).length) archiveCurrentSession();
      sess = newSession('exam', '全真模考', '');
      setCurrentSession(sess);
      try{ store.set(globalAnswersKey(), JSON.stringify({})); }catch(e){}
      try{ store.remove(stateKey()); }catch(e){}
    } else {
      const sessMode = practiceIsWrongRandom ? 'wrong_random' : 'chapter';
      sess = ensureSession(sessMode, practiceChapter, practiceSection);
    }
    practiceSessionId = sess.id;
    practiceQuestions = getQuestions();
    let wrongRandomEmpty = false, examEmpty = false;
    if(practiceIsWrongRandom){
      const wrongPool = practiceQuestions.filter(q => isWrong(q));
      if(!wrongPool.length){
        wrongRandomEmpty = true;
      } else {
        practiceQuestions = shuffleArray(wrongPool).slice(0, Math.min(wrongPool.length, 20));
        practiceChapter = '错题随机训练';
        practiceSection = '';
        store.remove(stateKey()); // 每次进入随机训练都重新抽题，不沿用旧状态
      }
    } else if(practiceIsExam){
      // 机考抽卷：客观题池随机抽 EXAM_COUNT 题，限时 EXAM_DURATION_SEC
      const pool = practiceQuestions.filter(q => isObjective(q) && q.verified);
      if(pool.length < EXAM_MIN_POOL){
        examEmpty = true;
      } else {
        practiceQuestions = shuffleArray(pool).slice(0, EXAM_COUNT);
        practiceChapter = '全真模考';
        practiceSection = '';
        practiceExamDuration = EXAM_DURATION_SEC;
        try{ store.remove(stateKey()); }catch(e){}
      }
    } else if(practiceChapter){
      practiceQuestions = practiceQuestions.filter(q => q.chapter === practiceChapter);
      if(practiceSection) practiceQuestions = practiceQuestions.filter(q => q.section === practiceSection);
    }
    if(!practiceQuestions.length || wrongRandomEmpty || examEmpty){
      const qcard = document.querySelector('.q-card');
      const msg = wrongRandomEmpty ? '暂无错题，先去章节训练做错几道吧。' : (examEmpty ? '客观题池太小，暂时无法组卷（至少需 ' + EXAM_MIN_POOL + ' 道已校验客观题）。' : '本节暂无题目');
      const sub = wrongRandomEmpty ? '错题本会随练习自动积累。' : (examEmpty ? '题库补足后即可开启全真模拟。' : '请返回章节列表选择其他小节开始练习。');
      if(qcard) qcard.innerHTML = '<div class="subject-empty"><h3>' + msg + '</h3><p>' + sub + '</p></div>';
      const sp = document.getElementById('sheet-sp'); if(sp) sp.textContent = '0 题';
      return;
    }
    enterPracticeSession();
  }

  // 进入训练后的统一渲染流程（章节训练 / 错题随机 / 机考 / 冲刺模考套卷 共用）
  // 顶栏返回按钮：根据当前练习模式决定 href + 文案
  // - chapter / wrong_random → "返回章节" → chapter-practice.html
  // - paper / exam           → "返回冲刺模考" → 题刷刷.html?mode=select
  function syncTopbarBack(){
    const back = document.getElementById('topbar-back');
    const txt = document.getElementById('topbar-back-text');
    const pback = document.getElementById('pb-back');
    const ptxt = document.getElementById('pb-back-text');
    let href, label;
    if(practicePaperId || practiceIsExam){
      href = '#practice?mode=select';
      label = '返回冲刺模考';
    } else {
      href = '#chapter';
      label = '返回章节';
    }
    if(back) back.setAttribute('href', href);
    if(txt) txt.textContent = label;
    if(pback) pback.setAttribute('href', href);
    if(ptxt) ptxt.textContent = label;
  }

  function enterPracticeSession(){
    practiceState = loadState();
    practiceSubmitted = !!practiceState.submitted;
    // 进入训练时重置右栏折叠态（避免上次"隐藏右栏"残留导致整页看不到解析）
    const colRightEl = document.getElementById('col-right');
    if(colRightEl){ colRightEl.style.display = ''; colRightEl.classList.remove('collapsed'); }
    const colsEl = document.querySelector('.cols');
    if(colsEl) colsEl.classList.remove('right-collapsed');
    rightCollapsed = { draft: false, ans: true }; // 新练习默认折叠「正确答案与解析」，点击展开后可看正确答案/我的作答/解析
    applyRightCollapsed();
    // 同步状态到题目对象（与全局 user_answer 保持一致，便于其他逻辑复用）
    practiceQuestions.forEach((q, i) => { q.user_answer = practiceState.answers[i] || ''; });
    currentIndex = Math.min(Math.max(practiceState.currentIndex || 0, 0), practiceQuestions.length - 1);

    syncTopbarBack();
    bindPracticeEvents();
    renderInfoCard();
    renderSheet();
    renderCurrentQuestion();
    startTimer();

    // 顶栏标题
    const tbTitle = document.getElementById('tb-title');
    if(tbTitle){
      if(practiceIsWrongRandom){
        tbTitle.innerHTML = '错题随机训练 · <b>随机抽题</b> · 强化复盘';
      } else if(practiceIsExam){
        tbTitle.innerHTML = '全真模考 · <b>限时 ' + Math.round(practiceExamDuration / 60) + ' 分钟</b> · 客观题 ' + EXAM_COUNT + ' 题';
      } else if(practicePaperId){
        const isIntensivePaper = /[?&]module=intensive/.test(location.search);
        let paperLabel = isIntensivePaper ? '强化训练套卷' : '冲刺模考套卷';
        // 中级会计实务强化训练显示特定名称
        if(isIntensivePaper && getSubject() === 'mid-practice'){
          paperLabel = '2026年中级实务-正保550题';
        }
        tbTitle.innerHTML = escapeHtml(practiceChapter) + ' · <b>' + paperLabel + '</b>';
      } else {
        const secShort = practiceSection.replace(/^第\d+关\s*/, '');
        tbTitle.innerHTML = escapeHtml(practiceChapter) + ' · <b>' + escapeHtml(secShort) + '</b> · 章节训练';
      }
    }
    // 顶部黑底栏面包屑（参照冲刺模拟：学习中心 / 科目 / 模式 / 位置）
    const tbInner = document.querySelector('.topbar .tb-inner');
    if(tbInner){
      const oldCrumb = document.getElementById('practice-crumb');
      if(oldCrumb) oldCrumb.remove();
      const crumb = document.createElement('nav');
      crumb.id = 'practice-crumb';
      crumb.className = 'crumb';
      crumb.style.cssText = 'justify-content:center;display:flex;flex-wrap:wrap;gap:2px;align-items:center';
      const urlParams = new URLSearchParams(location.search);
      const isIntensive = urlParams.get('module') === 'intensive';
      const modeLabel = practiceIsWrongRandom ? '错题训练' : (practicePaperId ? (isIntensive ? '强化训练' : '冲刺模考') : '章节训练');
      const locLabel = practicePaperId ? (practiceChapter || '') : (practiceChapter + (practiceSection ? ' · ' + practiceSection.replace(/^第\d+关\s*/, '') : ''));
      // 返回按钮：根据当前页面层级设置返回目标
      let backHref = '#dashboard';
      if(practicePaperId){
        // 答题卡页面：返回到选卷页
        backHref = isIntensive ? '题刷刷.html?module=intensive&mode=select#practice' : '题刷刷.html?mode=select#practice';
      } else if(practiceChapter){
        // 章节训练答题卡：返回到章节列表
        backHref = '#chapter';
      }
      // 中级会计实务强化训练：在模块名与章节名之间插入练习组名
      const isMidIntensive = isIntensive && getSubject() === 'mid-practice';
      const groupHtml = isMidIntensive
        ? '<span class="crumb-group" style="margin-left:-12px">2026年中级实务-正保550题</span>' : '';
      // 仅本页面：返回→中级·实务文字间距 10px（subj 负margin），中级→强化→2026→第一章 相邻文字间 10px（负margin抵消左右内边距），不动返回按钮大小
      const subjMargin = isMidIntensive ? ' style="margin-left:-2px"' : '';
      const restMargin = isMidIntensive ? ' style="margin-left:-12px"' : '';
      crumb.innerHTML = '<a href="' + backHref + '" class="tb-back">返回</a>' +
        '<span class="crumb-subj"' + subjMargin + '>' + escapeHtml(subjectLabel()) + '</span>' +
        '<span class="crumb-mode"' + restMargin + '>' + modeLabel + '</span>' +
        groupHtml +
        '<span class="crumb-paper"' + restMargin + '>' + escapeHtml(locLabel) + '</span>';
      tbInner.appendChild(crumb);
    }
    const sp = document.getElementById('sheet-sp');
    if(sp) sp.textContent = '共 ' + practiceQuestions.length + ' 题';
    updateProgress();
    updateNavCounts();
    if(practiceSubmitted){ enterReviewMode(true); } // 恢复交卷态（不弹成绩框）
  }

  // 冲刺模考·选套卷：从内联 APP.chapters 的「历年真题」「全真模拟」两章读取套卷列表
  // 冲刺模考·选套卷：从内联 APP.papers 读取套卷（历年真题 past / 全真模拟 sim），点选后整卷进入做题
  function renderPaperSelector(){
    const card = document.querySelector('.q-card');
    if(!card) return;
    // 根据URL参数module决定使用哪个题库
    const urlParams = new URLSearchParams(location.search);
    const isIntensive = urlParams.get('module') === 'intensive';
    const moduleLabel = isIntensive ? '强化训练' : '冲刺模考';
    // 运行时动态获取当前科目的题库（切换科目后实时生效）
    let papers;
    if(isIntensive){
      const b = window.BANK_INTENSIVE;
      const s = __bankSubj__();
      papers = b ? ((b[s] != null) ? b[s] : b) : [];
    } else {
      papers = (APP.papers || []);
    }
    // 中级会计实务强化训练显示特定名称
    const intensiveLabel = (getSubject() === 'mid-practice') ? '2026年中级实务-正保550题' : '强化训练';
    const groups = isIntensive ? [['intensive', intensiveLabel]] : [['past', '历年真题'], ['sim', '全真模拟']];
    const moduleParam = isIntensive ? '&module=intensive' : '';
    let html = '<div style="max-width:900px;margin:0 auto;padding:10px 4px">';
    for(const [mode, label] of groups){
      const list = papers.filter(p => p.mode === mode);
      if(!list.length) continue;
      html += '<div class="paper-group" data-mode="' + mode + '">';
      html += '<div class="paper-group-h"><span class="arrow"></span>' + label + '（' + list.length + ' 套）</div>';
      html += '<div class="paper-group-body">';
      for(const p of list){
        const n = (p.questions || []).length;
        const href = '题刷刷.html?mode=paper&paperId=' + encodeURIComponent(p.id) + moduleParam + '#practice';
        html += '<a href="' + href + '" class="paper-item" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border:1px solid var(--color-border);border-radius:11px;text-decoration:none;color:var(--color-text-primary);background:var(--color-surface);transition:.15s" onmouseover="this.style.borderColor=\'var(--color-primary)\'" onmouseout="this.style.borderColor=\'var(--color-border)\'">'
              + '<span style="font-size:13px;line-height:1.45">' + escapeHtml(p.name) + '</span>'
              + '<span style="flex:0 0 auto;font-size:12px;color:var(--color-text-secondary);background:var(--color-surface-muted);border-radius:20px;padding:3px 10px">' + n + ' 题</span></a>';
      }
      html += '</div></div>';
    }
    if(!papers.length){
      html += '<div style="text-align:center;padding:60px 20px;color:var(--color-text-secondary)">暂无' + moduleLabel + '套卷，后续添加后自动显示</div>';
    }
    html += '</div>';
    card.innerHTML = html;
    // 分组折叠：点击分组标题展开/收起该组套卷卡片
    card.querySelectorAll('.paper-group-h').forEach(h => {
      h.addEventListener('click', () => {
        const g = h.closest('.paper-group');
        if(g) g.classList.toggle('collapsed');
      });
    });
    const tb = document.getElementById('tb-title');
    if(tb) tb.innerHTML = '<nav class="crumb" style="justify-content:flex-start;display:flex;flex-wrap:wrap;gap:2px">' +
      '<a href="#dashboard" class="tb-back">返回</a>' +
      '<span id="crumb-subj">' + escapeHtml(subjectLabel()) + '</span>' +
      '<span style="color:var(--color-text-primary);font-weight:600">' + moduleLabel + '</span>' +
      '<span style="color:var(--color-text-secondary)">选择套卷</span></nav>';
    const sp = document.getElementById('sheet-sp'); if(sp) sp.textContent = '共 ' + papers.length + ' 套';
    const colRight = document.getElementById('col-right'); if(colRight) colRight.style.display = 'none';
    // 选卷页顶栏 back 也设成返回自身（虽然被 CSS 隐藏，href 留对以防 stale）
    const back = document.getElementById('topbar-back');
    const backTxt = document.getElementById('topbar-back-text');
    if(back) back.setAttribute('href', '题刷刷.html?mode=select' + moduleParam + '#practice');
    if(backTxt) backTxt.textContent = '返回' + moduleLabel;
    // ============== select 模式专用布局：隐藏做题周边元素 ==============
    // 顶栏：返回章节 / 进度条 / 计时器 — 都属于做题时才有，选卷页不该出现
    // 左栏：本次训练 / 答题卡 / 底部导航 / 交卷按钮 — 选卷页一律不该出现
    // 右栏：答案与解析 — 选卷页一律不该出现
    if(!document.getElementById('mode-select-styles')){
      const s = document.createElement('style');
      s.id = 'mode-select-styles';
      s.textContent = [
        'body.mode-select .topbar .back,',
        'body.mode-select .topbar .prog-mini,',
        'body.mode-select .topbar .timer,',
        'body.mode-select .topbar .tb-right { display: none !important; }',
        'body.mode-select .topbar .tb-title { display: block !important; }',
        'body.mode-select .col-toggle-mini { display: none !important; }',
        'body.mode-select .col-left,',
        'body.mode-select .col-right { display: none !important; }',
        'body.mode-select .v-splitter { display: none !important; }',
        'body.mode-select .cols { display: block !important; max-width: 900px; margin: 0 auto; padding: 24px 24px 48px; }',
        'body.mode-select .col-mid { max-width: none; }',
        'body.mode-select .tb-inner { justify-content: space-between !important; }',
        'body.mode-select .paper-group { margin-bottom: 24px; }',
        'body.mode-select .paper-group-h { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; margin-bottom: 10px; color: var(--color-text-primary); cursor: pointer; user-select: none; }',
        'body.mode-select .paper-group-h .arrow { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid #94a3b8; transition: transform .2s ease; }',
        'body.mode-select .paper-group.collapsed .paper-group-h .arrow { transform: rotate(-90deg); }',
        'body.mode-select .paper-group-body { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 10px; }',
        'body.mode-select .paper-group.collapsed .paper-group-body { display: none; }',
      ].join('');
      document.head.appendChild(s);
    }
    document.body.classList.add('mode-select');
    // 冲刺模考选套卷页：顶部黑底栏右侧固定搜索框
    let pbox = document.getElementById('tb-search-papers');
    if(!pbox){
      const inner = document.querySelector('.topbar .tb-inner');
      if(inner){
        pbox = document.createElement('input');
        pbox.id = 'tb-search-papers';
        pbox.className = 'tb-search';
        pbox.type = 'text';
        pbox.placeholder = '搜索套卷…';
        pbox.style.marginRight = '76px';
        inner.appendChild(pbox);
      }
    }
    bindPageSearch('tb-search-papers', '.q-card', '.paper-item');
  }

  // 根据当前页面 URL 同步侧边栏高亮（多模式页面如 practice-review 按 mode 区分）
  function syncSidebarActive(){
  try{
    let v = getCurrentView();
    // 答题卡页面区分章节训练和冲刺模考
    if(v === 'practice'){
      const h = location.hash.replace(/^#/, '');
      const qi = h.indexOf('?');
      const q = qi >= 0 ? h.slice(qi + 1) : location.search.replace(/^\?/, '');
      const params = new URLSearchParams(q);
      if(params.get('module') === 'intensive') v = 'intensive'; // 强化训练
      else if(params.get('chapter')) v = 'chapter'; // 章节训练答题卡
      else if(params.get('mode') === 'paper' || params.get('mode') === 'select') v = 'practice'; // 冲刺模考
    }
    document.querySelectorAll('.sb-item.is-active').forEach(a => a.classList.remove('is-active'));
    document.querySelectorAll('.sb-item[aria-current="page"]').forEach(a => a.removeAttribute('aria-current'));
    document.querySelectorAll('.sb-item').forEach(a => {
      if(a.getAttribute('data-view') === v){
        a.classList.add('is-active');
        a.setAttribute('aria-current','page');
      }
    });
  }catch(e){}
}

  function renderInfoCard(){
    setText('info-chapter', practiceChapter || '—');
    setText('info-section', practiceIsWrongRandom ? '随机抽题' : (practiceIsExam ? ('限时 ' + Math.round(practiceExamDuration / 60) + ' 分钟') : (practiceSection ? practiceSection.replace(/^第\d+关\s*/, '') : '—')));
    setText('info-total', practiceQuestions.length + ' 题');
    setText('info-elapsed', fmtSec(practiceState.elapsed));
    setText('info-done', countAnswered() + ' / ' + practiceQuestions.length);
  }

  // ---- 答题卡（按题型分组） ----
  function cellClass(i){
    const q = practiceQuestions[i];
    const cls = ['cell'];
    if(i === currentIndex) cls.push('cur');
    if(practiceState.marked[i]) cls.push('flag');
    if(practiceState.starred[i]) cls.push('star');
    if(practiceState.errorCorrected && practiceState.errorCorrected[i]) cls.push('error');
    const ans = practiceState.answers[i];
    if(practiceSubmitted && ans){
      const r = judgeOne(q, ans);
      if(r.state === 'correct') cls.push('ok');
      else if(r.state === 'wrong') cls.push('no');
      else if(r.state === 'pending') cls.push('pending');
    } else if(ans){
      cls.push('done'); // 做题中：已作答(蓝)
    }
    return cls.join(' ');
  }
  function cellSymbol(i){
    const q = practiceQuestions[i];
    const ans = practiceState.answers[i];
    if(practiceSubmitted && ans){
      const r = judgeOne(q, ans);
      if(r.state === 'correct') return '<span class="cell-sym ok-sym">✓</span>';
      else if(r.state === 'wrong') return '<span class="cell-sym no-sym">✗</span>';
      else if(r.state === 'pending') return '<span class="cell-sym pending-sym">?</span>';
    }
    return '';
  }
  function renderSheet(){
    const body = document.getElementById('sheet');
    if(!body) return;
    const groups = [
      { key: 'single', label: '单项选择题' },
      { key: 'multi', label: '多项选择题' },
      { key: 'judge', label: '判断题' },
      { key: 'calc', label: '计算分析题' },
      { key: 'case', label: '案例分析题' },
      { key: 'comp', label: '综合题' },
      { key: 'sub', label: '主观题' }
    ];
    let html = '';
    groups.forEach(g => {
      const idxs = [];
      practiceQuestions.forEach((q, i) => {
        const qt = (q.type === 'subjective') ? (q.ptype || 'sub') : (q.ptype || q.type);
        if(qt === g.key) idxs.push(i);
      });
      if(!idxs.length) return;
      const groupScore = idxs.reduce((s, i) => {
        const q = practiceQuestions[i];
        return s + questionMaxScore(q);
      }, 0);
      html += '<div class="sheet-group"><div class="sheet-group-h">' + g.label + '（' + idxs.length + '题，共' + groupScore + '分）</div><div class="sheet">';
      idxs.forEach(i => {
        const q = practiceQuestions[i];
        const no = qNo(q, i);
        html += '<button class="' + cellClass(i) + '" data-idx="' + i + '" title="第 ' + no + ' 题" type="button"><span class="cell-no">' + no + '</span>' + cellSymbol(i) + '</button>';
      });
      html += '</div></div>';
    });
    body.innerHTML = html;
    body.querySelectorAll('.cell').forEach(c => {
      c.addEventListener('click', () => goQuestion(parseInt(c.getAttribute('data-idx'), 10)));
    });
    renderLegend();
  }
  function updateCellStatus(i){
    const c = document.querySelector('#sheet .cell[data-idx="' + i + '"]');
    if(c) c.className = cellClass(i);
  }
  function renderLegend(){
    const el = document.getElementById('sheet-legend');
    if(!el) return;
    let done = 0, ok = 0, no = 0, pending = 0, flag = 0;
    practiceQuestions.forEach((q, i) => {
      const ans = practiceState.answers[i];
      if(practiceState.marked[i]) flag++;
      if(practiceSubmitted && ans){
        const r = judgeOne(q, ans);
        if(r.state === 'correct') ok++;
        else if(r.state === 'wrong') no++;
        else if(r.state === 'pending') pending++;
      } else if(ans){ done++; }
    });
    const starN = Object.keys(practiceState.starred || {}).length;
    const errorN = Object.keys(practiceState.errorCorrected || {}).length;
    if(practiceSubmitted){
      el.innerHTML =
        '<span><i style="background:#DCFCE7;border-color:#8FE3AC"></i>正确 ' + ok + '</span>' +
        '<span><i style="background:#B45309;border-color:#B45309"></i>已标记 ' + flag + '</span>' +
        '<span><i style="background:#F1F5F9;border-color:#CBD5E1"></i>待校验 ' + pending + '</span>' +
        '<span><i style="background:#FEE2E2;border-color:#F6ADAD"></i>错误 ' + no + '</span>' +
        '<span><i style="background:#F2B33D;border-color:#F2B33D"></i>已收藏 ' + starN + '</span>' +
        '<span><i style="background:rgba(220,38,38,.10);border-color:#DC2626"></i>待纠错 ' + errorN + '</span>';
    } else {
      el.innerHTML =
        '<span><i style="background:#DCFCE7;border-color:#8FE3AC"></i>正确 0</span>' +
        '<span><i style="background:#B45309;border-color:#B45309"></i>已标记 ' + flag + '</span>' +
        '<span><i style="background:#F1F5F9;border-color:#CBD5E1"></i>待校验 0</span>' +
        '<span><i style="background:#FEE2E2;border-color:#F6ADAD"></i>错误 0</span>' +
        '<span><i style="background:#F2B33D;border-color:#F2B33D"></i>已收藏 ' + starN + '</span>' +
        '<span><i style="background:rgba(220,38,38,.10);border-color:#DC2626"></i>待纠错 ' + errorN + '</span>';
    }
  }

  // ---- 当前题（只更新题干/选项/判定，保留 .q-head 外壳与 .q-foot） ----
  function renderCurrentQuestion(){
    const q = practiceQuestions[currentIndex];
    if(!q) return;
    setText('pr-qno', qNo(q, currentIndex));
    setText('pr-type', getTypeLabel(q.type, q.ptype));
    setText('pr-meta', (q.chapter || '') + ' · ' + (q.section || '').replace(/^第\d+关\s*/, ''));
    const stem = document.getElementById('pr-stem');
    if(stem) stem.innerHTML = fmtRich(q.stem);

    const note = document.getElementById('pr-note');
    if(note){
      if(q.tag){ note.style.display = ''; setText('pr-note-txt', q.tag); }
      else note.style.display = 'none';
    }

    // 题头状态标签（交卷后）
    const status = document.getElementById('pr-status');
    if(status){
      if(practiceSubmitted){
        const ans = practiceState.answers[currentIndex];
        if(ans){
          const r = judgeOne(q, ans);
          if(r.state === 'correct'){ status.className = 'tag tag-green'; status.textContent = '已答对'; status.style.display = ''; }
          else if(r.state === 'wrong'){ status.className = 'tag tag-red'; status.textContent = '已答错'; status.style.display = ''; }
          else { status.className = 'tag tag-gray'; status.textContent = '待校验'; status.style.display = ''; }
        } else { status.className = 'tag tag-gray'; status.textContent = '未作答'; status.style.display = ''; }
      } else { status.style.display = 'none'; }
    }

    // 标记 / 收藏按钮态
    const btnMark = document.getElementById('btn-mark');
    if(btnMark) btnMark.classList.toggle('on-mark', !!practiceState.marked[currentIndex]);
    const btnStar = document.getElementById('btn-star');
    if(btnStar) btnStar.classList.toggle('on-star', !!practiceState.starred[currentIndex]);
    const btnError = document.getElementById('btn-error');
    if(btnError) btnError.classList.toggle('on-error', !!(practiceState.errorCorrected && practiceState.errorCorrected[currentIndex]));
    // 标记此题 → 题卡橙色边框 + 角标
    const qcard = document.querySelector('.q-card');
    if(qcard) qcard.classList.toggle('is-marked', !!practiceState.marked[currentIndex]);

    renderOptions(q);
    renderFoot();
    setText('pr-pos', qNo(practiceQuestions[currentIndex], currentIndex) + ' / ' + practiceQuestions.length);
    renderRightSections(q);
    updateProgress();
  }

  // 右侧面板：作答草稿 + 正确答案与解析，统一从上到下渲染（各带折叠按钮）
  function renderRightSections(q){
    const colRight = document.getElementById('col-right');
    if(!colRight) return;
    renderDraft(q);
    const ansSection = document.getElementById('ans-section');
    if(ansSection) ansSection.style.display = '';
    // 正确答案与解析始终直接显示，不再分交卷前/后；折叠态由全局 rightCollapsed 决定（跨题保持）
    renderVerdict(q);
    renderRightPanel(q);
    applyRightCollapsed();
  }

  // 作答草稿：做题中可记录思考，交卷后转为只读展示（位于右栏草稿区顶部）
  function renderDraft(q){
    const wrap = document.getElementById('draft-wrap');
    const view = document.getElementById('draft-view');
    const ta = document.getElementById('draft-input');
    const toggleBtn = document.getElementById('draft-toggle-btn');
    if(!ta) return;
    const uid = q._uid;
    if(practiceSubmitted){
      // 交卷后：默认只读，点击编辑按钮后才可修改
      if(wrap) wrap.style.display = '';
      if(view) view.style.display = 'none';
      if(document.activeElement !== ta) ta.value = getDraft(uid);
      // 默认只读态
      if(!ta.dataset.editing){
        ta.disabled = true;
        ta.style.opacity = '0.85';
        if(toggleBtn){ toggleBtn.textContent = '✎'; toggleBtn.title = '编辑'; }
      }
    } else {
      // 未交卷：直接可编辑，即时保存
      if(wrap) wrap.style.display = '';
      if(view) view.style.display = 'none';
      ta.disabled = false;
      ta.style.opacity = '1';
      ta.dataset.editing = '';
      if(toggleBtn){ toggleBtn.style.display = 'none'; }
      if(document.activeElement !== ta) ta.value = getDraft(uid);
    }
    // 输入即时落库 + 编辑/保存切换（仅绑定一次）
    if(!ta.dataset.bound){
      ta.dataset.bound = '1';
      ta.addEventListener('input', () => {
        const q2 = practiceQuestions[currentIndex];
        if(q2) setDraft(q2._uid, ta.value);
      });
      // 切换按钮：交卷后 编辑↔保存
      if(toggleBtn){
        toggleBtn.addEventListener('click', () => {
          if(!practiceSubmitted) return;
          if(ta.dataset.editing === '1'){
            // 保存
            const q2 = practiceQuestions[currentIndex];
            if(q2) setDraft(q2._uid, ta.value);
            ta.disabled = true;
            ta.style.opacity = '0.85';
            ta.dataset.editing = '';
            toggleBtn.textContent = '✎';
            toggleBtn.title = '编辑';
          } else {
            // 进入编辑
            ta.disabled = false;
            ta.style.opacity = '1';
            ta.dataset.editing = '1';
            toggleBtn.textContent = '✓';
            toggleBtn.title = '保存';
            ta.focus();
          }
        });
      }
    }
    // 未交卷时隐藏按钮，交卷后显示按钮
    if(toggleBtn){
      toggleBtn.style.display = practiceSubmitted ? '' : 'none';
    }
  }

  function renderOptions(q){
    const optsEl = document.getElementById('opts');
    if(!optsEl) return;
    const ua = practiceState.answers[currentIndex] || '';
    const uaSet = new Set(ua.toUpperCase().split(''));
    optsEl.classList.toggle('locked', practiceSubmitted);
    optsEl.classList.toggle('type-multi', q.type === 'multi');
    optsEl.classList.toggle('type-single', q.type === 'single');
    // 主观题无 options，显示作答文本框
    if(isSubjective(q)){
      optsEl.innerHTML = '<div class="subjective-input"><label style="font-size:13px;color:var(--color-text-secondary);display:block;margin-bottom:8px">主观题作答区</label>' +
        '<textarea id="subj-answer" rows="6" placeholder="请输入你的作答" style="width:100%;padding:12px;border:1px solid var(--color-border);border-radius:var(--radius-btn);font-size:14px;resize:vertical;line-height:1.6"' + (practiceSubmitted ? ' disabled' : '') + '>' + escapeHtml(ua) + '</textarea></div>';
      if(!practiceSubmitted){
        const ta = optsEl.querySelector('#subj-answer');
        if(ta){
          ta.addEventListener('input', () => {
            const val = ta.value.trim();
            if(val){ practiceState.answers[currentIndex] = val; q.user_answer = val; }
            else { delete practiceState.answers[currentIndex]; q.user_answer = ''; }
            saveState();
            updateProgress();
          });
        }
      }
      return;
    }
    // 判断题：自动生成 √/× 选项（不依赖 options 字段，与本地版一致）
    const optSrc = q.type === 'judge' ? { '√': '正确', '×': '错误' } : (q.options || {});
    optsEl.innerHTML = Object.entries(optSrc).map(([k, v]) => {
      const cls = ['opt'];
      const picked = uaSet.has(k.toUpperCase());
      let mk = '';
      if(practiceSubmitted){
        const isRight = q.answer && q.answer.toUpperCase().indexOf(k.toUpperCase()) >= 0;
        if(isRight){ cls.push('is-right'); mk = '<span class="mk">正确答案</span>'; }
        if(picked && !isRight){ cls.push('is-wrong'); mk = '<span class="mk">你的答案</span>'; }
      } else if(picked){
        cls.push('is-pick');
      }
      return '<label class="' + cls.join(' ') + '" data-k="' + k + '"><span class="k">' + k + '</span><span class="txt">' + fmtRich(v) + '</span>' + mk + '</label>';
    }).join('');
    if(!practiceSubmitted){
      optsEl.querySelectorAll('.opt').forEach(o => {
        o.addEventListener('click', () => selectOption(o.getAttribute('data-k')));
      });
    }
  }

  function renderVerdict(q){
    const v = document.getElementById('pr-verdict');
    if(!v) return;
    v.style.display = '';
    const ans = practiceState.answers[currentIndex];
    const r = judgeOne(q, ans);
    if(!ans){
      v.className = 'verdict is-pending';
      v.innerHTML = '<span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 11.4v4.4M12 8v.2"/></svg></span>' +
        '<div><div class="t">未作答</div><div class="d">本题尚未选择答案，正确答案与解析已显示在下方。</div></div>';
      return;
    }
    let cls = 'verdict', ic, title, desc;
    if(r.state === 'correct'){
      cls += ' is-right';
      ic = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
      title = '回答正确'; desc = '本题作答正确，已得 ' + r.earned + ' 分。';
    } else if(r.state === 'wrong'){
      cls += ' is-wrong';
      ic = '<svg viewBox="0 0 24 24"><path d="M17 7 7 17M7 7l10 10"/></svg>';
      title = '回答错误'; desc = '本题判为错误，本题 ' + r.max + ' 分未得分。';
    } else {
      cls += ' is-pending';
      ic = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 11.4v4.4M12 8v.2"/></svg>';
      if(isSubjective(q)){
        title = '待手动判分'; desc = '分析题/综合题需你手动判定对错与得分，系统不会自动计入错题。';
      } else {
        title = '待校验'; desc = '本题暂无标准答案，作答不计入得分。';
      }
    }
    v.className = cls;
    v.style.display = '';
    let html = '<span class="ic">' + ic + '</span><div><div class="t">' + title + '</div><div class="d">' + desc + '</div></div>' +
      '<div class="sp"><span>你的作答 <b>' + escapeHtml(ans) + '</b></span><span>标准答案 <b>' + escapeHtml(q.answer || '—') + '</b></span></div>';
    // 主观题手动判分面板：仅交卷后允许判分，未交卷作答只是记忆，不进错题/历史
    if(isSubjective(q)){
      if(practiceSubmitted){
        const g = getManualGrade(q._uid);
        const scoreVal = g ? (g.score || r.max) : r.max;
        html += '<div class="manual-grade" style="margin-top:12px;padding:12px;background:var(--color-surface-2);border-radius:var(--radius-card);display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
          '<span style="font-size:13px;color:var(--color-text-secondary)">手动判分：</span>' +
          '<button class="btn btn-sm btn-grade-correct ' + (g && g.state === 'correct' ? 'btn-success' : 'btn-ghost') + '" data-grade="correct">判对</button>' +
          '<button class="btn btn-sm btn-grade-wrong ' + (g && g.state === 'wrong' ? 'btn-danger' : 'btn-ghost') + '" data-grade="wrong">判错</button>' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--color-text-secondary)">得分 <input type="number" class="input-grade-score" value="' + scoreVal + '" min="0" max="' + r.max + '" style="width:60px;padding:6px 8px;border:1px solid var(--color-border);border-radius:var(--radius-btn);font-size:13px"></label>' +
          '<span style="font-size:13px;color:var(--color-text-secondary)">满分 ' + r.max + ' 分</span>' +
        '</div>';
      } else {
        html += '<div class="manual-grade" style="margin-top:12px;padding:12px;background:var(--color-surface-2);border-radius:var(--radius-card);font-size:13px;color:var(--color-text-secondary)">交卷后即可手动判分（未交卷作答仅作记忆保存，不计入错题与历史）</div>';
      }
    }
    v.innerHTML = html;

    // 绑定主观题手动判分
    if(isSubjective(q)){
      const scoreInput = v.querySelector('.input-grade-score');
      v.querySelectorAll('.btn-grade-correct,.btn-grade-wrong').forEach(btn => {
        btn.addEventListener('click', () => {
          const state = btn.getAttribute('data-grade');
          const score = parseFloat(scoreInput ? scoreInput.value : r.max) || r.max;
          setManualGrade(q._uid, state, score);
          // 同步当前题对象的状态，便于实时统计
          q.manualGrade = { state, score };
          renderVerdict(q);
          renderRightPanel(q);
          renderSheet();
          updateProgress();
          updateNavCounts();
        });
      });
    }
  }

  function renderFoot(){
    const btnPrev = document.getElementById('btn-prev');
    if(btnPrev) btnPrev.disabled = currentIndex <= 0;
    const btnNext = document.getElementById('btn-next');
    if(!btnNext) return;
    const isLast = currentIndex >= practiceQuestions.length - 1;
    const nextHtml = '下一题 <svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>';
    if(practiceSubmitted){
      // 交卷后浏览态：末题不再动作，其余仍可"下一题"浏览
      if(isLast){
        btnNext.textContent = '已交卷';
        btnNext.classList.add('btn-secondary');
        btnNext.classList.remove('btn-primary','btn-teal');
        btnNext.disabled = true;
      } else {
        btnNext.innerHTML = nextHtml;
        btnNext.classList.add('btn-teal');
        btnNext.classList.remove('btn-primary','btn-secondary');
        btnNext.disabled = false;
      }
      return;
    }
    if(isLast){
      // 末题 → "交卷"（主按钮）
      btnNext.textContent = '交卷';
      btnNext.classList.add('btn-primary');
      btnNext.classList.remove('btn-teal','btn-secondary');
      btnNext.disabled = false;
    } else {
      btnNext.innerHTML = nextHtml;
      btnNext.classList.add('btn-teal');
      btnNext.classList.remove('btn-primary','btn-secondary');
      btnNext.disabled = false;
    }
  }

  function renderRightPanel(q){
    const card = document.getElementById('ans-card');
    const section = document.getElementById('ans-section');
    if(!card) return;
    if(section) section.style.display = '';
    card.classList.toggle('subjective-ans', isSubjective(q));
    const ans = practiceState.answers[currentIndex];
    const r = judgeOne(q, ans);
    const yourAns = ans || '未作答';
    const correctAns = isVerified(q) ? (q.answer || '—') : '待校验';
    const yourClass = r.state === 'correct' ? 'right' : (r.state === 'wrong' ? 'wrong' : 'pending');
    const correctClass = isVerified(q) ? 'right' : 'pending';
    // 主观题：交卷后保留手动判分（判对 / 判错 / 得分），其余判定信息不展示
    let extraHtml = '';
    if(isSubjective(q) && practiceSubmitted){
      const maxS = r.max || maxScore(q);
      const g = getManualGrade(q._uid);
      const scoreVal = g ? (g.score || maxS) : maxS;
      extraHtml = '<div class="manual-grade" style="margin-top:12px;padding:10px 12px;background:var(--color-surface-2);border-radius:var(--radius-card);display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<span style="font-size:13px;color:var(--color-text-secondary)">手动判分：</span>' +
        '<button class="btn btn-sm btn-grade-correct ' + (g && g.state === 'correct' ? 'btn-success' : 'btn-ghost') + '" data-grade="correct">判对</button>' +
        '<button class="btn btn-sm btn-grade-wrong ' + (g && g.state === 'wrong' ? 'btn-danger' : 'btn-ghost') + '" data-grade="wrong">判错</button>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--color-text-secondary)">得分 <input type="number" class="input-grade-score" value="' + scoreVal + '" min="0" max="' + maxS + '" style="width:56px;padding:5px 8px;border:1px solid var(--color-border);border-radius:var(--radius-btn);font-size:13px"></label>' +
        '<span style="font-size:13px;color:var(--color-text-secondary)">满分 ' + maxS + ' 分</span>' +
      '</div>';
    }
    card.innerHTML =
      '<div class="ans-sections">' +
        '<div class="ans-sec your-ans ' + yourClass + '">' +
          '<div class="ans-sec-h">我的作答</div>' +
          '<div class="ans-sec-v">' + fmtRich(yourAns) + '</div>' +
        '</div>' +
        '<div class="ans-sec correct-ans ' + correctClass + '">' +
          '<div class="ans-sec-h">正确答案</div>' +
          '<div class="ans-sec-v">' + fmtRich(correctAns) + '</div>' +
        '</div>' +
        (q.analysis ?
          '<div class="ans-sec analysis-sec">' +
            '<div class="ans-sec-h">解析</div>' +
            '<div class="ans-sec-v">' + fmtRich(q.analysis) + '</div>' +
          '</div>' : '') +
      '</div>' +
      extraHtml;
    // 绑定主观题手动判分
    if(isSubjective(q) && practiceSubmitted){
      const maxS = r.max || maxScore(q);
      card.querySelectorAll('.btn-grade-correct,.btn-grade-wrong').forEach(btn => {
        btn.addEventListener('click', () => {
          const state = btn.getAttribute('data-grade');
          const si = card.querySelector('.input-grade-score');
          const score = parseFloat(si ? si.value : maxS) || maxS;
          setManualGrade(q._uid, state, score);
          q.manualGrade = { state, score };
          renderRightPanel(q);
          renderSheet();
          updateProgress();
          updateNavCounts();
        });
      });
    }
  }

  function maxScore(q){
    return questionMaxScore(q);
  }

  // 统一满分计算：优先q.score，其次按题型默认值
  function questionMaxScore(q){
    if(Number(q.score) > 0) return Number(q.score);
    if(q.type === 'multi' || q.type === 'multiple') return 2;
    return 1;
  }

  function toggleRightPanel(forceExpand){
    const cols = document.querySelector('.cols');
    const colRight = document.getElementById('col-right');
    if(!cols || !colRight) return;
    const current = cols.classList.contains('right-collapsed');
    const desired = (typeof forceExpand === 'boolean') ? !forceExpand : !current;
    cols.classList.toggle('right-collapsed', desired);
    colRight.classList.toggle('collapsed', desired);
  }

  function updateProgress(){
    const done = countAnswered();
    const total = practiceQuestions.length;
    const bar = document.getElementById('prog-bar');
    if(bar) bar.style.width = (total ? done / total * 100 : 0) + '%';
    setText('prog-done', done);
    setText('prog-total', total);
    setText('pb-prog-done', done);
    setText('pb-prog-total', total);
    const pbar = document.getElementById('pb-prog-bar');
    if(pbar) pbar.style.width = (total ? done / total * 100 : 0) + '%';
    const big = document.querySelector('.sheet-top .big');
    if(big) big.textContent = done;
    const tot = document.querySelector('.sheet-top .tot');
    if(tot) tot.textContent = '/ ' + total;
    const rate = document.getElementById('sheet-rate');
    if(rate){
      if(practiceSubmitted){
        const sc = computeScore();
        const denom = sc.correct + sc.wrong;
        rate.innerHTML = '正确率 <b>' + (denom ? (sc.correct / denom * 100).toFixed(1) : '0.0') + '%</b>';
      } else {
        rate.innerHTML = '已作答 <b>' + done + '</b>';
      }
    }
  }
  function updateNavCounts(){
    const sc = computeScore();
    setText('nav-wrong', practiceSubmitted ? sc.wrong : '—');
    setText('nav-star', getFavorites().size);
  }

  // ---- 选项交互 ----
  function selectOption(optKey){
    if(practiceSubmitted) return;
    const q = practiceQuestions[currentIndex];
    if(!q || !optKey) return;
    let ua = practiceState.answers[currentIndex] || '';
    if(q.type === 'single' || q.type === 'judge'){
      ua = (ua === optKey ? '' : optKey); // 单选再次点击同项可取消
    } else {
      const set = new Set(ua.toUpperCase().split(''));
      const k = optKey.toUpperCase();
      if(set.has(k)) set.delete(k); else set.add(k);
      ua = [...set].sort().join('');
    }
    if(ua){ practiceState.answers[currentIndex] = ua; } else { delete practiceState.answers[currentIndex]; }
    q.user_answer = ua;
    saveState();
    // 仅刷新选项态 + 当前格 + 计数，避免整卡重建
    const uaSet = new Set(ua.toUpperCase().split(''));
    document.querySelectorAll('#opts .opt').forEach(o => {
      o.classList.toggle('is-pick', uaSet.has(o.getAttribute('data-k').toUpperCase()));
    });
    updateCellStatus(currentIndex);
    renderLegend();
    setText('info-done', countAnswered() + ' / ' + practiceQuestions.length);
    updateProgress();
  }

  // ---- 标记 / 收藏 ----
  function toggleMark(){
    if(practiceState.marked[currentIndex]) delete practiceState.marked[currentIndex];
    else practiceState.marked[currentIndex] = true;
    saveState();
    const btn = document.getElementById('btn-mark');
    if(btn) btn.classList.toggle('on-mark', !!practiceState.marked[currentIndex]);
    const qcard = document.querySelector('.q-card');
    if(qcard) qcard.classList.toggle('is-marked', !!practiceState.marked[currentIndex]);
    updateCellStatus(currentIndex);
    renderLegend();
  }
  function toggleStar(){
    const q = practiceQuestions[currentIndex];
    if(!q) return;
    if(practiceState.starred[currentIndex]){
      delete practiceState.starred[currentIndex];
      if(q._uid) removeFavorite(q._uid);
    } else {
      practiceState.starred[currentIndex] = true;
      if(q._uid) addFavorite(q._uid, q);
    }
    saveState();
    const btn = document.getElementById('btn-star');
    if(btn) btn.classList.toggle('on-star', !!practiceState.starred[currentIndex]);
    updateCellStatus(currentIndex);
    renderLegend();
    updateNavCounts();
  }
  function toggleError(){
    const q = practiceQuestions[currentIndex];
    if(!q) return;
    if(!practiceState.errorCorrected) practiceState.errorCorrected = {};
    if(practiceState.errorCorrected[currentIndex]){
      delete practiceState.errorCorrected[currentIndex];
      if(q._uid) removeErrorCorrected(q._uid);
    } else {
      practiceState.errorCorrected[currentIndex] = true;
      if(q._uid) addErrorCorrected(q._uid, q);
    }
    saveState();
    const btn = document.getElementById('btn-error');
    if(btn) btn.classList.toggle('on-error', !!practiceState.errorCorrected[currentIndex]);
    updateCellStatus(currentIndex);
    renderLegend();
  }


  // ---- 切题 ----
  function prevQuestion(){
    if(currentIndex <= 0) return;
    currentIndex--;
    saveState();
    renderSheet();
    renderCurrentQuestion();
  }
  function nextQuestion(){
    if(currentIndex >= practiceQuestions.length - 1){
      if(practiceSubmitted) return; // 交卷后末题不再动作
      submitPaper(); // 末题"下一题"→交卷
      return;
    }
    currentIndex++;
    saveState();
    renderSheet();
    renderCurrentQuestion();
  }
  function goQuestion(i){
    if(i < 0 || i >= practiceQuestions.length || i === currentIndex) return;
    currentIndex = i;
    saveState();
    renderSheet();
    renderCurrentQuestion();
  }

  // ---- 计时器（章节/错题：正向；机考：剩余时间倒计时，归零自动交卷） ----
  let __timerStartWall__ = 0;
  function __currentElapsed__(){
    if(!__timerStartWall__) return practiceState.elapsed || 0;
    return (practiceState.elapsed || 0) + Math.floor((Date.now() - __timerStartWall__) / 1000);
  }
  function startTimer(){
    stopTimerSilent();
    updateTimerDisplay();
    const timerEl = document.querySelector('.timer');
    if(practiceSubmitted){
      if(timerEl) timerEl.classList.remove('live');
      return; // 交卷后不再计时
    }
    if(timerEl) timerEl.classList.add('live');
    __timerStartWall__ = Date.now();
    practiceTimerId = setInterval(() => {
      updateTimerDisplay();
      const cur = __currentElapsed__();
      if(cur % 5 === 0) saveState();
      // 机考倒计时归零 → 停止计时并自动交卷
      if(practiceIsExam && practiceExamDuration > 0 && cur >= practiceExamDuration){
        stopTimerSilent();
        saveState();
        if(!practiceSubmitted) submitPaper(true);
      }
    }, 1000);
  }
  function stopTimerSilent(){
    if(practiceTimerId){ clearInterval(practiceTimerId); practiceTimerId = null; }
    if(__timerStartWall__){
      practiceState.elapsed = __currentElapsed__();
      __timerStartWall__ = 0;
    }
    const timerEl = document.querySelector('.timer');
    if(timerEl) timerEl.classList.remove('live');
  }
  function stopTimer(){ stopTimerSilent(); saveState(); }
  function updateTimerDisplay(){
    const cur = __currentElapsed__();
    if(practiceIsExam && practiceExamDuration > 0 && !practiceSubmitted){
      const remain = Math.max(0, practiceExamDuration - cur);
      setText('clock', fmtSec(remain));
      setText('pb-clock', fmtSec(remain));
      setText('info-elapsed', fmtSec(remain));
    } else {
      setText('clock', fmtSec(cur));
      setText('pb-clock', fmtSec(cur));
      setText('info-elapsed', fmtSec(cur));
    }
  }

  // ---- 交卷判分（force=true 为机考倒计时自动交卷，跳过未作答确认） ----
  function submitPaper(force){
    const sc = computeScore();
    if(!force && sc.unanswered > 0){
      if(!confirm('还有 ' + sc.unanswered + ' 题未作答，确定交卷？')) return;
    }
    practiceSubmitted = true;
    stopTimer();
    // 把本次训练归档到练习历史
    const sess = getCurrentSession();
    if(sess){
      sess.submitted = true;
      sess.endTime = Date.now();
      sess.elapsed = practiceState.elapsed || 0;
      sess.score = sc.score;
      sess.maxScore = sc.maxScore;
      sess.correct = sc.correct;
      sess.wrong = sc.wrong;
      sess.pending = sc.pending;
      sess.total = sc.total;
      sess.paperId = practicePaperId; // 冲刺/强化套卷：记录 paperId，供练习历史/复盘按套卷取题渲染
      sess.answers = {};
      practiceQuestions.forEach((q, i) => { if(q._uid && practiceState.answers[i]) sess.answers[q._uid] = practiceState.answers[i]; });
      // 冗余存储完整题目快照（题目+正确答案+我的作答+解析），使 history.json 自包含可读
      sess.questions = practiceQuestions.map((q, i) => ({
        uid: q._uid || '',
        chapter: q.chapter || '',
        section: q.section || '',
        type: q.type || '',
        raw_type: q.raw_type || '',
        ptype: q.ptype || '',
        parentNo: q.parentNo || null,
        subNo: q.subNo || null,
        stem: q.stem || '',
        options: q.options || [],
        answer: q.answer || '',
        analysis: q.analysis || '',
        score: q.score || 0,
        user_answer: practiceState.answers[i] || ''
      }));
      // 答错的题写入 wrong.json（完整题目+我的作答+解析+错误次数）
      try{
        const wkey = 'wrong_list_' + getSubject();
        const wraw = store.get(wkey);
        const wlist = wraw ? (JSON.parse(wraw) || []) : [];
        const wmap = {};
        wlist.forEach(w => { if(w.uid) wmap[w.uid] = w; });
        practiceQuestions.forEach((q, i) => {
          if(!q._uid) return;
          const ua = practiceState.answers[i] || '';
          const r = judgeOne(q, ua);
          if(r.state === 'wrong'){
            const snap = {
              uid: q._uid,
              chapter: q.chapter || '',
              section: q.section || '',
              type: q.type || '',
              raw_type: q.raw_type || '',
              stem: q.stem || '',
              options: q.options || [],
              answer: q.answer || '',
              analysis: q.analysis || '',
              lastAnswer: ua,
              wrongCount: (wmap[q._uid] ? (wmap[q._uid].wrongCount || 0) : 0) + 1,
              lastWrongTime: Date.now(),
              mastered: wmap[q._uid] ? (wmap[q._uid].mastered || false) : false
            };
            wmap[q._uid] = snap;
          }
        });
        store.set(wkey, JSON.stringify(Object.values(wmap)));
      }catch(e){ console.warn('[quiz] 错题写入失败:', e); }
      setCurrentSession(sess);
      archiveCurrentSession();
    }
    enterReviewMode(false);
    showResults(sc);
  }
  // resume=true：恢复交卷态（刷新后），不弹成绩框；resume=false：交卷动作，弹成绩框
  function enterReviewMode(resume){
    practiceSubmitted = true;
    renderSheet();
    renderCurrentQuestion();
    const colRight = document.getElementById('col-right');
    if(colRight) colRight.style.display = '';
    const btnSubmit = document.getElementById('btn-submit');
    if(btnSubmit){
      btnSubmit.textContent = '交卷';
      btnSubmit.disabled = true;
      btnSubmit.classList.remove('btn-primary');
      btnSubmit.classList.add('btn-secondary');
    }
    updateProgress();
    updateNavCounts();
    if(resume) renderRightSections(practiceQuestions[currentIndex]);
  }
  function showResults(sc){
    const modal = document.getElementById('result-modal');
    if(!modal) return;
    const scoreEl = document.getElementById('modal-score');
    if(scoreEl){
      scoreEl.innerHTML = '<span class="s">' + sc.score + '</span><span class="s-unit"> / ' + sc.maxScore + ' 分</span>';
    }
    const rate = sc.maxScore ? (sc.score / sc.maxScore * 100).toFixed(1) : '0.0';
    const accDenom = sc.correct + sc.wrong;
    const acc = accDenom ? (sc.correct / accDenom * 100).toFixed(1) : '0.0';
    setText('modal-rate', rate + '%');
    setText('modal-acc', acc + '%');
    const bd = document.getElementById('modal-breakdown');
    if(bd){
      bd.innerHTML =
        '<div class="b ok"><div class="v">' + sc.correct + '</div><div class="l">答对</div></div>' +
        '<div class="b no"><div class="v">' + sc.wrong + '</div><div class="l">答错</div></div>' +
        '<div class="b pend"><div class="v">' + sc.pending + '</div><div class="l">待校验</div></div>';
    }
    const ut = document.getElementById('modal-used');
    if(ut) ut.textContent = secShort(practiceState.elapsed);
    modal.style.display = '';
  }
  function closeModal(){ const m = document.getElementById('result-modal'); if(m) m.style.display = 'none'; }
  function redoPractice(){
    if(!confirm('确定重新练习？将清空本节所有作答、标记与计时记录。')) return;
    // 重做前先归档旧 session，再新建一个
    archiveCurrentSession();
    const sess = newSession(practiceIsWrongRandom ? 'wrong_random' : (practiceIsExam ? 'exam' : 'chapter'), practiceChapter, practiceSection);
    setCurrentSession(sess);
    practiceSessionId = sess.id;
    practiceState = { answers: {}, marked: {}, starred: {}, errorCorrected: {}, elapsed: 0, lastActive: Date.now(), submitted: false, currentIndex: 0 };
    practiceSubmitted = false;
    practiceQuestions.forEach(q => { q.user_answer = ''; });
    // 机考重做：重新抽一套全新试卷
    if(practiceIsExam){
      const pool = getQuestions().filter(q => isObjective(q) && q.verified);
      if(pool.length >= EXAM_MIN_POOL){
        practiceQuestions = shuffleArray(pool).slice(0, EXAM_COUNT);
        practiceExamDuration = EXAM_DURATION_SEC;
      }
    }
    try{ store.remove(stateKey()); }catch(e){}
    saveState();
    closeModal();
    const colRight = document.getElementById('col-right');
    if(colRight) colRight.style.display = 'none';
    const btnSubmit = document.getElementById('btn-submit');
    if(btnSubmit){
      btnSubmit.textContent = '直接交卷';
      btnSubmit.disabled = false;
      btnSubmit.classList.add('btn-primary');
      btnSubmit.classList.remove('btn-secondary');
    }
    currentIndex = 0;
    renderInfoCard();
    renderSheet();
    renderCurrentQuestion();
    startTimer();
    updateNavCounts();
  }
  // ---- 练习历史（每次训练独立留痕，可回溯） ----
  function renderHistoryList(){
    const list = document.getElementById('history-list');
    if(!list) return;
    const sessions = getSessions().slice().reverse(); // 最新在前
    if(!sessions.length){
      list.innerHTML = '<p style="text-align:center;color:var(--color-text-secondary);padding:28px 0">暂无练习记录，交卷后会自动留痕。</p>';
      return;
    }
    list.innerHTML = sessions.map(s => {
      const dt = new Date(s.startTime);
      const pad = n => (n < 10 ? '0' : '') + n;
      const date = (dt.getMonth()+1) + '月' + dt.getDate() + '日 ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
      const modeLabel = s.mode === 'wrong_random' ? '错题随机训练' : (s.mode === 'exam' ? '全真模考' : (s.mode === 'imported' ? '导入历史' : '章节训练'));
      const scope = s.mode === 'wrong_random' ? '错题池' : (s.chapter + (s.section ? ' · ' + s.section : ''));
      const total = s.total || (s.answers ? Object.keys(s.answers).length : 0);
      const answered = s.answers ? Object.values(s.answers).filter(v => v && String(v).trim()).length : 0;
      const score = (s.score != null) ? (s.score + '/' + (s.maxScore || s.total)) : '—';
      const rate = (s.correct != null && (s.correct + s.wrong) > 0) ? (s.correct/(s.correct+s.wrong)*100).toFixed(0) + '%' : '—';
      const ended = s.submitted ? '已交卷' : '未交卷';
      return '<div style="padding:14px 12px;border:1px solid var(--color-border);border-radius:var(--radius-card-sm);margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:8px;font-size:13px">' +
          '<span class="mode-tag">' + modeLabel + '</span>' +
          '<b style="font-size:13px">' + escapeHtml(scope) + '</b>' +
          '<span style="margin-left:auto;font-size:12px;color:var(--color-text-secondary)">' + date + ' · ' + ended + '</span>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12px;color:var(--color-text-secondary)">' +
          '<span>作答 <b style="color:var(--color-text-primary)">' + answered + '</b>/' + total + '</span>' +
          '<span>得分 <b style="color:var(--color-text-primary)">' + score + '</b></span>' +
          '<span>正确率 <b style="color:var(--color-success-text)">' + rate + '</b></span>' +
          '<span>正确 <b>' + (s.correct||0) + '</b> · 错误 <b style="color:var(--color-danger-text)">' + (s.wrong||0) + '</b></span>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  function openHistory(){
    renderHistoryList();
    const m = document.getElementById('history-modal');
    if(m) m.style.display = 'grid';
  }
  function bindHistoryModal(){
    const on = (id, fn) => { const el = document.getElementById(id); if(el) el.addEventListener('click', fn); };
    on('btn-history', openHistory);
    on('btn-close-history', () => { const m = document.getElementById('history-modal'); if(m) m.style.display = 'none'; });
    on('btn-close-history-x', () => { const m = document.getElementById('history-modal'); if(m) m.style.display = 'none'; });
    const m = document.getElementById('history-modal');
    if(m) m.addEventListener('click', e => { if(e.target === m) m.style.display = 'none'; });
  }

  // ---- 事件绑定（仅一次） ----
  function bindPracticeEvents(){
    if(practiceEventsBound) return;
    practiceEventsBound = true;
    const on = (id, fn) => { const el = document.getElementById(id); if(el) el.addEventListener('click', fn); };
    on('btn-prev', prevQuestion);
    on('btn-next', nextQuestion);
    on('btn-mark', toggleMark);
    on('btn-star', toggleStar);
    on('btn-error', toggleError);
    on('btn-submit', submitPaper);
    on('btn-review', closeModal);
    on('btn-close-modal', closeModal);
    on('btn-redo', redoPractice);
    on('btn-history', openHistory);

    // 侧栏整体折叠/展开（左/右）由 initSidePanelToggles 统一委托处理；
    // 这里仅保留右侧各区块（作答草稿 / 正确答案与解析）的折叠
    document.querySelectorAll('.section-toggle[data-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const key = targetId === 'draft-section' ? 'draft' : 'ans';
        rightCollapsed[key] = !rightCollapsed[key];
        applyRightCollapsed();
      });
    });

    document.addEventListener('keydown', (e) => {
      if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const modal = document.getElementById('result-modal');
      if(modal && modal.style.display !== 'none') return; // 成绩框打开时不切题
      if(e.key === 'ArrowLeft'){ e.preventDefault(); prevQuestion(); }
      else if(e.key === 'ArrowRight'){ e.preventDefault(); nextQuestion(); }
    });
    window.addEventListener('beforeunload', saveState);
    bindHistoryModal();
  }

  // 顶栏标题同步为当前科目，避免切换后仍是《会计》
  function updateSubjectTitle(sub){
    const tnTitle = document.getElementById('tn-title');
    if(tnTitle) tnTitle.textContent = `2026 年注册会计师专业阶段 · 《${sub ? sub.name : '当前科目'}》`;
  }

  // ============ 左侧菜单折叠（所有页面共享） ============
  function sidebarStateKey(){ return 'sidebar_collapsed_' + getSubject(); }
  function initSidebarToggle(){
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main');
    if(!sidebar) return;
    // 三道杠浮动按钮（在屏幕最左侧），双向切换展开/收起
    if(!document.getElementById('sb-toggle-float')){
      const floatBtn = document.createElement('button');
      floatBtn.id = 'sb-toggle-float';
      floatBtn.className = 'sb-toggle-float';
      floatBtn.title = '收起菜单';
      floatBtn.setAttribute('aria-label', '收起左侧菜单');
      floatBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      floatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if(window.innerWidth > 767){
          // 电脑端：切换侧边栏展开/收起
          toggleSidebar();
        } else {
          // 手机端：打开全局导航抽屉菜单（学习/训练/我的）
          toggleMobileDrawer();
        }
      });
      document.body.appendChild(floatBtn);
    }
    // 移动端抽屉菜单切换函数（≤767px，由 sb-toggle-float 触发）
    function toggleMobileDrawer(){
      const mDrawer = document.getElementById('mDrawer');
      const mDrawerMask = document.getElementById('mDrawerMask');
      if(!mDrawer) return;
      const isOpen = mDrawer.classList.contains('open');
      if(isOpen){
        mDrawer.classList.remove('open');
        if(mDrawerMask) mDrawerMask.classList.remove('show');
      } else {
        mDrawer.classList.add('open');
        if(mDrawerMask) mDrawerMask.classList.add('show');
      }
    }

    // 恢复上次状态
    try{
      const raw = store.get(sidebarStateKey());
      const collapsed = raw === '1';
      applySidebarCollapsed(collapsed);
    }catch(e){}
  }
  function applySidebarCollapsed(collapsed){
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main');
    if(!sidebar) return;
    sidebar.classList.toggle('collapsed', collapsed);
    if(main) main.classList.toggle('expanded', collapsed);
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    // 更新三道杠浮动按钮的title
    const floatBtn = document.getElementById('sb-toggle-float');
    if(floatBtn){
      if(collapsed){
        floatBtn.title = '展开菜单';
        floatBtn.setAttribute('aria-label', '展开左侧菜单');
      } else {
        floatBtn.title = '收起菜单';
        floatBtn.setAttribute('aria-label', '收起左侧菜单');
      }
    }
    try{ store.set(sidebarStateKey(), collapsed ? '1' : '0'); }catch(e){}
  }
  function toggleSidebar(expand){
    const sidebar = document.querySelector('.sidebar');
    if(!sidebar) return;
    const currentlyCollapsed = sidebar.classList.contains('collapsed');
    const target = typeof expand === 'boolean' ? !expand : !currentlyCollapsed;
    applySidebarCollapsed(target);
  }

  // ============ 数据备份 / 恢复（导出 JSON 文件 + 导入合并，7 页侧边栏共享入口） ============
  function collectBackupKeys(){
    const set = new Set();
    const sub = getSubject();
    ['answers_','sessions_','current_session_','favorites_','drafts_','manual_grades_','wrong_mastered_','wrong_list_','notes_','sidebar_collapsed_'].forEach(p => set.add(p + sub));
    let all = [];
    try{ if(window.localStorage) all = Object.keys(window.localStorage); }catch(e){}
    all.forEach(k => { if(k.indexOf('practice_state_') === 0) set.add(k); });
    return [...set];
  }
  function exportBackup(){
    const data = {};
    collectBackupKeys().forEach(k => { try{ const v = store.get(k); if(v != null) data[k] = v; }catch(e){} });
    if(!Object.keys(data).length){ alert('当前没有可导出的数据。'); return; }
    const payload = { app:'cpa-quiz-backup', version:1, subject:APP.subject || 'accounting', exportedAt:new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '刷题数据备份_' + getSubject() + '_' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // 合并策略：sessions 按 id 去重；favorites/wrong_mastered 并集；
  // answers/drafts/manual_grades/practice_state 按 uid 对象合并（备份值覆盖当前同 uid）；
  // 其余（current_session/sidebar）直接覆盖。current_session 保持当前进行中的训练不被备份覆盖。
  function mergeBackupPayload(payload){
    if(!payload || (payload.app !== 'cpa-quiz-backup' && payload.app !== 'cpa-quiz-history') || !payload.data || typeof payload.data !== 'object'){
      return null;
    }
    const d = payload.data;
    let merged = 0;
    Object.keys(d).forEach(k => {
      try{
        const old = store.get(k);
        if(k.indexOf('sessions_') === 0){
          let arr = []; try{ arr = old ? JSON.parse(old) : []; }catch(e){}
          let add = []; try{ add = JSON.parse(d[k]); }catch(e){}
          const ids = new Set(arr.map(x => x && x.id));
          add.forEach(x => { if(x && x.id && !ids.has(x.id)){ arr.push(x); ids.add(x.id); } });
          store.set(k, JSON.stringify(arr));
        } else if(k.indexOf('favorites_') === 0 || k.indexOf('wrong_mastered_') === 0){
          let a = []; try{ a = old ? JSON.parse(old) : []; }catch(e){}
          let b = []; try{ b = JSON.parse(d[k]); }catch(e){}
          if(!Array.isArray(a)) a = []; if(!Array.isArray(b)) b = [];
          const s = new Set([...a, ...b]);
          store.set(k, JSON.stringify([...s]));
        } else if(k.indexOf('manual_grades_') === 0 || k.indexOf('answers_') === 0 || k.indexOf('drafts_') === 0 || k.indexOf('practice_state_') === 0){
          let a = {}; try{ a = old ? JSON.parse(old) : {}; }catch(e){}
          let b = {}; try{ b = JSON.parse(d[k]); }catch(e){}
          if(!a || typeof a !== 'object' || Array.isArray(a)) a = {};
          if(!b || typeof b !== 'object' || Array.isArray(b)) b = {};
          Object.assign(a, b);
          store.set(k, JSON.stringify(a));
        } else if(k.indexOf('current_session_') !== 0) { // 进行中的训练不覆盖
          store.set(k, d[k]);
        }
        merged++;
      }catch(e){}
    });
    return { merged, subject: payload.subject || '', time: payload.exportedAt || '' };
  }
  function importBackup(){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try{
          const payload = JSON.parse(String(reader.result || ''));
          const r = mergeBackupPayload(payload);
          if(!r){
            alert('这不是本软件的备份文件（缺少 app 标识或数据字段）。');
            return;
          }
          const ok = confirm('备份导入完成：合并 ' + r.merged + ' 类数据（科目：' + (r.subject || '—') + '，导出于 ' + (r.time || '—') + '）。\n是否立即刷新页面以应用恢复的数据？');
          if(ok) location.reload();
        }catch(e){
          alert('备份文件解析失败，请确认选择了正确的备份文件。');
        }
      };
      reader.onerror = () => alert('读取文件失败。');
      reader.readAsText(file, 'utf-8');
    });
    document.body.appendChild(input);
    input.click();
  }

  // ============ 学习记录「文件化」：独立可保存的 history.js ============
  // 启动时发现同目录 history.js（window.QUIZ_HISTORY）即合并进本地存储，
  // 实现「学习记录作为独立文件、打开即恢复」。采用合并策略，不会覆盖浏览器里更新的进度。
  // 服务器模式：拉取 data/ 下各文件 → 内存缓存（data/ 即唯一真相），
  // 并用 chapters/papers 覆盖 APP（实现「改 data/chapters.json 刷新即生效」）。
  // 文件模式(file://)：直接 return，沿用 bank_*.js + localStorage（原行为不变）。
  // 云端连接状态角标：让在线模式的每一步都可见（连接中/成功/失败原因），不再"没反应"
  let __cloudBanner__ = null;
  function showCloudStatus(state){
    try{
      if(!__cloudBanner__){
        __cloudBanner__ = document.createElement('div');
        __cloudBanner__.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99998;padding:8px 14px;border-radius:8px;font-size:13px;font-family:system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);max-width:72vw;line-height:1.4';
        document.body.appendChild(__cloudBanner__);
      }
      if(state === 'ok'){
        __cloudBanner__.textContent = '☁️ 云端已连接';
        __cloudBanner__.style.background = '#e8f7ee'; __cloudBanner__.style.color = '#1d7a3e';
        setTimeout(function(){ if(__cloudBanner__){ __cloudBanner__.remove(); __cloudBanner__ = null; } }, 3000);
      } else if(state === 'connecting'){
        __cloudBanner__.textContent = '☁️ 正在连接云端，请稍候…';
        __cloudBanner__.style.background = '#fff8e6'; __cloudBanner__.style.color = '#8a6d1a';
      } else {
        __cloudBanner__.textContent = '⚠️ ' + state;
        __cloudBanner__.style.background = '#fdecea'; __cloudBanner__.style.color = '#b02a2a';
      }
    }catch(e){}
  }

  // file:// / 云端模式下：根据 bank_*.js 动态计算各科目 hasData，补充到 subjects 列表
  // （云端模式只同步用户数据，题库仍由本地 bank_*.js 提供，因此也需要计算 hasData）
  function initFileModeSubjects(){
    // 题库始终从 bank_*.js 加载，无论本地/服务器/云端模式都需要计算 hasData
    try {
      const allSubj = [];
      EXAMS.forEach(e => e.subjects.forEach(s => allSubj.push({ id: s.id, name: s.name })));
      allSubj.forEach(s => {
        let has = false;
        try {
          const bc = window.BANK_CHAPTERS;
          if(bc && bc[s.id] && bc[s.id].chapters && Object.keys(bc[s.id].chapters).length > 0) has = true;
        } catch(e){}
        if(!has){
          try {
            const bi = window.BANK_INTENSIVE;
            if(bi && Array.isArray(bi[s.id]) && bi[s.id].length > 0) has = true;
          } catch(e){}
        }
        if(!has){
          try {
            const bp = window.BANK_PAPERS;
            if(bp && Array.isArray(bp[s.id]) && bp[s.id].length > 0) has = true;
          } catch(e){}
        }
        s.hasData = has;
      });
      subjects.length = 0;
      allSubj.forEach(s => subjects.push(s));
      APP.subjects = allSubj;
      window.__debug_subjects = allSubj; // 调试用
    } catch(e) {
      console.error('initFileModeSubjects error:', e);
    }
  }
  initFileModeSubjects();

  async function seedFromServer(){
    if(__SUPABASE_MODE__){
      showCloudStatus('connecting');
      try{
        const subj = getSubject();
        const map = await (window.SupaStore || window.CloudStore).loadAll(subj);
        ['history','wrong','favorites','error_corrected','notes','answers'].forEach(f => { __fileCache__[f] = (map && map[f]) || {}; });
        // motto 是全局文件，从 global 命名空间单独加载
        try{
          const mottoMap = await (window.SupaStore || window.CloudStore).loadAll('global');
          __fileCache__['motto'] = (mottoMap && mottoMap['motto']) || {};
        }catch(e){}
        // 首次上云：把本机旧 localStorage 业务记录并入云端命名空间，随后写入（避免丢历史）
        try{
          for(let i = 0; i < window.localStorage.length; i++){
            const k = window.localStorage.key(i);
            const f = __fileOfKey__(k);
            if(f && !Object.prototype.hasOwnProperty.call(__fileCache__[f], k)){
              const v = window.localStorage.getItem(k);
              if(v != null){ try{ __fileCache__[f][k] = JSON.parse(v); }catch(e){ __fileCache__[f][k] = v; } }
            }
          }
          __scheduleFlush__('history'); __scheduleFlush__('wrong'); __scheduleFlush__('favorites'); __scheduleFlush__('error_corrected'); __scheduleFlush__('notes'); __scheduleFlush__('answers'); __scheduleFlush__('motto');
        }catch(e){}
        showCloudStatus('ok');
        return; // 题库来自 bank_*.js（IIFE 初始化），无需 /api
      }catch(e){
        const msg = (e && (e.message || e.errMsg || e.errCode || e.status || e.code || (e.error && (e.error.message || e.error.errMsg || e.error.code)))) || '未知错误';
        showCloudStatus('云端连接失败：' + String(msg) + '（本次改用本地记录）');
      }
    }
    if(!__SERVER_MODE__) return;
    try{
      const subj = getSubject();
      // 0) 科目列表（/api/meta 动态给出 hasData，切科目时刷新）
      let metaLoaded = false;
      try{
        const mr = await fetch('/api/meta', { cache:'no-store' });
        if(mr.ok){
          const mj = await mr.json();
          if(mj && Array.isArray(mj.subjects) && mj.subjects.length){
            subjects.length = 0;
            mj.subjects.forEach(s => subjects.push(s));
            APP.subjects = mj.subjects;
            metaLoaded = true;
          }
        }
      }catch(e){}
      // 1) 用户数据文件（按当前科目目录）
      const files = ['history','wrong','favorites','error_corrected','notes','answers','drafts']; // drafts 本地文件也需加载（草稿跨页回显）；上传仍单独排除
      await Promise.all(files.map(async (f) => {
        try{
          const r = await fetch('/api/data/' + subj + '/' + f + '.json', { cache:'no-store' });
          if(r.ok){ __fileCache__[f] = await r.json(); }
        }catch(e){ /* 单文件失败不影响其它 */ }
      }));
      // 全局文件（不按科目分目录）
      try{
        const mr = await fetch('/api/data/motto.json', { cache:'no-store' });
        if(mr.ok){ __fileCache__['motto'] = await mr.json(); }
      }catch(e){}
      // 2) 题库（按当前科目目录）
      const [cd, pp, ip] = await Promise.all([
        fetch('/api/data/' + subj + '/chapters.json', { cache:'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/data/' + subj + '/papers.json', { cache:'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/data/' + subj + '/intensive.json', { cache:'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if(cd){
        APP.subject = cd.subject;
        if(!metaLoaded && Array.isArray(cd.subjects) && cd.subjects.length){
          subjects.length = 0;
          cd.subjects.forEach(s => subjects.push(s));
          APP.subjects = cd.subjects;
        }
        APP.answerStatus = cd.answerStatus || [];
        APP.verifiedCount = cd.verifiedCount || 0;
        APP.chapters = cd.chapters || {};
      }
      if(pp){ APP.papers = pp; }
      if(ip){ APP.intensivePapers = ip; }
      // 3) 一次性迁移：
      //    a) localStorage 旧中文科目后缀 key（sessions_会计）→ 新 id 后缀（sessions_accounting）
      //    b) localStorage 中业务 key 若不在文件缓存里，并入文件缓存并落盘，data/ 即唯一真相
      try{
        const snapKeys = [];
        for(let i = 0; i < window.localStorage.length; i++){ snapKeys.push(window.localStorage.key(i)); }
        let needFlush = false;
        const toRemove = [];
        for(const orig of snapKeys){
          let k = orig;
          for(const p in __FILE_MAP__){
            if(k.indexOf(p) === 0){
              const suffix = k.slice(p.length);
              if(SUBJ_NAME_TO_ID[suffix]){ k = p + SUBJ_NAME_TO_ID[suffix]; break; }
            }
          }
          const f = __fileOfKey__(k);
          if(!f) continue;
          if(k !== orig){
            const v = window.localStorage.getItem(orig);
            if(v != null){
              try{ __fileCache__[f][k] = JSON.parse(v); }catch(e){ __fileCache__[f][k] = v; }
              try{ window.localStorage.setItem(k, v); }catch(e){}
              toRemove.push(orig);
            }
            __scheduleFlush__(f);
            needFlush = true;
          } else if(!Object.prototype.hasOwnProperty.call(__fileCache__[f], k)){
            const v = window.localStorage.getItem(k);
            if(v != null){
              try{ __fileCache__[f][k] = JSON.parse(v); }catch(e){ __fileCache__[f][k] = v; }
              __scheduleFlush__(f);
              needFlush = true;
            }
          }
        }
        toRemove.forEach(kk => { try{ window.localStorage.removeItem(kk); }catch(e){} });
        if(needFlush) __flushAll__(false);
      }catch(e){ /* 迁移失败不影响主流程 */ }
    }catch(e){ /* 任何错误都静默降级到 localStorage 行为 */ }
  }
  // 把当前学习记录导出为 history.js（练习历史/收藏/草稿/主观判分/错题掌握态全部含在内）。
  // 放进本文件夹覆盖同名文件即可下次自动加载；也可另存 D 盘备份、换机后「导入记录」恢复。
  function saveHistoryFile(){
    const data = {};
    collectBackupKeys().forEach(k => { try{ const v = store.get(k); if(v != null) data[k] = v; }catch(e){} });
    if(!Object.keys(data).length){ alert('当前没有可保存的学习记录。'); return; }
    const payload = { app:'cpa-quiz-history', version:1, subject:APP.subject || 'accounting', exportedAt:new Date().toISOString(), data };
    const blob = new Blob(['window.QUIZ_HISTORY = ' + JSON.stringify(payload, null, 2) + ';'], { type:'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'history.js';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    alert('已生成 history.js（含练习历史与错题）。\n请把它保存到「刷题软件」文件夹（覆盖同名文件），下次打开会自动加载；也可另存到 D 盘作备份。');
  }
  // 从任意位置选择 history.js / 备份 JSON 导入恢复（换机、或没放到文件夹时用手动导入）。
  function loadHistoryFile(){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.json,application/javascript,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try{
          const raw = String(reader.result || '');
          const m = raw.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/); // 兼容 .js（window.QUIZ_HISTORY = {...}）与纯 .json
          const payload = JSON.parse(m ? m[1] : raw);
          const r = mergeBackupPayload(payload);
          if(!r){ alert('这不是本软件的学习记录文件（缺少 app 标识或数据字段）。'); return; }
          const ok = confirm('学习记录导入完成：合并 ' + r.merged + ' 类数据（科目：' + (r.subject || '—') + '，生成于 ' + (r.time || '—') + '）。\n是否立即刷新页面以应用？');
          if(ok) location.reload();
        }catch(e){ alert('文件解析失败，请确认选择了正确的学习记录文件。'); }
      };
      reader.onerror = () => alert('读取文件失败。');
      reader.readAsText(file, 'utf-8');
    });
    document.body.appendChild(input);
    input.click();
  }
  // 错题快照：从历史实时派生，导出为独立 wrong.json（一次性快照，不实时同步，便于单独存档/打印）。
  function exportWrongSnapshot(){
    const all = getQuestions().filter(q => isWrong(q));
    if(!all.length){ alert('当前没有错题可导出。'); return; }
    const list = all.map(q => ({
      uid: q._uid, chapter: q.chapter, section: q.section, type: q.type,
      stem: q.stem, options: q.options, answer: q.answer, lastAnswer: getLastAnswerFor(q._uid)
    }));
    const blob = new Blob([JSON.stringify({ app:'cpa-quiz-wrong', version:1, subject:APP.subject || 'accounting', exportedAt:new Date().toISOString(), count: list.length, questions: list }, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '错题快照_' + getSubject() + '_' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function initBackupUI(){
    const sidebar = document.querySelector('.sidebar');
    if(!sidebar || document.getElementById('sb-backup')) return;
    const foot = sidebar.querySelector('.sb-foot');
    const wrap = document.createElement('div');
    wrap.id = 'sb-backup';
    wrap.style.cssText = 'padding:10px 16px 12px;border-top:1px solid var(--color-border,#E6E8EB);display:flex;gap:8px;flex-wrap:wrap';
    wrap.innerHTML =
      '<button id="btn-hist-save" type="button" title="把学习记录（练习历史/收藏/错题等）导出为 history.js，放入本文件夹即自动恢复" style="flex:1;min-width:84px;padding:7px 8px;border:1px solid var(--color-border,#E6E8EB);border-radius:8px;background:var(--color-surface,#fff);color:var(--color-text-secondary,#475569);font-size:12px;cursor:pointer">保存记录</button>' +
      '<button id="btn-hist-load" type="button" title="从 history.js / 备份 JSON 导入恢复学习记录" style="flex:1;min-width:84px;padding:7px 8px;border:1px solid var(--color-border,#E6E8EB);border-radius:8px;background:var(--color-surface,#fff);color:var(--color-text-secondary,#475569);font-size:12px;cursor:pointer">导入记录</button>' +
      '<button id="btn-wrong-export" type="button" title="把当前错题导出为独立快照 JSON（一次性，不实时同步）" style="flex:1;min-width:84px;padding:7px 8px;border:1px solid var(--color-border,#E6E8EB);border-radius:8px;background:var(--color-surface,#fff);color:var(--color-text-secondary,#475569);font-size:12px;cursor:pointer">导出错题</button>';
    if(foot) foot.parentNode.insertBefore(wrap, foot); else sidebar.appendChild(wrap);
    const sb = document.getElementById('btn-hist-save');
    const lb = document.getElementById('btn-hist-load');
    const we = document.getElementById('btn-wrong-export');
    if(sb) sb.addEventListener('click', saveHistoryFile);
    if(lb) lb.addEventListener('click', loadHistoryFile);
    if(we) we.addEventListener('click', exportWrongSnapshot);
  }

  // 导入历史回灌：把题库中每题自带的 user_answer 作为「导入历史」归档。
  // 改为「增量回灌」——只补那些尚未被任何历史 session 覆盖的 uid，
  // 这样后续新增题目（如补库的 17-21 关无形资产 / 85-87 关政府补助）也能自动进入练习历史，
  // 而不会因首次迁移已跑过被永久跳过。幂等：已覆盖的 uid 不会重复写入。
  function migrateImportedAnswers(){
    const covered = {};
    getSessions().forEach(s => { if(s.answers && typeof s.answers === 'object') Object.keys(s.answers).forEach(u => { covered[u] = true; }); });
    const ans = {};
    let has = false;
    getQuestions().forEach(q => {
      if(q._uid && q.user_answer && String(q.user_answer).trim() && !covered[q._uid]){
        ans[q._uid] = String(q.user_answer).trim();
        has = true;
      }
    });
    if(!has) return;
    const sess = {
      id: 'sess_imported_' + Date.now(),
      mode: 'imported',
      chapter: '导入历史', section: '',
      startTime: Date.now(), endTime: Date.now(),
      elapsed: 0, submitted: true,
      answers: ans
    };
    const arr = getSessions(); arr.push(sess); saveSessions(arr);
  }

  // ============ 练习历史「查看解析」题目流（与章节训练一致，只读不可作答） ============
  function renderHistoryFlow(s, qs){
    const typeLabel = { single: '单选', multi: '多选', judge: '判断', subjective: '计算分析题 / 综合题' };
    const list = qs.filter(q => q._uid && s.answers && s.answers[q._uid]);
    if(!list.length) return '<div class="hist-flow-sum" style="margin-bottom:0">本次作答暂无可校验题目</div>';
    let html = '';
    let n = 0;
    list.forEach(q => {
      n++;
      const ans = (s.answers[q._uid] || '').trim();
      const isSub = isSubjective(q);
      let optsHtml, verdictHtml;
      if(isSub){
        optsHtml = '<div class="subj-box"><label>你的作答（只读）</label><textarea rows="6" disabled>' + escapeHtml(ans || '') + '</textarea></div>';
        const g = getManualGrade(q._uid);
        const stateTxt = g ? (g.state === 'correct' ? '判对' : '判错') : '待手动判分';
        verdictHtml = '<div class="verdict is-pending"><span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 11.4v4.4M12 8v.2"/></svg></span>' +
          '<div><div class="t">' + stateTxt + '</div><div class="d">' + (g ? ('本题得分 ' + (g.score || 0) + ' 分') : '分析题／综合题需对照答案手动评定，系统不自动计入得分。') + '</div></div>' +
          '<div class="sp"><span>标准答案 <b>' + escapeHtml(isVerified(q) ? (q.answer || '—') : '待校验') + '</b></span></div></div>';
      } else {
        const uaSet = new Set(ans.toUpperCase().split(''));
        optsHtml = Object.entries(q.options || {}).map(([k, v]) => {
          const cls = ['opt'];
          const picked = uaSet.has(k.toUpperCase());
          const isRight = q.answer && q.answer.toUpperCase().indexOf(k.toUpperCase()) >= 0;
          let mk = '';
          if(isRight){ cls.push('is-right'); mk = '<span class="mk">正确答案</span>'; }
          if(picked && !isRight){ cls.push('is-wrong'); mk = '<span class="mk">你的答案</span>'; }
          else if(picked && isRight){ cls.push('is-pick'); }
          return '<div class="' + cls.join(' ') + '"><span class="k">' + k + '</span><span class="txt">' + fmtRich(v) + '</span>' + mk + '</div>';
        }).join('');
        let vcls = 'verdict', vt = '未作答', vd = '本题未选择答案，正确答案与解析如下。', vsp = '标准答案 <b>' + escapeHtml(isVerified(q) ? (q.answer || '—') : '待校验') + '</b>';
        let ic = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 11.4v4.4M12 8v.2"/></svg>';
        if(ans){
          const r = isVerified(q) ? judgeOne(q, ans) : { state: 'pending' };
          if(r.state === 'correct'){ vcls += ' is-right'; vt = '回答正确'; vd = '本题作答正确。'; ic = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>'; vsp = '你的作答 <b>' + escapeHtml(ans) + '</b> · 标准答案 <b>' + escapeHtml(q.answer || '—') + '</b>'; }
          else if(r.state === 'wrong'){ vcls += ' is-wrong'; vt = '回答错误'; vd = '本题判为错误。'; ic = '<svg viewBox="0 0 24 24"><path d="M17 7 7 17M7 7l10 10"/></svg>'; vsp = '你的作答 <b>' + escapeHtml(ans) + '</b> · 标准答案 <b>' + escapeHtml(q.answer || '—') + '</b>'; }
          else { vcls += ' is-pending'; vt = '待校验'; vd = '本题暂无标准答案，不计入得分。'; vsp = '你的作答 <b>' + escapeHtml(ans) + '</b> · 标准答案 <b>待校验</b>'; }
        }
        verdictHtml = '<div class="' + vcls + '"><span class="ic">' + ic + '</span><div><div class="t">' + vt + '</div><div class="d">' + vd + '</div></div><div class="sp">' + vsp + '</div></div>';
      }
      let stem = (q.stem || '').replace(/^\s*\d+\s*[、.]\s*/, '');
      html += '<article class="q-card hist-q">' +
        '<div class="q-head"><span class="q-no">' + qNo(q, n - 1) + '</span>' +
          '<span class="tag tag-gray">' + (typeLabel[q.type] || '题') + '</span>' +
          (ans ? '<span class="meta">你的答案 <b>' + escapeHtml(ans) + '</b></span>' : '<span class="meta">未作答</span>') +
        '</div>' +
        '<div class="stem">' + fmtRich(stem) + '</div>' +
        '<div class="opts">' + optsHtml + '</div>' +
        verdictHtml +
        (q.analysis ? '<div class="exp">' + fmtRich(q.analysis) + '</div>' : '') +
      '</article>';
    });
    return html;
  }

  // ============ 练习历史（独立页面：history-page 容器由 renderer.js 渲染） ============
  function renderPracticeHistory(){
    const page = document.getElementById('history-page');
    if(!page) return;
    const baseQs = getQuestions();
    // 套卷记录（mode=paper）用对应套卷题渲染（题目字段完整、uid 与作答一致）；其他模式用当前题库
    function qsFor(s){
      if(s.mode === 'paper'){
        for(const pid of [s.paperId, s.chapter]){
          if(pid){ try{ const pq = getPaperQuestions(pid); if(pq && pq.length) return pq; }catch(e){} }
        }
        // 题库取不到时，用交卷时存下的题目快照兜底（uid→_uid）
        if(Array.isArray(s.questions) && s.questions.length){
          return s.questions.map(q => Object.assign({}, q, { _uid: q._uid || q.uid, verified: q.verified === true || (!!q.answer && isObjective(q)) }));
        }
      }
      return baseQs;
    }
    const byUid = {};
    baseQs.forEach(q => { if(q._uid) byUid[q._uid] = q; });

    // 按关统计总题数
    const sectionMap = {};
    baseQs.forEach(q => {
      const key = (q.chapter || '') + '||' + (q.section || '');
      sectionMap[key] = (sectionMap[key] || 0) + 1;
    });
    let totalSections = 0;
    Object.values(APP.chapters || {}).forEach(ch => {
      Object.entries(ch.sections || {}).forEach(([secTitle, sec]) => {
        if((sec.questions || []).length > 0) totalSections++;
      });
    });

    const sessions = getSessions();
    const todayStr = (function(){
      const d = new Date();
      return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
    })();
    function dateStr(ts){
      if(!ts) return '';
      const d = new Date(ts);
      return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
    }

    // 先按模式+日期筛选（练习历史只展示已交卷记录；未交卷仅作记忆，不体现在历史）
    let filtered = sessions.filter(s => {
      if(s.submitted !== true) return false;
      if(historyModeFilter !== 'all' && s.mode !== historyModeFilter) return false;
      if(historyDateFilter === 'today' && dateStr(s.endTime || s.startTime) !== todayStr) return false;
      return true;
    });

    // 导入历史：把一条 171 题的大记录按关拆成多条；其他模式保持原样
    const expanded = [];
    filtered.forEach(s => {
      if(s.mode === 'imported' && s.answers){
        const bySection = {};
        Object.entries(s.answers).forEach(([uid, ans]) => {
          const q = byUid[uid];
          if(!q) return;
          const key = (q.chapter || '') + '||' + (q.section || '');
          if(!bySection[key]) bySection[key] = {};
          bySection[key][uid] = ans;
        });
        Object.entries(bySection).forEach(([key, ansMap]) => {
          const [ch, sec] = key.split('||');
          expanded.push({ ...s, id: s.id, chapter: ch, section: sec, mode: 'imported', answers: ansMap });
        });
      } else {
        expanded.push(s);
      }
    });

    // 按关聚合：同一关取最新一次记录；无section的会话（如错题随机训练）按会话ID单独成列
    const groups = {};
    expanded.forEach(s => {
      const hasScope = !!(s.chapter || s.section);
      const key = hasScope ? ((s.chapter || '') + '||' + (s.section || '')) : ('sess:' + s.id);
      if(!groups[key] || (s.endTime || s.startTime) > (groups[key].endTime || groups[key].startTime)){
        groups[key] = s;
      }
    });
    const list = Object.values(groups).sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime));

    const modeNames = { all: '全部', chapter: '章节训练', wrong_random: '错题训练', exam: '全真模考', paper: '冲刺模考', imported: '导入历史' };

    function pad(n){ return n < 10 ? '0' + n : '' + n; }
    function fmtDateTime(ts){
      if(!ts) return '—';
      const d = new Date(ts);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function accuracyRing(pct){
      const R = 26, C = 2 * Math.PI * R;
      const color = pct === null ? '#CBD5E1' : (pct >= 60 ? 'var(--color-success)' : 'var(--color-danger)');
      const dash = pct === null ? 0 : (C * pct / 100);
      const show = pct === null ? '—' : pct.toFixed(1);
      return '<div class="accuracy-ring"><svg width="58" height="58" viewBox="0 0 58 58"><circle cx="29" cy="29" r="' + R + '" fill="none" stroke="#E6E8EB" stroke-width="4"/><circle cx="29" cy="29" r="' + R + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-dasharray="' + dash + ' ' + C + '" stroke-linecap="round" style="transition:stroke-dasharray .4s"/></svg><div class="pct">' + show + '<small>%</small></div></div>';
    }

    // 练习历史统计：只看已交卷记录；「累计题数」为这些记录共作答的题目数
    const completed = list.filter(s => s.submitted).length;
    const totalAnswered = list.filter(s => s.submitted).reduce((n, s) => n + Object.keys(s.answers || {}).length, 0);

    let listHtml = '';
    list.forEach((s, idx) => {
      let answered = 0, correct = 0, wrong = 0, pending = 0, objCorrect = 0;
      const sByUid = {};
      qsFor(s).forEach(q => { if(q._uid) sByUid[q._uid] = q; });
      Object.entries(s.answers || {}).forEach(([uid, ans]) => {
        if(!ans) return;
        answered++;
        const q = sByUid[uid];
        if(!q) return;
        const r = judgeOne(q, ans);
        if(r.state === 'correct'){ correct++; if(isObjective(q)) objCorrect++; }
        else if(r.state === 'wrong'){ wrong++; }
        else if(r.state === 'pending'){ pending++; }
      });
      const key = (s.chapter || '') + '||' + (s.section || '');
      const total = (key !== '||' && sectionMap[key]) ? sectionMap[key] : answered;
      const undone = Math.max(0, total - answered);
      const denom = correct + wrong;
      const acc = denom ? (correct / denom * 100) : null;
      const when = fmtDateTime(s.endTime || s.startTime);
      const dur = s.elapsed ? fmtSec(s.elapsed) : (s.startTime && s.endTime ? fmtSec(Math.round((s.endTime - s.startTime) / 1000)) : '—');
      const modeName = modeNames[s.mode] || '章节训练';
      const title = s.section ? ((s.chapter || '') + ' ' + s.section)
        : (s.mode === 'wrong_random' ? '错题随机训练'
          : (s.mode === 'exam' ? '全真模考'
            : (s.mode === 'paper' ? (s.chapter || '冲刺模考套卷')
              : (s.mode === 'imported' ? '导入历史' : (s.chapter || '章节训练')))));
      const flowSum = '<div class="hist-flow-sum">' +
        '<span>共<b>' + total + '</b>题</span>' +
        '<span>已做<b>' + answered + '</b>题</span>' +
        '<span>未做<b>' + undone + '</b>题</span>' +
        '<span>客观题答对<b>' + objCorrect + '</b>题</span>' +
        (acc !== null ? '<span class="fs-rate ' + (acc >= 60 ? 'good' : 'bad') + '">正确率<b>' + acc.toFixed(1) + '%</b></span>' : '') +
        '</div>';
      const detailHtml = flowSum + renderHistoryFlow(s, qsFor(s));
      const unsubTip = s.submitted ? '' : '<span style="color:var(--color-primary-strong)">未交卷</span>';

      listHtml +=
        '<div class="hist-row-card" data-idx="' + idx + '">' +
          '<div class="hist-icon"><svg viewBox="0 0 24 24"><path d="M14 3.2H7.4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V7.8z"/><path d="M14 3.2v4.6h4.6"/><path d="M8.8 13h6.4M8.8 16.6h4.2"/></svg></div>' +
          '<div class="hist-info">' +
            '<div class="hist-title"><span class="mode-chip">' + escapeHtml(modeName) + '</span><span class="title-text">' + escapeHtml(title) + '</span></div>' +
            '<div class="hist-meta">' +
              '<span>' + when + '</span>' +
              '<span>做题时长：' + dur + '</span>' +
              '<span>共<b>' + total + '</b>题，已做<b>' + answered + '</b>题，未做<b>' + undone + '</b>题</span>' +
              '<span>客观题答对<b>' + objCorrect + '</b>题</span>' +
              unsubTip +
            '</div>' +
          '</div>' +
          '<div class="hist-right">' + accuracyRing(acc) + '<a class="btn-outline" href="' + buildReviewHref(s) + '" target="_blank">查看解析</a></div>' +
        '</div>';
    });

    const emptyHtml = '<div class="history-empty"><p>当前筛选下暂无练习记录。</p>' +
      (historyDateFilter === 'today' ? '<p>今日还没有交卷记录，可切换至「全部」日期查看历史。</p><p><button class="btn btn-secondary" id="hist-show-all">查看全部</button></p>' : '<p>去 <a href="题刷刷.html#practice">章节训练</a> 或 <a href="题刷刷.html?mode=wrong_random#practice">错题随机训练</a> 做一组，交卷后会自动归档到这里。</p>') +
      '</div>';

    page.innerHTML =
      '<div class="history-summary">' +
        '<div class="history-sum-item is-active"><span>已完成</span><span class="n">' + completed + '</span></div>' +
        '<div class="history-sum-item"><span>累计题数</span><span class="n">' + totalAnswered + '</span></div>' +
      '</div>' +
      '<div class="history-main">' +
        '<div class="history-tabs">' +
          '<button class="history-tab ' + (historyModeFilter === 'all' ? 'is-active' : '') + '" data-mode="all">全部</button>' +
          '<button class="history-tab ' + (historyModeFilter === 'chapter' ? 'is-active' : '') + '" data-mode="chapter">章节训练</button>' +
          '<button class="history-tab ' + (historyModeFilter === 'wrong_random' ? 'is-active' : '') + '" data-mode="wrong_random">错题训练</button>' +
          '<button class="history-tab ' + (historyModeFilter === 'exam' ? 'is-active' : '') + '" data-mode="exam">全真模考</button>' +
          '<button class="history-tab ' + (historyModeFilter === 'paper' ? 'is-active' : '') + '" data-mode="paper">冲刺模考</button>' +
          '<button class="history-tab ' + (historyModeFilter === 'imported' ? 'is-active' : '') + '" data-mode="imported">导入历史</button>' +
        '</div>' +
        '<div class="history-datefilter"><span>日期：</span>' +
          '<button class="' + (historyDateFilter === 'today' ? 'is-active' : '') + '" data-date="today">今日</button>' +
          '<button class="' + (historyDateFilter === 'all' ? 'is-active' : '') + '" data-date="all">全部</button>' +
        '</div>' +
        '<div class="history-list">' + (listHtml || emptyHtml) + '</div>' +
      '</div>';

    // 绑定模式/日期筛选（重渲染自身）
    page.querySelectorAll('.history-tab[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        historyModeFilter = btn.getAttribute('data-mode') || 'all';
        renderPracticeHistory();
      });
    });
    page.querySelectorAll('.history-datefilter button[data-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        historyDateFilter = btn.getAttribute('data-date') || 'today';
        renderPracticeHistory();
      });
    });
    const showAllBtn = document.getElementById('hist-show-all');
    if(showAllBtn) showAllBtn.addEventListener('click', () => {
      historyDateFilter = 'all';
      renderPracticeHistory();
    });
    // 查看解析：点击整行或按钮均打开新页面（链接已自带 target="_blank"）
    page.querySelectorAll('.hist-row-card').forEach(card => {
      card.addEventListener('click', e => {
        if(e.target.closest('a')) return;
        const link = card.querySelector('a[href^="#review"]');
        if(link) window.open(link.href, '_blank');
      });
    });
  }

  // ============ 解析复盘页（#review） ============
  function getSidFromUrl(){
    try {
      const url = new URL(location.href);
      return url.searchParams.get('sid');
    } catch(e) {
      const m = (location.search || '').match(/[?&]sid=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    }
  }
  // 构造解析复盘页链接：把本次练习记录(含答案)内嵌进 URL，保证新窗口/跨页都能独立渲染
  function buildReviewHref(s){
    try {
      const p = encodeURIComponent(JSON.stringify({
        id: s.id, mode: s.mode, chapter: s.chapter, section: s.section,
        paperId: s.paperId, answers: s.answers, startTime: s.startTime, endTime: s.endTime,
        elapsed: s.elapsed, submitted: s.submitted
      }));
      return '#review?sid=' + encodeURIComponent(s.id || '') + '&p=' + p;
    } catch(e) {
      return '#review?sid=' + encodeURIComponent(s.id || '');
    }
  }

  function renderHistoryReview(){
    const container = document.getElementById('review-flow');
    if(!container) return;
    // 参数可能放在 hash 内（#review?p=...）或 location.search（?p=...）中，两种都兼容读取
    function reviewParam(name){
      try{
        const h = location.hash || '';
        const m = h.match(new RegExp('[?&]' + name + '=([^&]+)'));
        if(m) return decodeURIComponent(m[1]);
      }catch(e){}
      try{ return new URLSearchParams(location.search).get(name); }catch(e){ return null; }
    }
    // 优先读取 URL 内嵌的练习记录(新窗口/跨页独立可用)；否则回退到按 sid 查 localStorage
    let s = null;
    // 优先按 sid 从本机 sessions 取完整记录（含 paperId 与题目快照，复盘渲染最完整）；p 内嵌 JSON 作兜底
    const sid = reviewParam('sid');
    if(sid){ const sessions = getSessions(); s = sessions.find(x => x.id === sid); }
    if(!s){ const pRaw = reviewParam('p'); if(pRaw){ try { s = JSON.parse(pRaw); } catch(e){ s = null; } } }
    if(!s){
      container.innerHTML = '<div class="history-empty"><p>未找到该练习记录。</p><p><a href="#history">返回练习历史</a></p></div>';
      return;
    }
    let qsrc = getQuestions();
    // 套卷记录（mode=paper）：用对应套卷题渲染，否则在章节题库里取不到 paper 题 → 复盘页空白
    if(s.mode === 'paper'){
      let pq = null;
      for(const pid of [s.paperId, s.chapter]){
        if(pid){ try{ pq = getPaperQuestions(pid); if(pq && pq.length) break; }catch(e){ pq = null; } }
      }
      if(pq && pq.length){ qsrc = pq; }
      else if(Array.isArray(s.questions) && s.questions.length){
        // 题库取不到（套卷更名/题库版本变化/旧数据）时，用交卷时存下的题目快照兜底（uid→_uid），客观题补 verified
        qsrc = s.questions.map(q => Object.assign({}, q, { _uid: q._uid || q.uid, verified: q.verified === true || (!!q.answer && isObjective(q)) }));
      }
    }
    const byUid = {};
    qsrc.forEach(q => { if(q._uid) byUid[q._uid] = q; });

    // 决定题目范围：章节/关训练 -> 该关全部题；错题随机训练 -> 仅作答过的题
    let list = [];
    if(s.chapter && s.section){
      list = qsrc.filter(q => q.chapter === s.chapter && q.section === s.section);
    } else {
      list = qsrc.filter(q => q._uid && s.answers && s.answers[q._uid] != null);
    }
    // 保持原题序
    list = list.slice().sort((a, b) => {
      const ai = Number((a._uid.match(/\|\|(\d+)$/) || [,'0'])[1]);
      const bi = Number((b._uid.match(/\|\|(\d+)$/) || [,'0'])[1]);
      return ai - bi;
    });

    const typeLabel = { single: '单选', multi: '多选', judge: '判断', subjective: '计算分析题 / 综合题' };
    let answered = 0, correct = 0, wrong = 0, pending = 0, objCorrect = 0, undone = 0;
    let flowHtml = '';

    // 答题卡分组数据
    const groups = [];
    let curType = null, curGroup = null;

    list.forEach((q, idx) => {
      const n = idx + 1;
      const ans = (s.answers && s.answers[q._uid] || '').trim();
      const isSub = isSubjective(q);
      let state = 'un';
      if(ans){
        answered++;
        const r = isVerified(q) ? judgeOne(q, ans) : { state: 'pending' };
        if(r.state === 'correct'){ correct++; state = 'ok'; if(isObjective(q)) objCorrect++; }
        else if(r.state === 'wrong'){ wrong++; state = 'no'; }
        else { pending++; state = 'pd'; }
      } else {
        undone++;
      }

      // 分组
      const t = q.type || 'single';
      if(t !== curType){ curType = t; curGroup = { type: t, items: [] }; groups.push(curGroup); }
      curGroup.items.push({ n, state });

      // 选项与判定
      let optsHtml, verdictHtml;
      if(isSub){
        optsHtml = '<div class="subj-box"><label>你的作答（只读）</label><textarea rows="6" disabled>' + escapeHtml(ans || '') + '</textarea></div>';
        const g = getManualGrade(q._uid);
        const stateTxt = g ? (g.state === 'correct' ? '判对' : '判错') : '待手动判分';
        verdictHtml = '<div class="verdict is-pending"><span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 11.4v4.4M12 8v.2"/></svg></span>' +
          '<div><div class="t">' + stateTxt + '</div><div class="d">' + (g ? ('本题得分 ' + (g.score || 0) + ' 分') : '分析题／综合题需对照答案手动评定，系统不自动计入得分。') + '</div></div>' +
          '<div class="sp"><span>标准答案 <b>' + escapeHtml(isVerified(q) ? (q.answer || '—') : '待校验') + '</b></span></div></div>';
      } else {
        const uaSet = new Set(ans.toUpperCase().split(''));
        optsHtml = Object.entries(q.options || {}).map(([k, v]) => {
          const cls = ['opt'];
          const picked = uaSet.has(k.toUpperCase());
          const isRight = q.answer && q.answer.toUpperCase().indexOf(k.toUpperCase()) >= 0;
          let mk = '';
          if(isRight){ cls.push('is-right'); mk = '<span class="mk">正确答案</span>'; }
          if(picked && !isRight){ cls.push('is-wrong'); mk = '<span class="mk">你的答案</span>'; }
          else if(picked && isRight){ cls.push('is-pick'); }
          return '<div class="' + cls.join(' ') + '"><span class="k">' + k + '</span><span class="txt">' + fmtRich(v) + '</span>' + mk + '</div>';
        }).join('');
        let vcls = 'verdict', vt = '未作答', vd = '本题未选择答案，正确答案与解析如下。', vsp = '标准答案 <b>' + escapeHtml(isVerified(q) ? (q.answer || '—') : '待校验') + '</b>';
        let ic = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 11.4v4.4M12 8v.2"/></svg>';
        if(ans){
          const r = isVerified(q) ? judgeOne(q, ans) : { state: 'pending' };
          if(r.state === 'correct'){ vcls += ' is-right'; vt = '回答正确'; vd = '本题作答正确。'; ic = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>'; vsp = '你的作答 <b>' + escapeHtml(ans) + '</b> · 标准答案 <b>' + escapeHtml(q.answer || '—') + '</b>'; }
          else if(r.state === 'wrong'){ vcls += ' is-wrong'; vt = '回答错误'; vd = '本题判为错误。'; ic = '<svg viewBox="0 0 24 24"><path d="M17 7 7 17M7 7l10 10"/></svg>'; vsp = '你的作答 <b>' + escapeHtml(ans) + '</b> · 标准答案 <b>' + escapeHtml(q.answer || '—') + '</b>'; }
          else { vcls += ' is-pending'; vt = '待校验'; vd = '本题暂无标准答案，不计入得分。'; vsp = '你的作答 <b>' + escapeHtml(ans) + '</b> · 标准答案 <b>待校验</b>'; }
        }
        verdictHtml = '<div class="' + vcls + '"><span class="ic">' + ic + '</span><div><div class="t">' + vt + '</div><div class="d">' + vd + '</div></div><div class="sp">' + vsp + '</div></div>';
      }
      let stem = (q.stem || '').replace(/^\s*\d+\s*[、.]\s*/, '');
      flowHtml += '<article class="q-card hist-q" id="q-idx-' + n + '">' +
        '<div class="q-head"><span class="q-no">' + qNo(q, n - 1) + '</span>' +
          '<span class="tag tag-gray">' + (typeLabel[q.type] || '题') + '</span>' +
          (ans ? '<span class="meta">你的答案 <b>' + escapeHtml(ans) + '</b></span>' : '<span class="meta">未作答</span>') +
        '</div>' +
        '<div class="stem">' + fmtRich(stem) + '</div>' +
        '<div class="opts locked">' + optsHtml + '</div>' +
        verdictHtml +
        (q.analysis ? '<div class="exp">' + fmtRich(q.analysis) + '</div>' : '') +
      '</article>';
    });

    if(!list.length){
      container.innerHTML = '<div class="history-empty"><p>本次记录暂无题目可解析。</p></div>';
      return;
    }

    container.innerHTML = flowHtml;

    // 左侧训练情况
    const modeNames = { chapter: '初出茅庐', wrong_random: '小有成就', exam: '全真模考', paper: '冲刺模考', imported: '导入历史' };
    const denom = correct + wrong;
    const acc = denom ? (correct / denom * 100) : null;
    const titleScope = s.section ? (s.chapter + ' ' + s.section) : (s.mode === 'wrong_random' ? '错题随机训练' : (s.mode === 'exam' ? '全真模考' : (s.mode === 'paper' ? (s.chapter || '冲刺模考') : '导入历史')));
    document.getElementById('tb-scope').textContent = titleScope;
    document.getElementById('info-mode').textContent = modeNames[s.mode] || '章节训练';
    document.getElementById('info-chapter').textContent = s.chapter || '—';
    document.getElementById('info-section').textContent = s.section || '—';
    document.getElementById('info-total').textContent = list.length;
    document.getElementById('info-done').textContent = answered + ' / ' + list.length;
    document.getElementById('info-undone').textContent = undone;
    document.getElementById('info-obj').textContent = objCorrect;
    document.getElementById('info-rate').textContent = acc !== null ? acc.toFixed(1) + '%' : '—';

    // 右侧摘要
    document.getElementById('right-rate').textContent = acc !== null ? acc.toFixed(1) + '%' : '—';
    document.getElementById('right-rate-bar').style.width = (acc !== null ? acc : 0) + '%';
    document.getElementById('right-ok').textContent = correct;
    document.getElementById('right-no').textContent = wrong;

    // 答题卡
    const typeNames = { single: '单项选择题', multi: '多项选择题', judge: '判断题', subjective: '计算分析题 / 综合题' };
    let sheetHtml = '';
    groups.forEach(g => {
      sheetHtml += '<div class="sheet-group"><div class="sheet-group-h">' + (typeNames[g.type] || '题目') + '<span>' + g.items.length + ' 题</span></div><div class="sheet">' +
        g.items.map(it => '<div class="cell ' + it.state + '" data-idx="' + it.n + '" title="第 ' + it.n + ' 题">' + it.n + '</div>').join('') +
        '</div></div>';
    });
    document.getElementById('sheet').innerHTML = sheetHtml;
    document.getElementById('sheet-sp').textContent = list.length + ' 题';
    document.querySelector('.sheet-top .big').textContent = answered;
    document.querySelector('.sheet-top .tot').textContent = '/ ' + list.length;
    document.getElementById('sheet-rate').innerHTML = '已作答 <b>' + answered + '</b>';

    // 绑定答题卡滚动
    document.querySelectorAll('#sheet .cell[data-idx]').forEach(cell => {
      cell.addEventListener('click', () => {
        const target = document.getElementById('q-idx-' + cell.getAttribute('data-idx'));
        if(target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // 高亮当前可视题到答题卡（浏览器支持 IntersectionObserver 时启用）
    if(typeof IntersectionObserver !== 'undefined'){
      const observer = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if(en.isIntersecting){
            const id = en.target.id.replace('q-idx-', '');
            document.querySelectorAll('#sheet .cell.cur').forEach(c => c.classList.remove('cur'));
            const cur = document.querySelector('#sheet .cell[data-idx="' + id + '"]');
            if(cur) cur.classList.add('cur');
          }
        });
      }, { root: null, rootMargin: '-40% 0px -40% 0px', threshold: 0 });
      list.forEach((_, idx) => {
        const el = document.getElementById('q-idx-' + (idx + 1));
        if(el) observer.observe(el);
      });
    }
  }

  // ============ Init ============
  
// ===== SPA 路由（合并单页 题刷刷.html）=====
const VIEW_MAP = {
  dashboard: { render: () => { renderLearnCenter(); }, title: '学习中心' },
  redbook:   { render: () => { renderRedBook(); }, title: '小小红书' },
  chapter:   { render: () => { renderChapters(); }, title: '章节训练' },
  practice:  { render: () => { renderPractice(); }, title: '做题' },
  wrong:     { render: () => { renderWrongQuestions(); }, title: '错题本' },
  favorites: { render: () => { renderFavorites(); }, title: '收藏' },
  'error-corrected': { render: () => { renderErrorCorrected(); }, title: '待纠错' },
  history:   { render: () => { renderPracticeHistory(); }, title: '练习历史' },
  review:    { render: () => { renderHistoryReview(); }, title: '复盘' },
  note:      { render: () => { renderNotes(); }, title: '学习笔记' },
};
function getCurrentView(){
  const h = (location.hash || '').replace(/^#/, '').split('?')[0];
  return VIEW_MAP[h] ? h : 'dashboard';
}
function mountView(name){
  const root = document.getElementById('view-root');
  if(!root) return;
  document.body.classList.remove('mode-select');
  // 答题卡页面（真正做题中）不使用顶部黑底栏，恢复白色顶栏；选套卷页仍保留黑底
  const isSelectMode = /[?&]mode=select/.test(location.hash) || /[?&]mode=select/.test(location.search);
  document.body.classList.toggle('mode-practice', name === 'practice' && !isSelectMode);
  const tpl = document.getElementById('tpl-' + name);
  root.innerHTML = tpl ? tpl.innerHTML : '';
  if(name === 'practice'){
    const h = location.hash.replace(/^#/, '');
    const qi = h.indexOf('?');
    const q = qi >= 0 ? h.slice(qi + 1) : '';
    if(q) history.replaceState(null, '', location.pathname + '?' + q + '#practice');
  }
  const sub = (subjects || []).find(s => s.id === getSubject());
  const hasDataPage = root.querySelector('.ch-list') || root.querySelector('.wq-list') || root.querySelector('#sheet');
  // 无章节题库的科目仅拦截章节/错题/复盘类视图；学习中心(dashboard)/冲刺模考(practice)始终放行，
  // 学习中心作为总入口，即使当前科目无数据也要展示模块与科目选择。
  if(sub && !sub.hasData && hasDataPage && name !== 'dashboard' && name !== 'practice'){
    showEmpty();
    renderCountdown();
    return;
  }
  const v = VIEW_MAP[name] || VIEW_MAP.dashboard;
  v.render();
  renderBreadcrumbs();
  renderCountdown();
  ensureSplitter();
  window.scrollTo(0, 0);
}

document.addEventListener('DOMContentLoaded', async () => {
  if(__SUPABASE_MODE__){ try{ await (window.SupaStore || window.CloudStore).unlock(); }catch(e){} }
  await seedFromServer();           // Supabase/服务器模式拉取数据；文件模式跳过
  initSubjectSwitch();
  initSidebarToggle();
  initSidePanelToggles();
  syncSidebarActive();
  clearOrphanStateOnce();
  initBackupUI();
  initNotesUI();
  migrateImportedAnswers();
  initFileModeSubjects(); // 确保在渲染前重新计算 hasData
  const current = getSubject();
  const sub = subjects.find(s => s.id === current);
  applyTheme(current);
  updateSubjectTitle(sub);
  renderBreadcrumbs();
  renderSidebarStats();
  mountView(getCurrentView());
  window.addEventListener('hashchange', () => {
    syncSidebarActive();
    mountView(getCurrentView());
  });
  // 键盘快捷键：A/B/C/D选选项、Enter下一题、Esc关模态
  document.addEventListener('keydown', (e) => {
    // 输入框/文本域聚焦时不触发
    const tag = document.activeElement && document.activeElement.tagName;
    if(tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    // 只在练习页面生效
    if(getCurrentView() !== 'practice') return;
    const key = e.key.toUpperCase();
    // A/B/C/D选择选项
    if(['A','B','C','D','E','F'].includes(key) && !e.ctrlKey && !e.metaKey && !e.altKey){
      e.preventDefault();
      selectOption(key);
      return;
    }
    // Enter下一题
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      if(currentIndex < practiceQuestions.length - 1){
        goQuestion(currentIndex + 1);
      }
      return;
    }
    // Esc关闭模态框
    if(e.key === 'Escape'){
      closeModal();
    }
  });
});
  // 测试钩子：仅当显式开启测试模式(window.__QUIZ_TEST__=true)时暴露内部函数，正常使用无任何影响
  if(window.__QUIZ_TEST__){
    window.__quizInternals = { exportBackup, importBackup, mergeBackupPayload, collectBackupKeys, getQuestions, getHistoricalAnswersMap, clearOrphanStateOnce, seedFromServer, saveHistoryFile, loadHistoryFile, exportWrongSnapshot };
  }

})();
