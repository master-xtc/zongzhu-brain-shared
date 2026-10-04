/* 总助大脑 · Galaxy 3D 主引擎（Three.js，Obsidian Galaxy View 同款技术栈）
 * 在线（http/https）加载 Three.js 渲染插件级 3D 星系；失败自动回退 Canvas 兜底引擎（galaxy.js）
 * 与 galaxy.js 共享 window.GALAXY_PARAMS 参数对象与面板控件
 */
(async () => {
  const KBG = window.KB && window.KB.graph;
  if (!KBG) return;

  async function loadThree() {
    // 依赖页面 <script type="importmap"> 将 three / three/addons/ 映射到 jsdelivr CDN
    try {
      const THREE = await import('three');
      const [OC, EC, RP, UB, OP] = await Promise.all([
        import('three/addons/controls/OrbitControls.js'),
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
      ]);
      return { THREE, mods: { OrbitControls: OC.OrbitControls, EffectComposer: EC.EffectComposer, RenderPass: RP.RenderPass, UnrealBloomPass: UB.UnrealBloomPass, OutputPass: OP.OutputPass } };
    } catch (e) { return null; }
  }

  const T3 = await loadThree();
  const tag = document.getElementById('engineTag');
  if (!T3) {
    if (tag) tag.textContent = '引擎：Canvas 兜底（CDN 不可用）';
    return; // galaxy.js 兜底继续
  }
  const { THREE } = T3;
  const { OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass } = T3.mods;
  if (tag) tag.textContent = '引擎：Three.js 3D 星系（插件级）';
  window.__GALAXY_3D = true; // 停止 canvas 兜底渲染

  // ---- 数据 ----
  const NODES = KBG.nodes.map(n => Object.assign({}, n));
  const LINKS = KBG.links;
  const byId = {}; NODES.forEach(n => byId[n.id] = n);
  NODES.forEach(n => n.deg = 0);
  LINKS.forEach(l => { const s = byId[l.source], t = byId[l.target]; if (s) s.deg++; if (t) t.deg++; });
  const maxDeg = Math.max(1, ...NODES.map(n => n.deg));
  NODES.forEach(n => { n.hub = n.deg >= Math.max(2, Math.floor(NODES.length * 0.12)) && n.id !== 'ROOT'; n.orphan = n.deg === 0 && n.id !== 'ROOT' && n.id !== 'HUMAN'; });

  const CAT_COLORS = { root: 0xC9A96A, human: 0xE8E8E8, 规则: 0xD4A94E, 能力: 0x6FA8DC, 知识: 0x7FBF7F, 项目: 0xC77DBA, 员工: 0xE58A5C, 工具: 0x8A8F98, 需求: 0x6FB5B5 };
  let colorShift = 0;
  function shiftHex(hex) {
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6; else if (mx === g) h = ((b - r) / d + 2) / 6; else h = ((r - g) / d + 4) / 6; }
    h = (h + colorShift) % 1; s = Math.max(0, Math.min(1, s * (window.GALAXY_PARAMS.colorSat ?? 1)));
    return new THREE.Color().setHSL(h, s, l);
  }
  function nodeColor(n) { return shiftHex(CAT_COLORS[n.cat] || 0x888888); }

  // ---- 场景 ----
  const container = document.getElementById('galaxy3d');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0A0A0F);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
  camera.position.set(0, 160, 420);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);
  renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; renderer.domElement.style.display = 'block';

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.7;
  controls.minDistance = 60; controls.maxDistance = 1600;

  // 星空背景（Points）
  let starsGeo = null, starsMat = null, stars = null;
  function buildStars() {
    if (stars) { scene.remove(stars); starsGeo.dispose(); starsMat.dispose(); }
    const count = { 低: 400, 中: 900, 高: 2000 }[window.GALAXY_PARAMS.quality] || 900;
    starsGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { pos[i * 3] = (Math.random() - 0.5) * 2600; pos[i * 3 + 1] = (Math.random() - 0.5) * 1800; pos[i * 3 + 2] = (Math.random() - 0.5) * 2600; }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starsMat = new THREE.PointsMaterial({ color: 0xcdd3e0, size: 1.6, transparent: true, opacity: 0.75, depthWrite: false });
    stars = new THREE.Points(starsGeo, starsMat);
    scene.add(stars);
  }
  buildStars();

  // 物理模拟（3D，与面板参数联动）
  function simulate(iters) {
    const P = window.GALAXY_PARAMS;
    const rep = P.repulsion * 1200, ldist = P.linkDistance, lstr = P.linkStrength * 0.02;
    const cent = P.centripetalForce, flat = P.flattening * 0.12, core = P.coreGravity * 0.05, spiral = P.spiralForce * 0.03, exp = P.expansion * 0.05;
    for (let it = 0; it < iters; it++) {
      for (const n of NODES) {
        for (const m of NODES) { if (n === m) continue; const dx = n.x - m.x, dy = n.y - m.y, dz = n.z - m.z; const d2 = dx * dx + dy * dy + dz * dz + 1; const f = rep / d2; const d = Math.sqrt(d2); n.vx += dx / d * f; n.vy += dy / d * f; n.vz += dz / d * f; }
        const r = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) || 1;
        n.vx -= n.x * cent; n.vy -= n.y * cent; n.vz -= n.z * cent;
        n.vy += -n.y * flat * 4;
        if (n.hub) { const k = core * (n.deg / maxDeg); n.vx -= n.x * k; n.vy -= n.y * k; n.vz -= n.z * k; }
        const tx = -n.z / r, tz = n.x / r;
        n.vx += tx * spiral * r * 0.5; n.vz += tz * spiral * r * 0.5;
        n.vx += n.x / r * exp; n.vy += n.y / r * exp; n.vz += n.z / r * exp;
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
  NODES.forEach((n, i) => {
    const R = 60 + Math.random() * 150; const a = (i / NODES.length) * Math.PI * 2 * (1 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.8;
    n.x = Math.cos(a) * R; n.z = Math.sin(a) * R; n.y = (Math.random() - 0.5) * 60 * (1 - window.GALAXY_PARAMS.flattening);
    n.vx = 0; n.vy = 0; n.vz = 0;
  });
  simulate(240);

  // 节点网格
  const nodeGroup = new THREE.Group(); scene.add(nodeGroup);
  const meshes = [];
  function buildNodes() {
    while (nodeGroup.children.length) { const c = nodeGroup.children.pop(); c.geometry.dispose(); c.material.dispose(); }
    meshes.length = 0;
    for (const n of NODES) {
      const r = n.id === 'ROOT' ? 9 : 4.5;
      const geo = new THREE.SphereGeometry(r, 16, 16);
      const mat = new THREE.MeshBasicMaterial({ color: nodeColor(n), transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(n.x, n.y, n.z);
      mesh.userData = { node: n };
      nodeGroup.add(mesh); meshes.push(mesh);
    }
  }
  buildNodes();
  function applyNodeSize() {
    meshes.forEach(m => {
      const n = m.userData.node;
      const s = window.GALAXY_PARAMS.nodeSize === '统一' ? 1 : 0.7 + 1.3 * (n.deg / maxDeg);
      m.scale.setScalar(s);
    });
  }
  applyNodeSize();

  // 链接（LineSegments）
  const linkPos = new Float32Array(LINKS.length * 6);
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3));
  const linkMat = new THREE.LineBasicMaterial({ color: 0x3a3a52, transparent: true, opacity: 0.55 });
  const linkLines = new THREE.LineSegments(linkGeo, linkMat);
  scene.add(linkLines);
  function writeLinks() {
    const pos = linkGeo.attributes.position.array;
    let i = 0;
    for (const l of LINKS) { const a = byId[l.source], b = byId[l.target]; if (!a || !b) continue; pos[i++] = a.x; pos[i++] = a.y; pos[i++] = a.z; pos[i++] = b.x; pos[i++] = b.y; pos[i++] = b.z; }
    linkGeo.attributes.position.needsUpdate = true;
  }
  writeLinks();

  // 高亮标记：孤儿（红圈）/ 枢纽（金圈）/ 断链（红虚线）
  const markers = new THREE.Group(); scene.add(markers);
  const orphanRings = [], hubRings = [];
  function buildMarkers() {
    while (markers.children.length) { const c = markers.children.pop(); c.geometry.dispose(); c.material.dispose(); }
    orphanRings.length = 0; hubRings.length = 0;
    for (const n of NODES) {
      if (n.orphan) { const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.5, 8, 32), new THREE.MeshBasicMaterial({ color: 0xD97A6B, transparent: true, opacity: 0.9 })); ring.position.set(n.x, n.y, n.z); markers.add(ring); orphanRings.push(ring); }
      if (n.hub) { const ring = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.4, 8, 32), new THREE.MeshBasicMaterial({ color: 0xC9A96A, transparent: true, opacity: 0.8 })); ring.position.set(n.x, n.y, n.z); markers.add(ring); hubRings.push(ring); }
    }
  }
  buildMarkers();
  const broken = LINKS.filter(l => !byId[l.source] || !byId[l.target]);
  let brokenLines = null;
  if (broken.length) {
    const bp = new Float32Array(broken.length * 6);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    const bm = new THREE.LineBasicMaterial({ color: 0xD97A6B, transparent: true, opacity: 0.9 });
    brokenLines = new THREE.LineSegments(bg, bm); scene.add(brokenLines);
    const pos = bp; let i = 0;
    for (const l of broken) { const a = byId[l.source] || { x: 0, y: 0, z: 0 }, b = byId[l.target] || { x: 0, y: 0, z: 0 }; pos[i++] = a.x; pos[i++] = a.y; pos[i++] = a.z; pos[i++] = b.x; pos[i++] = b.y; pos[i++] = b.z; }
  }

  // Bloom（辉光）
  let composer = null, bloomPass = null;
  function buildComposer() {
    const W = renderer.domElement.clientWidth || container.clientWidth, H = renderer.domElement.clientHeight || container.clientHeight;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 1.0, 2.0, 0.5);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

  // 视角控制 + 点击/悬停
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const tip = document.getElementById('gtip'), detail = document.getElementById('gdetail');
  let focusId = null;
  const canvasEl = renderer.domElement;
  canvasEl.addEventListener('pointermove', e => {
    const r = canvasEl.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1; pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit) { tip.style.display = 'block'; tip.textContent = hit.userData.node.label + '（' + (hit.userData.node.cat || '') + ' · 链接 ' + hit.userData.node.deg + '）'; tip.style.left = (e.clientX - r.left + 16) + 'px'; tip.style.top = (e.clientY - r.top + 16) + 'px'; }
    else tip.style.display = 'none';
  });
  canvasEl.addEventListener('click', e => {
    const r = canvasEl.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1; pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    focusId = hit ? hit.userData.node.id : null;
    applyFocus();
    if (!hit) detail.style.display = 'none';
    else {
      const n = hit.userData.node;
      const src = n.cat === '能力' ? KB.capabilities.find(c => c.id === n.id) : n.cat === '知识' ? KB.knowledge.find(k => k.id === n.id) : n.cat === '项目' ? KB.projects.find(p => p.id === n.id) : n.cat === '员工' ? KB.employees.find(e => e.id === n.id) : n.cat === '规则' ? KB.rules.find(r => r.id === n.id) : n.cat === '需求' ? (KB.requirements || []).find(r => r.id === n.id) : null;
      const body = src ? (src.content || src.detail || src.progress || src.role || src.use || '') : '';
      detail.style.display = 'block';
      detail.innerHTML = '<h3>' + n.label + '</h3><p>' + (body || '（无详情，点击空白处关闭）') + '</p><div style="margin-top:8px">' + ['度中心性 ' + n.deg, n.hub ? '枢纽节点' : '', n.orphan ? '孤儿节点' : ''].filter(Boolean).map(x => '<span class="tag">' + x + '</span>').join('') + '</div>';
    }
  });
  function applyFocus() {
    meshes.forEach(m => { const isF = focusId && m.userData.node.id === focusId; m.material.opacity = isF ? 1 : (focusId ? 0.2 : 1); });
    linkMat.opacity = window.GALAXY_PARAMS.linkAlpha * (focusId ? 0.25 : 1);
    markers.visible = !focusId;
  }

  // 参数重排钩子（面板物理参数变化时触发）
  window.__GALAXY_REHEAT = () => {
    if (window.GALAXY_PARAMS.quality !== lastQuality) { buildStars(); lastQuality = window.GALAXY_PARAMS.quality; }
    simulate(130);
    meshes.forEach(m => { const n = m.userData.node; m.position.set(n.x, n.y, n.z); });
    writeLinks();
    orphanRings.forEach(r => r.position.set(r.userData ? r.userData.x : 0, 0, 0));
    // 重建标记位置
    rebuildMarkersPositions();
    applyNodeSize();
    if (composer && (window.GALAXY_PARAMS.glowIntensity < 0.05)) { }
  };
  let lastQuality = window.GALAXY_PARAMS.quality;
  function rebuildMarkersPositions() {
    // 简单方式：直接重建标记（数量少，开销可接受）
    buildMarkers();
    if (brokenLines) { /* 位置不变 */ }
  }
  // 分析功能共用 galaxy.js 已绑定的按钮（输出 #diagOut），此处无需重复绑定

  // 重播/重置/洗牌按钮由 galaxy.js 绑定（canvas 版）——需重定向到 Three 场景
  document.getElementById('btnReplay')?.addEventListener('click', () => { camera.position.set(0, 160, 420); controls.target.set(0, 0, 0); controls.update(); }, true);
  document.getElementById('btnResetView')?.addEventListener('click', () => { camera.position.set(0, 160, 420); controls.target.set(0, 0, 0); focusId = null; applyFocus(); detail.style.display = 'none'; }, true);

  // 渲染循环
  const clock = new THREE.Clock();
  const t0 = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    const P = window.GALAXY_PARAMS;
    const t = performance.now() - t0;
    controls.autoRotate = !!P.autoOrbit;
    if (stars) { stars.visible = !!P.starBackground; if (starsMat) { starsMat.opacity = P.starTwinkle ? 0.55 + 0.25 * Math.sin(t / 500) : 0.75; } }
    linkMat.opacity = P.linkAlpha * (focusId ? 0.25 : 1);
    const showO = document.getElementById('cbOrphans')?.checked, showB = document.getElementById('cbBroken')?.checked;
    orphanRings.forEach(r => r.visible = !!showO);
    hubRings.forEach(r => r.visible = true);
    if (brokenLines) brokenLines.visible = !!showB;
    if (bloomPass) { bloomPass.strength = P.glowIntensity; bloomPass.radius = P.glowRange; bloomPass.threshold = P.glowThreshold; }
    controls.update();
    if (composer && P.glowIntensity > 0.02) composer.render(); else renderer.render(scene, camera);
  }

  function resize() {
    const w = container.clientWidth || 800, h = container.clientHeight || 500;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (composer) composer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();
  buildComposer();
  renderer.setClearColor(0x0A0A0F, 1);
  animate();
})();
