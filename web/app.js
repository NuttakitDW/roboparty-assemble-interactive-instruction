import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { createOverlays } from './overlays.js';

const URDF_DIR = '../cad/rpo_hardware/V2.0/roboto_origin_mechanic/03_URDF/urdf/';
const URDF = URDF_DIR + 'roboto_origin.urdf';
const EXPLODE_SCALE = 1.4;
const BASE_COLOR = new THREE.Color('#d4d4d8');
const HILITE_COLOR = new THREE.Color('#93b4f5');
const DIM_OPACITY = 0.1;

const UI = {
  th: { search: 'ค้นหา', menu: 'ชิ้นส่วน', page: '0 · ภาพรวมชิ้นส่วน', tour: 'เล่นทัวร์ภาพรวม', groups: 'โครงสร้างหุ่นยนต์', bom: 'ชิ้นส่วนตาม BOM', back: 'กลับ', links: 'ลิงก์', unofficial: 'คู่มือไม่เป็นทางการ ไม่ได้เกี่ยวข้องกับ RoboParty', skip: 'ข้าม', replay: 'เล่นอินโทรอีกครั้ง', w_sub: 'คู่มือประกอบแบบอินเทอร์แอกทีฟ', page_ref: 'หน้า PDF', system: 'ระบบ', extra: 'นอก BOM', systems_h: 'ระบบและชิ้นส่วน', extras_h: 'ไม่อยู่ใน BOM ของคู่มือ', spec: 'วัสดุ/สเปก', hint: 'ลากเพื่อหมุน · เลื่อนล้อเพื่อซูม',
    prev: 'ก่อนหน้า', next: 'ถัดไป', play: 'เล่นต่อ', pause: 'หยุดชั่วคราว', components: 'ชิ้นส่วนทั้งหมด',
    loading: 'กำลังโหลดโมเดล', failed: 'โหลดโมเดลไม่สำเร็จ ต้องเปิดผ่านเซิร์ฟเวอร์ที่ราก repo', show: 'ดูในโมเดล',
    pcs: 'ชิ้น', items: 'รายการ', ph: 'ค้นหาชิ้นส่วนหรือหัวข้อ', k_nav: 'เลือก', k_open: 'เปิด', k_close: 'ปิด',
    none: 'ไม่พบผลลัพธ์', stage: 'หัวข้อ', part: 'ชิ้นส่วน', mass: 'มวล', motor: 'มอเตอร์' },
  en: { search: 'Search', menu: 'Parts', page: '0 · Component overview', tour: 'Play overview tour', groups: 'Robot structure', bom: 'Parts by BOM', back: 'Back', links: 'links', unofficial: 'Unofficial guide, not affiliated with RoboParty', skip: 'Skip', replay: 'Replay intro', w_sub: 'Interactive assembly guide', page_ref: 'PDF page', system: 'System', extra: 'Outside BOM', systems_h: 'Systems & parts', extras_h: 'Not in the manual BOM', spec: 'Material / spec', hint: 'Drag to rotate · scroll to zoom',
    prev: 'Previous', next: 'Next', play: 'Resume', pause: 'Pause', components: 'All components',
    loading: 'Loading model', failed: 'Model failed to load. Serve from the repo root.', show: 'Show in model',
    pcs: 'pcs', items: 'items', ph: 'Search parts or topics', k_nav: 'select', k_open: 'open', k_close: 'close',
    none: 'No results', stage: 'Topic', part: 'Part', mass: 'Mass', motor: 'Motor' },
};
const NO_MODEL = { th: 'ยังไม่มีโมเดล 3 มิติของชิ้นส่วนนี้ ภาพที่เห็นเป็นเพียงบริเวณลำตัวโดยรวม', en: 'No 3D model of this part yet; the view only shows the torso area in general' };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (s) => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const state = { lang: store.get('lang') === 'en' ? 'en' : 'th', mode: 'tour', stage: 0, view: null, selGroup: null, selSys: null, selPart: null,
  playing: !REDUCED, elapsed: 0, userMoved: false, ready: false };
let stages = [], views = {}, channels = [], overlays = null, linksMeta = {}, groupsMeta = {}, motorsMeta = {}, partsData = { parts: [] }, systems = [], extras = [];
const tagOf = (sys) => (sys.extra ? UI[state.lang].extra : sys.id);
const sysOf = (item) => systems.find((x) => x.items.includes(item));
const partOf = (id) => partsData.parts.find((p) => p.item === id) || extras.find((x) => x.id === id);

