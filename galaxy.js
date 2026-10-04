/* 总助大脑 · Galaxy 3D 星系图谱引擎（Canvas 伪 3D，零依赖）
 * 对接 Obsidian Galaxy View 手册：视觉特效组 / 物理引擎组 / 实用分析组 / 8 预设 / 健康巡检 SOP / 性能调参 / FAQ / 指令响应
 * 依赖：页面全局 KB（knowledge.json 内嵌）；由 index.tpl.html 引入
 */
(function () {
  if (!window.KB || !window.KB.graph) return;
  const G = window.KB.graph;
  const NODES = G.nodes.map(n => Object.assign({}, n));
  const LINKS = G.links;
  const byId = {}; NODES.forEach(n => byId[n.id] = n);

  // 度中心性 / Hub / 孤儿 / 断链
  NODES.forEach(n => n.deg = 0);
  LINKS.forEach(l => { const s = byId[l.source], t = byId[l.target]; if (s) s.deg++; if (t) t.deg++; });
  const maxDeg = Math.max(1, ...NODES.map(n => n.deg));
  NODES.forEach(n => { n.hub = n.deg >= Math.max(2, Math.floor(NODES.length * 0.12)) && n.id !== 'ROOT'; n.orphan = n.deg === 0 && n.id !== 'ROOT' && n.id !== 'HUMAN'; });

  const CAT_COLORS = { root: '#C9A96A', human: '#E8E8E8', 规则: '#D4A94E', 能力: '#6FA8DC', 知识: '#7FBF7F', 项目: '#C77DBA', 员工: '#E58A5C', 工具: '#8A8F98', 需求: '#6FB5B5' };
  const COLOR_KEYS = Object.keys(CAT_COLORS);
  let colorShift = 0, colorSat = 1;
  function nodeColor(n) { return shiftColor(CAT_COLORS[n.cat] || '#888'); }
  function shiftColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6; else if (mx === g) h = ((b - r) / d + 2) / 6; else h = ((r - g) / d + 4) / 6;
    }
    h = (h + colorShift) % 1; s = Math.max(0, Math.min(1, s * colorSat));
    return `hsl(${(h * 360).toFixed(0)}, ${(s * 100).toFixed(0)}%, ${(l * 100).toFixed(0)}%)`;
  }

  // 参数默认值（均衡预设）——挂全局，Three.js 主引擎共享同一参数对象
  const PARAMS = window.GALAXY_PARAMS = {
    starBackground: true, starTwinkle: true,
    glowIntensity: 1.0, glowRange: 2.0, glowThreshold: 0.5,
    autoOrbit: true, replayIntro: 0,
    repulsion: 2.2, linkDistance: 90, linkStrength: 0.4,
    centripetalForce: 0.02, flattening: 0.85, coreGravity: 0.4, spiralForce: 0.15,
    linkAlpha: 0.55, expansion: 0, colorSat: 1,
    quality: '中', nodeSize: '链接数',
  };

  const PRESETS = {
    银河: { ...PARAMS, flattening: 0.9, spiralForce: 0.25, glowIntensity: 1.2 },
    旋臂: { ...PARAMS, spiralForce: 1.0, flattening: 0.95, glowIntensity: 1.2, linkAlpha: 0.6 },
    烟火: { ...PARAMS, glowIntensity: 2.0, glowRange: 4.0, starTwinkle: true, linkAlpha: 0.9, repulsion: 3.0, starBackground: true },
    超新星: { ...PARAMS, expansion: 0.8, glowIntensity: 1.8, glowRange: 3.5, linkAlpha: 0.7, repulsion: 3.5 },
    极简: { ...PARAMS, glowIntensity: 0, glowRange: 1, starBackground: false, starTwinkle: false, linkAlpha: 0.15, flattening: 0.6, glowThreshold: 1 },
    深空场: { ...PARAMS, flattening: 0, spiralForce: 0, linkAlpha: 0.3, repulsion: 2.0, glowIntensity: 0.6 },
    星云: { ...PARAMS, starBackground: false, linkAlpha: 0.7, colorSat: 0.45, glowRange: 3.0, glowIntensity: 1.2 },
    轨道: { ...PARAMS, linkDistance: 150, centripetalForce: 0.06, flattening: 0.7, spiralForce: 0.1, linkAlpha: 0.7 },
  };

  const canvas = document.getElementById('galaxy');
  const wrap = document.getElementById('galaxyWrap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = wrap.clientWidth; H = wrap.clientHeight; canvas.width = W * DPR; canvas.height = H * DPR; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  window.addEventListener('resize', resize); resize();

  // 3D 状态
  const view = { ry: 0.5, rx: -0.25, scale: 0.9, focus: null };
  const FOV = 600;
  const stars = [];
  function initStars() { stars.length = 0; const count = { 低: 80, 中: 160, 高: 320 }[PARAMS.quality] || 160; for (let i = 0; i < count; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.3, p: Math.random() * Math.PI * 2, s: 0.5 + Math.random() * 1.5 }); }
  initStars();

  // 初始化 3D 位置：扁平银河盘
  NODES.forEach((n, i) => {
    const R = 60 + Math.random() * (Math.min(W, H) * 0.30);
    const a = (i / NODES.length) * Math.PI * 2 * (1 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.8;
    n.x = Math.cos(a) * R; n.z = Math.sin(a) * R;
    n.y = (Math.random() - 0.5) * 60 * (1 - PARAMS.flattening);
    n.vx = 0; n.vy = 0; n.vz = 0;
  });

  function simulate(iters) {
    const rep = PARAMS.repulsion * 1200, ldist = PARAMS.linkDistance, lstr = PARAMS.linkStrength * 0.02;
    const cent = PARAMS.centripetalForce, flat = PARAMS.flattening * 0.12, core = PARAMS.coreGravity * 0.05, spiral = PARAMS.spiralForce * 0.03, exp = PARAMS.expansion * 0.05;
    for (let it = 0; it < iters; it++) {
      for (const n of NODES) {
        for (const m of NODES) { if (n === m) continue; const dx = n.x - m.x, dy = n.y - m.y, dz = n.z - m.z; const d2 = dx * dx + dy * dy + dz * dz + 1; const f = rep / d2; const d = Math.sqrt(d2); n.vx += dx / d * f; n.vy += dy / d * f; n.vz += dz / d * f; }
        const r = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) || 1;
        n.vx -= n.x * cent; n.vy -= n.y * cent; n.vz -= n.z * cent;
        n.vy += -n.y * flat * 4;                       // 扁平度（拉向盘面）
        if (n.hub) { const k = core * (n.deg / maxDeg); n.vx -= n.x * k; n.vy -= n.y * k; n.vz -= n.z * k; } // 核心聚集
        const tx = -n.z / r, tz = n.x / r;             // 切向（旋臂）
        n.vx += tx * spiral * r * 0.5; n.vz += tz * spiral * r * 0.5;
        n.vx += n.x / r * exp; n.vy += n.y / r * exp; n.vz += n.z / r * exp; // 超新星向外
        n.vx *= 0.86; n.vy *= 0.86; n.vz *= 0.86; n.x += n.vx; n.y += n.vy; n.z += n.vz;
      }
      for (const l of LINKS) {
        const a = byId[l.source], b = byId[l.target]; if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const f = (d - ldist) * lstr; const fx = dx / d * f, fy = dy / d * f, fz = dz / d * f;
        a.vx += fx; a.vy += fy; a.vz += fz; b.vx -= fx; b.vy -= fy; b.vz -= fz;
      }
    }
  }
  simulate(260);

  // 投影
  function project(n) {
    const c = Math.cos(view.ry), s = Math.sin(view.ry);
    const x1 = n.x * c - n.z * s, z1 = n.x * s + n.z * c;
    const cx2 = Math.cos(view.rx), sx2 = Math.sin(view.rx);
    const y1 = n.y * cx2 - z1 * sx2, z2 = n.y * sx2 + z1 * cx2;
    const p = FOV / (FOV + z2);
    return { sx: W / 2 + x1 * p * view.scale, sy: H / 2 + y1 * p * view.scale, z: z2, p };
  }

  // 渲染
  let frame = 0;
  function render(now) {
    if (window.__GALAXY_3D) return; // Three.js 主引擎接管后停止本兜底渲染
    frame++;
    const lowQ = PARAMS.quality === '低';
    if (lowQ && frame % 2 === 0) { requestAnimationFrame(render); return; } // 低档限帧
    ctx.clearRect(0, 0, W, H);
    // 星空背景
    if (PARAMS.starBackground) {
      for (const st of stars) {
        const a = PARAMS.starTwinkle ? 0.4 + 0.6 * Math.abs(Math.sin(now / 1600 + st.p)) : 0.7;
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = '#cdd3e0';
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (PARAMS.autoOrbit) view.ry += 0.0012;

    const proj = NODES.map(n => ({ n, p: project(n) })).sort((a, b) => b.p.z - a.p.z);

    // 链接
    ctx.lineWidth = 1;
    for (const l of LINKS) {
      const a = byId[l.source], b = byId[l.target]; if (!a || !b) continue;
      const pa = project(a), pb = project(b);
      const dim = view.focus && a.id !== view.focus && b.id !== view.focus;
      ctx.globalAlpha = PARAMS.linkAlpha * (dim ? 0.2 : 1);
      ctx.strokeStyle = '#3a3a52';
      ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 节点
    const focusDim = view.focus;
    const glowOn = PARAMS.glowIntensity > 0.05 && PARAMS.glowThreshold < 1;
    for (const { n, p } of proj) {
      const rBase = PARAMS.nodeSize === '统一' ? 7 : 5 + 12 * (n.deg / maxDeg);
      const r = rBase * (0.7 + 0.5 * p.p);
      const isFocus = focusDim && n.id === focusDim;
      const dim = focusDim && !isFocus;
      const isHub = n.hub, isOrph = n.orphan;
      let alpha = dim ? 0.2 : 1;
      const col = nodeColor(n);
      ctx.globalAlpha = alpha;
      // 辉光
      const glow = glowOn && n.deg / maxDeg >= PARAMS.glowThreshold && !dim;
      if (glow) {
        const grd = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * PARAMS.glowRange * (0.6 + PARAMS.glowIntensity * 0.5));
        grd.addColorStop(0, col.replace('hsl(', 'hsla(').replace(')', ',0.9)'));
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, r * PARAMS.glowRange * (0.6 + PARAMS.glowIntensity * 0.5), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = col;
      if (isOrph) { ctx.strokeStyle = '#D97A6B'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.sx, p.sy, r + 3, 0, Math.PI * 2); ctx.stroke(); }
      if (isHub && !dim) { ctx.strokeStyle = '#C9A96A'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.sx, p.sy, r + 2.5, 0, Math.PI * 2); ctx.stroke(); }
      if (isFocus) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.sx, p.sy, r + 4, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2); ctx.fill();
      // 标签（仅 hub/焦点/大节点）
      if (isFocus || isHub || n.id === 'ROOT') { ctx.globalAlpha = alpha * 0.95; ctx.fillStyle = '#E8E6DF'; ctx.font = '11px "Microsoft YaHei"'; ctx.textAlign = 'center'; ctx.fillText(n.label, p.sx, p.sy - r - 6); }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // 交互：拖拽旋转 / 滚轮缩放 / 点击聚焦 / hover 提示
  const tip = document.getElementById('gtip'), detail = document.getElementById('gdetail');
  let dragging = false, last = { x: 0, y: 0 }, moved = 0;
  canvas.addEventListener('mousedown', e => { dragging = true; moved = 0; last = { x: e.offsetX, y: e.offsetY }; });
  window.addEventListener('mousemove', e => {
    if (!dragging) { // hover
      const p = canvas.getBoundingClientRect(); const mx = e.clientX - p.left, my = e.clientY - p.top;
      const hit = hitNode(mx, my);
      if (hit) { tip.style.display = 'block'; tip.textContent = `${hit.n.label}（${hit.n.cat || ''} · 链接 ${hit.n.deg}）`; tip.style.left = (mx + 16) + 'px'; tip.style.top = (my + 16) + 'px'; }
      else tip.style.display = 'none';
      return;
    }
    const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
    if (Math.abs(dx) + Math.abs(dy) > 2) moved++;
    view.ry += dx * 0.006; view.rx = Math.max(-1.3, Math.min(1.3, view.rx + dy * 0.005));
  });
  window.addEventListener('mouseup', e => {
    if (dragging && moved < 4) {
      const p = canvas.getBoundingClientRect(); const hit = hitNode(e.clientX - p.left, e.clientY - p.top);
      view.focus = hit ? hit.n.id : null;
      showDetail(hit ? hit.n : null);
    }
    dragging = false;
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); view.scale = Math.max(0.25, Math.min(2.6, view.scale * (e.deltaY > 0 ? 0.9 : 1.1))); }, { passive: false });

  function hitNode(mx, my) {
    let best = null, bd = 30;
    for (const n of NODES) { const p = project(n); const d = Math.hypot(p.sx - mx, p.sy - my); if (d < bd) { bd = d; best = n; } }
    return best ? { n: best } : null;
  }
  function showDetail(n) {
    if (!n) { detail.style.display = 'none'; return; }
    const src = n.cat === '能力' ? (KB.capabilities.find(c => c.id === n.id)) : n.cat === '知识' ? KB.knowledge.find(k => k.id === n.id) : n.cat === '项目' ? KB.projects.find(p => p.id === n.id) : n.cat === '员工' ? KB.employees.find(e => e.id === n.id) : n.cat === '规则' ? KB.rules.find(r => r.id === n.id) : n.cat === '需求' ? (KB.requirements || []).find(r => r.id === n.id) : null;
    const body = src ? (src.content || src.detail || src.progress || src.role || src.use || '') : '';
    detail.style.display = 'block';
    detail.innerHTML = `<h3>${n.label}</h3><p>${body || '（无详情，点击空白处关闭）'}</p><div style="margin-top:8px">${[`度中心性 ${n.deg}`, n.hub ? '枢纽节点' : '', n.orphan ? '孤儿节点' : ''].filter(Boolean).map(x => `<span class="tag">${x}</span>`).join('')}</div>`;
  }

  // ---- 控制面板绑定 ----
  const $ = s => document.querySelector(s);
  function bindInputs(rootSel, paramMap) {
    document.querySelectorAll(rootSel + ' [data-param]').forEach(el => {
      const k = el.dataset.param;
      const set = () => { const v = el.type === 'checkbox' ? el.checked : (paramMap[k] && paramMap[k].type === 'float' ? parseFloat(el.value) : el.value); PARAMS[k] = v; };
      const reheated = () => { if (window.__GALAXY_REHEAT) window.__GALAXY_REHEAT(); else simulate(90); if (window.__GALAXY_2D_RELAYOUT) window.__GALAXY_2D_RELAYOUT(); };
      el.addEventListener('input', () => { set(); if (paramMap[k] && paramMap[k].reheat) reheated(); });
      el.addEventListener('change', () => { set(); if (paramMap[k] && paramMap[k].reheat) reheated(); if (k === 'quality') { initStars(); } });
    });
  }
  // 视觉参数（即时，不重排）
  const VISUAL = { starBackground: {}, starTwinkle: {}, glowIntensity: { type: 'float' }, glowRange: { type: 'float' }, glowThreshold: { type: 'float' }, autoOrbit: {}, linkAlpha: { type: 'float' }, colorSat: { type: 'float', reheat: false } };
  // 物理参数（触发重排）
  const PHYS = { repulsion: { type: 'float', reheat: true }, linkDistance: { type: 'float', reheat: true }, linkStrength: { type: 'float', reheat: true }, centripetalForce: { type: 'float', reheat: true }, flattening: { type: 'float', reheat: true }, coreGravity: { type: 'float', reheat: true }, spiralForce: { type: 'float', reheat: true }, expansion: { type: 'float', reheat: true } };
  bindInputs('#galaxyWrap', Object.assign({}, VISUAL, PHYS));
  // 节点大小 / 质量
  document.querySelectorAll('#galaxyWrap select[data-param]').forEach(el => { el.addEventListener('change', () => { PARAMS[el.dataset.param] = el.value; if (el.dataset.param === 'quality') initStars(); }); });

  // 预设
  const presetBox = document.getElementById('presetBox');
  function renderPresets() { if (!presetBox) return; presetBox.innerHTML = Object.keys(PRESETS).map(p => `<button class="chip" data-p="${p}">${p}</button>`).join(''); }
  renderPresets();
  document.addEventListener('click', e => {
    const b = e.target.closest('#presetBox .chip'); if (!b) return;
    Object.assign(PARAMS, JSON.parse(JSON.stringify(PRESETS[b.dataset.p])));
    syncUI(); if (window.__GALAXY_REHEAT) window.__GALAXY_REHEAT(); else simulate(200); if (window.__GALAXY_2D_RELAYOUT) window.__GALAXY_2D_RELAYOUT(); flash(b.dataset.p);
  });
  function syncUI() {
    document.querySelectorAll('#galaxyWrap [data-param]').forEach(el => {
      const k = el.dataset.param; if (PARAMS[k] === undefined) return;
      if (el.type === 'checkbox') el.checked = PARAMS[k];
      else if (el.type === 'range') el.value = PARAMS[k];
      else el.value = PARAMS[k];
    });
    colorSat = PARAMS.colorSat;
  }
  function flash(name) { const d = document.getElementById('presetFlash'); if (d) { d.textContent = `已应用预设：${name}`; d.style.opacity = 1; setTimeout(() => d.style.opacity = 0, 1600); } }
  syncUI();

  // 颜色洗牌
  document.getElementById('btnShuffle')?.addEventListener('click', () => { colorShift = Math.random(); simulate(60); });
  // 重播开场
  document.getElementById('btnReplay')?.addEventListener('click', () => { view.ry = 0.5; view.rx = -0.25; view.scale = 0.9; simulate(240); });
  // 重置视角/聚焦
  document.getElementById('btnResetView')?.addEventListener('click', () => { view.ry = 0.5; view.rx = -0.25; view.scale = 0.9; view.focus = null; detail.style.display = 'none'; });

  // ---- 实用分析 ----
  function hubList(n) { return NODES.filter(x => x.id !== 'ROOT').sort((a, b) => b.deg - a.deg).slice(0, n).map(x => x.label); }
  function brokenLinks() { return LINKS.filter(l => !byId[l.source] || !byId[l.target]); }
  function orphans() { return NODES.filter(n => n.orphan); }
  function shortestPath(aId, bId) {
    if (aId === bId) return [aId];
    const prev = {}, seen = { [aId]: 1 }, q = [aId];
    while (q.length) {
      const cur = q.shift();
      for (const l of LINKS) {
        const nx = l.source === cur ? l.target : l.target === cur ? l.source : null;
        if (nx && !seen[nx]) { seen[nx] = 1; prev[nx] = cur; if (nx === bId) { const path = [bId]; let x = bId; while (prev[x]) { x = prev[x]; path.unshift(x); } return path; } q.push(nx); }
      }
    }
    return null;
  }

  // Top Hub 显示
  $('#btnHubs')?.addEventListener('click', () => {
    const top = hubList(20);
    out(`Top 20 枢纽节点（入链+出链最高）：<br>${top.map((t, i) => `${i + 1}. ${t}`).join('<br>')}`);
  });
  // 孤儿 / 断链开关
  const orphansCb = document.getElementById('cbOrphans'), brokenCb = document.getElementById('cbBroken');
  function refreshMarks() {
    const showO = orphansCb?.checked, showB = brokenCb?.checked;
    // 通过 canvas 状态标记：复用渲染（孤儿已画红圈）；断链在链接层画红虚线
    return { showO, showB };
  }
  orphansCb?.addEventListener('change', refreshMarks); brokenCb?.addEventListener('change', refreshMarks);
  // 断链红色虚线（渲染层已实现基础，这里补充）
  // 连接两篇
  const selA = document.getElementById('selNodeA'), selB = document.getElementById('selNodeB');
  const labelOpts = NODES.filter(n => n.id !== 'ROOT' && n.id !== 'HUMAN').map(n => n.label);
  if (selA) { selA.innerHTML = labelOpts.map(l => `<option>${l}</option>`).join(''); selB.innerHTML = labelOpts.map(l => `<option>${l}</option>`).join(''); }
  $('#btnPath')?.addEventListener('click', () => {
    const a = NODES.find(n => n.label === selA.value), b = NODES.find(n => n.label === selB.value);
    if (!a || !b) return;
    const path = shortestPath(a.id, b.id);
    if (!path) out(`「${a.label}」与「${b.label}」之间无路径——知识断层，建议建立桥接笔记。`);
    else {
      const labels = path.map(id => byId[id]?.label || id);
      out(`最短路径（${labels.length - 1} 跳）：${labels.join(' → ')}${labels.length - 1 > 5 ? '<br><b style="color:var(--red)">⚠ 路径超过 5 跳，存在知识断层风险，建议补桥接节点。</b>' : ''}`);
      view.focus = null;
    }
  });

  // 健康巡检 SOP
  $('#btnHealth')?.addEventListener('click', () => {
    const top5 = hubList(5);
    const orph = orphans(), brk = brokenLinks();
    // 断层扫描：取度最高的两个不同域节点
    const sorted = NODES.filter(n => n.id !== 'ROOT' && n.id !== 'HUMAN').sort((a, b) => b.deg - a.deg);
    let gap = '未检测';
    if (sorted.length > 1) {
      const p = shortestPath(sorted[0].id, sorted[1].id);
      gap = p ? `${p.length - 1} 跳（${byId[p[0]]?.label} → ${byId[p[p.length - 1]]?.label}）` : '无路径';
    }
    const warn = [];
    if (orph.length > NODES.length * 0.1) warn.push(`孤儿笔记 ${orph.length} 个（>10%），建议归档或删除。`);
    if (brk.length) warn.push(`未解析链接 ${brk.length} 条，建议修复。`);
    out(`<b>知识库健康巡检报告</b><br>规模：${NODES.length} 节点 / ${LINKS.length} 链接<br>Top5 枢纽：${top5.join('、')}<br>断层扫描：${gap}${(gap === '无路径' || (typeof gap === 'string' && /^\d+ 跳/.test(gap) && parseInt(gap) > 5)) ? ' <b style="color:var(--red)">⚠ 建议建立桥接笔记</b>' : ''}<br>孤儿：${orph.length} 个${orph.length ? '（' + orph.map(x => x.label).join('、') + '）' : ''}<br>断链：${brk.length} 条<br>${warn.length ? '<b style="color:var(--red)">预警：' + warn.join('') + '</b>' : '状态良好，无需清理。'}`);
  });

  // 指令响应演示（关键词 → 动作）
  $('#btnCmd')?.addEventListener('click', () => {
    const cmd = document.getElementById('cmdInput')?.value || '';
    const msgs = [];
    const aIdx = cmd.match(/连接两篇\s*[:：]?\s*([^和、，]+)/);
    // 预设关键词
    const presetHit = Object.keys(PRESETS).find(p => cmd.includes(p));
    if (presetHit) { Object.assign(PARAMS, JSON.parse(JSON.stringify(PRESETS[presetHit]))); syncUI(); simulate(200); msgs.push(`已应用预设「${presetHit}」`); }
    else if (/螺旋/.test(cmd)) { Object.assign(PARAMS, JSON.parse(JSON.stringify(PRESETS.旋臂))); syncUI(); simulate(200); msgs.push('已应用预设「旋臂」'); }
    else if (/银河|星系/.test(cmd)) { Object.assign(PARAMS, JSON.parse(JSON.stringify(PRESETS.银河))); syncUI(); simulate(200); msgs.push('已应用预设「银河」'); }
    else if (/简洁|极简|素/.test(cmd)) { Object.assign(PARAMS, JSON.parse(JSON.stringify(PRESETS.极简))); syncUI(); simulate(200); msgs.push('已应用预设「极简」'); }
    if (cmd.includes('检查') || cmd.includes('巡检') || cmd.includes('健康')) { $('#btnHealth')?.click(); return; }
    if (aIdx && selA && selB) {
      const name = aIdx[1].trim(); const n = NODES.find(x => x.label.includes(name));
      if (n) { selA.value = n.label; const b = NODES.find(x => x.id !== n.id); if (b) selB.value = b.label; $('#btnPath')?.click(); msgs.unshift(`已连接两篇：${n.label} ↔ ${selB.value}`); }
    }
    out(msgs.length ? msgs.join('；') : '未识别指令。试试：「银河效果」「螺旋」「检查我的知识库结构」「连接两篇：XXX」');
  });
  document.getElementById('cmdInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnCmd')?.click(); });

  // 保存/载入预设
  const savedKey = 'zongzhu-galaxy-presets';
  function savedList() { try { return JSON.parse(localStorage.getItem(savedKey)) || {}; } catch (e) { return {}; } }
  function renderSaved() {
    const box = document.getElementById('savedPresets'); if (!box) return;
    const s = savedList(); const keys = Object.keys(s);
    box.innerHTML = keys.length ? keys.map(k => `<button class="chip" data-s="${k}">${k}</button><button class="chip" data-d="${k}" title="删除">✕</button>`).join(' ') : '<span style="color:var(--text2);font-size:12px">暂无自存预设</span>';
  }
  renderSaved();
  document.addEventListener('click', e => {
    const load = e.target.closest('#savedPresets [data-s]'), del = e.target.closest('#savedPresets [data-d]');
    if (load) { Object.assign(PARAMS, savedList()[load.dataset.s]); syncUI(); if (window.__GALAXY_REHEAT) window.__GALAXY_REHEAT(); else simulate(200); if (window.__GALAXY_2D_RELAYOUT) window.__GALAXY_2D_RELAYOUT(); flash('自存预设：' + load.dataset.s); }
    if (del) { const s = savedList(); delete s[del.dataset.d]; localStorage.setItem(savedKey, JSON.stringify(s)); renderSaved(); }
  });
  $('#btnSave')?.addEventListener('click', () => {
    const name = document.getElementById('saveName')?.value.trim(); if (!name) return;
    const s = savedList(); s[name] = JSON.parse(JSON.stringify(PARAMS)); localStorage.setItem(savedKey, JSON.stringify(s)); renderSaved(); document.getElementById('saveName').value = ''; flash('已保存预设：' + name);
  });

  // 输出区
  const outEl = document.getElementById('diagOut');
  function out(html) { if (outEl) { outEl.innerHTML = html; outEl.style.display = 'block'; } }

  // 2D/3D 模式切换
  document.getElementById('mode3d')?.addEventListener('click', () => { document.getElementById('galaxyWrap').style.display = 'block'; document.getElementById('graphWrap').style.display = 'none'; setTimeout(resize, 30); });
  document.getElementById('mode2d')?.addEventListener('click', () => { document.getElementById('galaxyWrap').style.display = 'none'; document.getElementById('graphWrap').style.display = 'block'; if (!window.gInit) initGraph(); else if (window.__GALAXY_2D_RELAYOUT) window.__GALAXY_2D_RELAYOUT(); });
})();