// ---------- i18n + caption ----------
const t = (k) => UI[state.lang][k] ?? k;
const tr = (o) => o[state.lang];
const cur = () => (state.mode === 'tour' ? stages[state.stage] : state.view);
const GROUP_STAGE = { pelvis: 'torso', torso: 'torso', legL: 'legs', legR: 'legs', armL: 'arms', armR: 'arms' };

function applyLang() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $('#q').placeholder = t('ph');
  document.querySelectorAll('.lang').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
  $('#play').textContent = state.playing ? t('pause') : t('play');
  if (state.view) state.view = buildView();
  renderSide();
  renderCaption(false);
  if (!state.ready) renderLoading();
  if (!$('#palette').hidden) renderResults();
  store.set('lang', state.lang);
}

function renderCaption(animate = true) {
  const s = cur(); if (!s) return;
  const c = tr(s);
  const tour = state.mode === 'tour';
  $('#count').textContent = tour ? `${String(state.stage + 1).padStart(2, '0')} / ${String(stages.length).padStart(2, '0')}` : '';
  $('#tag').textContent = s.tag;
  $('#tag').style.color = s.tagColor || '';
  $('#cap-title').textContent = c.title;
  $('#cap-body').textContent = c.body;
  const nt = $('#cap-note'); nt.textContent = s.note ? s.note[state.lang] : ''; nt.hidden = !s.note;
  renderLegend(s);
  $('#ctrl').hidden = !tour;
  document.querySelectorAll('#dots button').forEach((b, i) => b.setAttribute('aria-selected', String(tour && i === state.stage)));
  if (animate) { const cap = $('#caption'); cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap'); }
}

function renderLegend(s) {
  const lg = $('#legend');
  const items = s.legend === 'motors' ? [['var(--signal)', 'DM-J10010L ×9'], ['var(--bronze)', 'DM 4340P ×14']]
    : s.legend === 'can' ? channels.map((c) => [c.color, `${c.id} · ${c[state.lang]}`]) : [];
  lg.hidden = !items.length;
  lg.innerHTML = items.map(([c, l]) => `<span><i style="background:${esc(c)}"></i>${esc(l)}</span>`).join('');
}

function setPlaying(on) { state.playing = on; $('#play').textContent = on ? t('pause') : t('play'); }

function goStage(i) {
  state.mode = 'tour'; state.view = null; state.selGroup = state.selSys = state.selPart = null;
  state.stage = (i + stages.length) % stages.length;
  state.elapsed = 0; state.userMoved = false;
  renderCaption(); renderSide(); showRoot();
}

function startTour() { goStage(0); setPlaying(!REDUCED); closeDrawer(); }

// Non-tour views are synthesized from a tour stage preset (camera, explode) with their own focus and text.
function buildView() {
  const stageOf = (id) => stages.find((x) => x.id === id) || views[id];
  if (state.selGroup) {
    const g = state.selGroup, base = stageOf(GROUP_STAGE[g]);
    const ls = Object.entries(linksMeta).filter(([, m]) => m.group === g);
    const cnt = (m) => ls.filter(([, x]) => x.motor === m).length;
    const mot = (l) => ['10010L', '4340P'].filter(cnt).map((m) => `${motorsMeta[m][l]} ×${cnt(m)}`).join(' · ');
    const body = (l) => `${ls.length} ${UI[l].links}${mot(l) ? ` · ${mot(l)}` : ''}. ${ls.map(([, m]) => m[l]).join(', ')}`;
    return { ...base, focus: [g], explode: 0.6, markers: false, tag: 'structure', tagColor: '', note: null,
      th: { title: groupsMeta[g].th, body: body('th') }, en: { title: groupsMeta[g].en, body: body('en') } };
  }
  const sys = state.selSys, base = stageOf(sys.stage);
  const note = sys.note || (sys.model ? null : NO_MODEL);
  if (state.selPart) {
    const p = partOf(state.selPart);
    if (p.note) {
      const body = (l) => `${p.note[l]} · ${p.src || `${UI[l].page_ref} ${p.page}`}`;
      return { ...base, tag: tagOf(sys), tagColor: sys.color, note: null, th: { title: p.th, body: body('th') }, en: { title: p.en, body: body('en') } };
    }
    const body = (l) => [p.partNo, `×${p.qty}`, p.spec && `${UI[l].spec}: ${p.spec}`].filter(Boolean).join(' · ');
    return { ...base, tag: tagOf(sys), tagColor: sys.color, note, th: { title: p.th, body: body('th') }, en: { title: p.en, body: body('en') } };
  }
  return { ...base, tag: tagOf(sys), tagColor: sys.color, note, th: { title: sys.th, body: sys.desc.th }, en: { title: sys.en, body: sys.desc.en } };
}

function enterView() {
  state.mode = 'view'; state.view = buildView(); state.userMoved = false;
  setPlaying(false); $('#bar').style.width = '0';
  renderCaption(); renderSide();
}
function selectGroup(g) { state.selGroup = g; state.selSys = state.selPart = null; showRoot(); enterView(); closeDrawer(); }
function selectSys(id) { state.selSys = systems.find((x) => x.id === id); state.selGroup = state.selPart = null; showCat(); enterView(); }
function selectPart(item) { state.selSys = sysOf(item); state.selGroup = null; state.selPart = item; showCat(); enterView(); closeDrawer(); }

// ---------- 3D scene ----------
const viewer = $('#viewer'), canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
camera.position.set(2.6, 0.7, 2.4);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 0.12; controls.maxDistance = 8;
controls.addEventListener('start', () => { state.userMoved = true; });
scene.add(new THREE.HemisphereLight(0xffffff, 0x27272a, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 2); scene.add(key);
const rim = new THREE.DirectionalLight(0x93b4f5, 0.6); rim.position.set(-3, 2, -3); scene.add(rim);

const pivot = new THREE.Group(); scene.add(pivot);
const urdfRoot = new THREE.Group(); urdfRoot.rotation.x = -Math.PI / 2; pivot.add(urdfRoot); // URDF z-up -> three y-up
const nodes = new Map(); // link name -> { group, base, meshMat, marker, hl, op }
const pickables = [];

// ---------- welcome intro: parts fly in from below, feet first, camera rises then pulls back ----------
const INTRO_MS = 10500, WORDMARK_MS = 6300;
const intro = { active: false, t: 0, rate: 1, grid: null };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const introPos = new THREE.CatmullRomCurve3([V3(1.5, -1.25, 1.2), V3(1.7, -0.3, 1.6), V3(2.5, 0.35, 1.9), V3(1.9, 0.55, 1.5)]);
const introLook = new THREE.CatmullRomCurve3([V3(0, -0.55, 0), V3(0, -0.2, 0), V3(0, 0, 0), V3(0, 0, 0)]);
const easeIO = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1));
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const SIGNAL_COLOR = new THREE.Color('#5D9BFF');

function resize() {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewer);

const PIN = { th: { imu: 'IMU', board: 'บอร์ด 3-in-1 (โดยประมาณ)' }, en: { imu: 'IMU', board: '3-in-1 board (approx.)' } };
const pinText = (id, lang) => PIN[lang][id] ?? id;

const loading = { done: 0, total: 0, failed: false };
function renderLoading() {
  const el = $('#loading');
  el.textContent = loading.failed ? t('failed') : (loading.total ? `${t('loading')} ${loading.done}/${loading.total}` : '');
}

const vec = (s) => new THREE.Vector3(...s.trim().split(/\s+/).map(Number));

async function loadRobot() {
  const txt = await (await fetch(URDF)).text();
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  const loader = new STLLoader();
  const linkEls = [...doc.querySelectorAll('robot > link')];
  let done = 0;
  loading.total = linkEls.length;
  const setProgress = () => { loading.done = done; renderLoading(); };
  setProgress();
  await Promise.all(linkEls.map(async (el) => {
    const name = el.getAttribute('name');
    const group = new THREE.Group(); group.name = name;
    const file = el.querySelector('visual mesh').getAttribute('filename');
    const geom = await loader.loadAsync(new URL(file, new URL(URDF, location.href)).href);
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: BASE_COLOR, metalness: 0.15, roughness: 0.65, transparent: true });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.link = name; group.add(mesh); pickables.push(mesh);
    nodes.set(name, { group, mesh, base: new THREE.Vector3(), mat, marker: null, hl: 0, op: 1, mk: 0, arrive: 1, flash: 0, delay: 0, dir: new THREE.Vector3(), spin: 0 });
    done += 1; setProgress();
  }));
  for (const j of doc.querySelectorAll('robot > joint')) {
    const parent = nodes.get(j.querySelector('parent').getAttribute('link'));
    const child = nodes.get(j.querySelector('child').getAttribute('link'));
    const origin = vec(j.querySelector('origin').getAttribute('xyz'));
    child.base.copy(origin); child.group.position.copy(origin);
    parent.group.add(child.group);
    const axis = vec(j.querySelector('axis').getAttribute('xyz')).normalize();
    const motor = linksMeta[child.group.name]?.motor;
    if (motor) {
      const r = motor === '10010L' ? 0.05 : 0.038;
      const mk = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 10, 40),
        new THREE.MeshBasicMaterial({ color: motorsMeta[motor].color, transparent: true, opacity: 0, depthTest: false }));
      mk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis); mk.renderOrder = 10;
      child.group.add(mk); child.marker = mk;
    }
  }
  urdfRoot.add(nodes.get('base_link').group);
  overlays = createOverlays({ nodes, urdfRoot, host: $('#pins'), channels, text: pinText });
  const box = new THREE.Box3().setFromObject(pivot);
  const grid = new THREE.GridHelper(4, 16, 0x3f3f46, 0x27272a);
  grid.material.transparent = true; grid.position.y = box.min.y - 0.01; scene.add(grid); intro.grid = grid;
}

// ---------- per-frame animation ----------
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3();
let explode = 0, yaw = 0, last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  const s = intro.active ? stages[0] : cur();
  if (s && state.ready) {
    const focusAll = s.focus.includes('all');
    explode = damp(explode, s.explode, 2.2, dt);
    for (const [name, n] of nodes) {
      const g = linksMeta[name]?.group;
      const inFocus = focusAll || s.focus.includes(g);
      n.op = damp(n.op, inFocus ? 1 : (s.dim ?? DIM_OPACITY), 4, dt);
      n.hl = damp(n.hl, focusAll ? 0 : (inFocus ? 1 : 0), 4, dt);
      n.mk = damp(n.mk, s.markers ? 1 : 0, 4, dt);
      n.mat.opacity = n.op * n.arrive; n.mat.depthWrite = n.op * n.arrive > 0.5;
      n.mat.color.copy(BASE_COLOR).lerp(HILITE_COLOR, n.hl * 0.55).lerp(SIGNAL_COLOR, n.flash);
      n.group.position.copy(n.base).multiplyScalar(1 + explode * EXP_K());
      if (n.marker) n.marker.material.opacity = n.mk * (n.op > 0.5 ? 1 : 0.15);
    }
    overlays?.update(dt, intro.active ? null : s.overlay, camera, viewer.clientWidth, viewer.clientHeight, state.lang);
    const sway = REDUCED ? 0 : Math.sin(now / 2600) * 0.12;
    if (intro.active) stepIntro(dt);
    else yaw = damp(yaw, s.yaw, 1.6, dt);
    pivot.rotation.y = intro.active ? yaw : yaw + sway;
    if (!state.userMoved && !intro.active) {
      camTarget.set(...s.cam); lookTarget.set(...s.target);
      if (camera.aspect < 1) { camTarget.multiplyScalar(1.3); lookTarget.y -= 0.32; } // portrait: back off, keep the robot above the caption
      const k = 1 - Math.exp(-2.2 * dt);
      camera.position.lerp(camTarget, k); controls.target.lerp(lookTarget, k);
    }
    if (state.mode === 'tour' && state.playing && !intro.active && !document.hidden) {
      state.elapsed += dt * 1000;
      $('#bar').style.width = `${Math.min(state.elapsed / s.dur, 1) * 100}%`;
      if (state.elapsed >= s.dur) goStage(state.stage + 1);
    } else if (state.mode !== 'tour' || !state.playing) { $('#bar').style.width = '0'; }
  }
  controls.update();
  renderer.render(scene, camera);
}
const EXP_K = () => EXPLODE_SCALE;

function planIntro() {
  pivot.updateMatrixWorld(true);
  const list = [...nodes.values()].map((n) => ({ n, p: n.group.getWorldPosition(new THREE.Vector3()) })).sort((a, b) => a.p.y - b.p.y);
  list.forEach(({ n, p }, i) => {
    n.delay = 0.5 + (i / Math.max(list.length - 1, 1)) * 5.2;
    const side = i % 2 ? 1 : -1;
    const ux = p.x, uy = Math.hypot(p.z, 0) > 0.03 ? -p.z : 0.8 * side; // three z = -urdf y
    n.dir.set(ux * 0.9, uy * 0.9, -1).normalize().multiplyScalar(1.7);
    n.spin = side * 2.2;
  });
}

function startIntro() {
  state.view = null; state.mode = 'tour'; state.selGroup = state.selSys = state.selPart = null; showRoot();
  if (REDUCED || new URLSearchParams(location.search).get('intro') === '0') { app.classList.remove('intro'); goStage(0); return; }
  planIntro();
  for (const n of nodes.values()) { n.arrive = 0; n.mesh.position.copy(n.dir); }
  Object.assign(intro, { active: true, t: 0, rate: 1 });

  controls.enabled = false; yaw = -1.1;
  app.classList.add('intro'); $('#welcome').classList.remove('show');
  setPlaying(false); state.mode = 'tour'; state.stage = 0; renderCaption(false); renderSide();
}

function stepIntro(dt) {
  intro.t += dt * 1000 * intro.rate;
  const t = intro.t / 1000;
  for (const n of nodes.values()) {
    const x = clamp01((t - n.delay) / 1.6), q = 1 - (1 - x) ** 3;
    n.arrive = clamp01(x / 0.35);
    n.flash = x < 1 ? (x ** 3) * (1 - x) * 6.75 * 0.8 : 0;
    n.mesh.position.copy(n.dir).multiplyScalar(1 - q);
    n.mesh.rotation.z = n.spin * (1 - q);
  }
  const u = easeIO(intro.t / INTRO_MS);
  introPos.getPoint(u, camera.position); introLook.getPoint(u, controls.target);
  yaw = -1.1 + (stages[0].yaw + 1.1) * easeIO(intro.t / INTRO_MS);
  if (intro.grid) intro.grid.material.opacity = easeIO(t / 2.5);
  $('#intro-bar').style.width = `${clamp01(intro.t / INTRO_MS) * 100}%`;
  if (intro.t >= WORDMARK_MS) {
    $('#welcome').classList.add('show');
  }
  if (intro.t >= INTRO_MS) endIntro();
}

function endIntro() {
  intro.active = false; controls.enabled = true;
  for (const n of nodes.values()) { n.arrive = 1; n.flash = 0; n.mesh.position.set(0, 0, 0); n.mesh.rotation.z = 0; }
  if (intro.grid) intro.grid.material.opacity = 1;
  $('#intro-bar').style.width = '0';
  app.classList.remove('intro'); $('#welcome').classList.remove('show');
  goStage(0); setPlaying(true);
}
const skipIntro = () => { if (intro.active) intro.rate = 5; };

// ---------- hover tooltip ----------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), tip = $('#tip');
canvas.addEventListener('pointermove', (e) => {
  if (!state.ready) return;
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(pickables, false).find((h) => (() => { const n = nodes.get(h.object.userData.link); return n.op * n.arrive > 0.5; })());
  if (!hit) { tip.hidden = true; return; }
  const name = hit.object.userData.link, m = linksMeta[name];
  const sm = document.createElement('small');
  sm.textContent = `${name}${m?.motor ? ` · ${t('motor')} ${motorsMeta[m.motor].en}` : ''}`;
  tip.replaceChildren(document.createTextNode(m ? tr(m) : name), sm);
  tip.style.left = `${e.clientX - viewer.getBoundingClientRect().left}px`;
  tip.style.top = `${e.clientY - viewer.getBoundingClientRect().top}px`;
  tip.hidden = false;
});
canvas.addEventListener('pointerleave', () => { tip.hidden = true; });

// ---------- sidebar ----------
const esc = (v) => String(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

const showRoot = () => { $('#side-root').hidden = false; $('#side-cat').hidden = true; };
const showCat = () => { $('#side-root').hidden = true; $('#side-cat').hidden = false; };

function sysRow(x, lang) {
  return `<button type="button" class="row" data-sys="${esc(x.id)}" aria-current="${state.selSys?.id === x.id}"><span class="t">${esc(x[lang])}</span><span class="n">${x.items.length}</span></button>`;
}

function renderSide() {
  if (!systems.length) return;
  const lang = state.lang, other = lang === 'th' ? 'en' : 'th';
  $('#tour').setAttribute('aria-pressed', String(state.mode === 'tour'));
  $('#tour-n').textContent = String(stages.length);
  $('#groups').innerHTML = Object.keys(groupsMeta).map((g) => {
    const n = Object.values(linksMeta).filter((m) => m.group === g).length;
    return `<button type="button" class="row" data-group="${esc(g)}" aria-current="${state.selGroup === g}"><span class="t">${esc(groupsMeta[g][lang])}</span><span class="n">${n}</span></button>`;
  }).join('');
  $('#parts-count').textContent = String(partsData.parts.length);
  $('#systems').innerHTML = systems.filter((x) => !x.extra).map((x) => sysRow(x, lang)).join('');
  $('#extras').innerHTML = systems.filter((x) => x.extra).map((x) => sysRow(x, lang)).join('');
  const sys = state.selSys;
  if (sys) {
    $('#cat-head').innerHTML = `<div class="tg" style="color:${esc(sys.color)}">${esc(tagOf(sys))}</div><div class="t">${esc(sys[lang])}</div><div class="s">${esc(sys.sum[lang])}</div>`;
    $('#plist').innerHTML = sys.items.map((id) => {
      const p = partOf(id), isX = Boolean(p.note);
      const sub = isX ? esc(p.src || `${UI[lang].page_ref} ${p.page}`) : `${esc(p[other])}${p.partNo ? ` · ${esc(p.partNo)}` : ''}`;
      return `<button type="button" class="prow" data-item="${esc(id)}" aria-current="${state.selPart === id}">
        <span class="n">${isX ? '' : id}</span><span class="t">${esc(p[lang])}<small>${sub}</small></span><span class="q">${isX ? '' : `×${p.qty}`}</span></button>`;
    }).join('');
  }
}

$('#groups').addEventListener('click', (e) => { const b = e.target.closest('[data-group]'); if (b) selectGroup(b.dataset.group); });
for (const host of ['#systems', '#extras']) $(host).addEventListener('click', (e) => { const b = e.target.closest('[data-sys]'); if (b) selectSys(b.dataset.sys); });
$('#plist').addEventListener('click', (e) => { const b = e.target.closest('[data-item]'); if (b) selectPart(/^\d+$/.test(b.dataset.item) ? +b.dataset.item : b.dataset.item); });
$('#back').addEventListener('click', () => { state.selPart = null; state.selSys = null; showRoot(); if (state.mode === 'view') startTour(); else renderSide(); });
$('#tour').addEventListener('click', startTour);

const app = $('#app'), scrim = $('#scrim');
function openDrawer() { app.classList.add('open'); scrim.hidden = false; }
function closeDrawer() { app.classList.remove('open'); scrim.hidden = true; }
$('#menu').addEventListener('click', openDrawer);
scrim.addEventListener('click', closeDrawer);

// ---------- command palette ----------
const pal = $('#palette'), q = $('#q'), res = $('#results');
let items = [], sel = 0;
function buildItems(term) {
  const n = term.trim().toLowerCase();
  const all = [
    ...stages.map((s, i) => ({ kind: 'stage', label: tr(s).title, hint: `${t('stage')} ${i + 1}`, hay: `${s.th.title} ${s.en.title}`.toLowerCase(), i })),
    ...systems.map((x) => ({ kind: 'sys', label: x[state.lang], hint: UI[state.lang].system, hay: `${x.th} ${x.en}`.toLowerCase(), id: x.id })),
    ...partsData.parts.map((p) => ({ kind: 'part', label: p[state.lang], hint: `${sysOf(p.item)?.id} ×${p.qty}`, hay: `${p.th} ${p.en} ${p.partNo}`.toLowerCase(), id: p.item })),
    ...extras.map((p) => ({ kind: 'part', label: p[state.lang], hint: UI[state.lang].extra, hay: `${p.th} ${p.en}`.toLowerCase(), id: p.id })),
  ];
  return (n ? all.filter((x) => x.hay.includes(n)) : all.filter((x) => x.kind !== 'part')).slice(0, 8);
}
function renderResults() {
  items = buildItems(q.value); sel = Math.min(sel, Math.max(items.length - 1, 0));
  q.setAttribute('aria-activedescendant', items.length ? `opt-${sel}` : '');
  res.innerHTML = items.length ? items.map((x, i) => `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === sel}">
    <span>${esc(x.label)}</span><small>${esc(x.hint)}</small></li>`).join('') : `<li class="none">${t('none')}</li>`;
}
let lastFocus = null;
function openPalette() { lastFocus = document.activeElement; pal.hidden = false; q.value = ''; sel = 0; renderResults(); q.focus(); }
function closePalette() { pal.hidden = true; lastFocus?.focus?.(); }
function choose(x) {
  if (!x) return;
  closePalette();
  if (x.kind === 'stage') { goStage(x.i); setPlaying(false); return; }
  if (x.kind === 'sys') { selectSys(x.id); return; }
  selectPart(x.id);
  requestAnimationFrame(() => document.querySelector(`.prow[data-item="${x.id}"]`)?.scrollIntoView({ block: 'center' }));
}
q.addEventListener('input', () => { sel = 0; renderResults(); });
res.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) choose(items[+li.dataset.i]); });
pal.addEventListener('click', (e) => { if (e.target === pal) closePalette(); });
$('#open-palette').addEventListener('click', openPalette);
addEventListener('keydown', (e) => {
  const typing = /input|textarea/i.test(document.activeElement?.tagName);
  const busy = !state.ready || intro.active;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    if (busy) return; e.preventDefault(); pal.hidden ? openPalette() : closePalette(); return; }
  if (e.key === '/' && !typing && pal.hidden && !busy) { e.preventDefault(); openPalette(); return; }
  if (!pal.hidden) {
    if (e.key === 'Escape') closePalette();
    else if (e.key === 'Tab') e.preventDefault();
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); renderResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderResults(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(items[sel]); }
    return;
  }
  if (e.key === 'Escape') closeDrawer();
  if (typing) return;
  if (busy) return;
  if (e.key === 'ArrowRight') goStage(state.mode === 'tour' ? state.stage + 1 : 0);
  else if (e.key === 'ArrowLeft') goStage(state.mode === 'tour' ? state.stage - 1 : 0);
  else if (e.key === ' ' && document.activeElement === document.body && state.mode === 'tour') { e.preventDefault(); setPlaying(!state.playing); }
});

// ---------- controls + boot ----------
$('#skip').addEventListener('click', skipIntro);
$('#replay').addEventListener('click', () => { closeDrawer(); showRoot(); state.selGroup = state.selSys = state.selPart = null; startIntro(); });
canvas.addEventListener('pointerdown', skipIntro);
addEventListener('keydown', (e) => { if (intro.active && (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); skipIntro(); } }, true);
$('#prev').addEventListener('click', () => goStage(state.stage - 1));
$('#next').addEventListener('click', () => goStage(state.stage + 1));
$('#play').addEventListener('click', () => setPlaying(!state.playing));
document.querySelectorAll('.lang').forEach((b) => b.addEventListener('click', () => { state.lang = b.dataset.lang; applyLang(); }));

async function boot() {
  try {
    const [st, lk, pt, sy] = await Promise.all(['stages', 'links', 'parts', 'systems'].map((n) =>
      fetch(`data/${n}.json`).then((r) => { if (!r.ok) throw new Error(`${n}.json ${r.status}`); return r.json(); })));
    stages = st.stages; views = st.views; channels = st.channels; linksMeta = lk.links; groupsMeta = lk.groups; motorsMeta = lk.motors; partsData = pt; systems = sy.systems; extras = sy.extras;
    $('#dots').innerHTML = stages.map((s, i) => `<button type="button" role="tab" aria-label="${UI.th.stage} ${i + 1}" data-i="${i}"></button>`).join('');
    $('#dots').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) goStage(+b.dataset.i); });
    applyLang();
    requestAnimationFrame(frame);
    await loadRobot();
    state.ready = true; loading.failed = false; $('#loading').classList.add('done');
    startIntro();
  } catch (err) {
    console.error(err);
    app.classList.remove('intro'); loading.failed = true; $('#loading').classList.remove('done'); renderLoading();
  }
}
boot();
