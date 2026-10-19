// Build mode: practise the assembly step by step, following the manual's order.
// Text, parts and fasteners come from data/assembly.json (extracted from the manual). The 3D view is joint-level only:
// links appear in an approximate order per phase, so the manual's own figure is always shown next to each step.
import * as THREE from 'three';

const STORE_KEY = 'build.v1';
const IMG_BASE = 'manual/img/';
const AUDIO_BASE = 'assets/tts/';
const VOICE_KEY = 'build.voice';

// Motor Slave ID (hex) -> the URDF link whose joint it drives (leg: yaw, roll, pitch, knee, ankle pitch, ankle roll).
const ID_LINK = (() => {
  const m = {};
  const leg = (s) => ['thigh_yaw', 'thigh_roll', 'thigh_pitch', 'knee', 'ankle_pitch', 'ankle_roll'].map((j) => `${s}_${j}_link`);
  const arm = (s) => ['arm_pitch', 'arm_roll', 'arm_yaw', 'elbow_pitch', 'elbow_yaw'].map((j) => `${s}_${j}_link`);
  leg('left').forEach((l, i) => { m[1 + i] = l; });
  leg('right').forEach((l, i) => { m[7 + i] = l; });
  m[13] = 'torso_link';
  arm('left').forEach((l, i) => { m[14 + i] = l; });
  arm('right').forEach((l, i) => { m[19 + i] = l; });
  return m;
})();
const hexLink = (h) => ID_LINK[parseInt(h, 16)];
const mirror = (n) => (n.startsWith('left_') ? n.replace('left_', 'right_') : n.startsWith('right_') ? n.replace('right_', 'left_') : n);

// Wiring steps close in on the hops they add, seen from the robot's front-right; the distance is fitted to the visible part of the viewer.
const CAM_DIR = new THREE.Vector3(0.78, 0.22, 0.58).normalize();
const CAM_NEAR = 0.95, CAM_FAR = 4.5, CAM_FILL = 0.75;

// Legs are built apart from the hip, then slide in at the connection step.
const DETACH = { left_thigh_pitch_link: new THREE.Vector3(0.05, 0.3, -0.05), right_thigh_pitch_link: new THREE.Vector3(0.05, -0.3, -0.05) };

const T = {
  th: { open: 'โหมดลองต่อตามคู่มือ', openSub: 'ซ้อมต่อทีละขั้นตอนก่อนต่อจริง', resume: 'ต่อจากขั้นตอนที่', exit: 'ออกจากโหมดลองต่อ', progress: 'ความคืบหน้า',
    step: 'ขั้นตอนที่', page: 'คู่มือหน้า', pdf: 'PDF', parts: 'ชิ้นส่วน', fasteners: 'น็อตและตัวยึด', notes: 'หมายเหตุ', warn: 'คำเตือน', gate: 'เช็กลิสต์ความปลอดภัย',
    prev: 'ย้อนกลับ', next: 'ติดตั้งแล้ว ถัดไป', done: 'เสร็จสิ้นทั้งหมด', skip: 'ข้ามเช็กลิสต์ขั้นนี้', reset: 'เริ่มใหม่', positioning: 'สำหรับกำหนดตำแหน่ง',
    figure: 'ดูภาพประกอบในคู่มือ', expand: 'แตะเพื่อขยาย/ย่อ', noText: 'ขั้นตอนนี้มีแต่ภาพประกอบ ดูรูปด้านบน', unsure: 'ข้อมูลขั้นตอนนี้ยังไม่ชัดเจน ให้ยึดภาพในคู่มือ',
    model: 'โมเดล 3 มิติเป็นระดับข้อต่อ ลำดับที่ชิ้นปรากฏเป็นการประมาณ ให้ยึดภาพและข้อความของคู่มือเป็นหลัก', tick: 'ติ๊กเมื่อเตรียมครบ', allDone: 'ครบทุกขั้นตอนแล้ว ซ้อมต่อครบตามคู่มือ', resetConfirm: 'เริ่มใหม่ จะล้างความคืบหน้าและเช็กลิสต์ทั้งหมด ยืนยันหรือไม่?',
    wiringMotors: 'มอเตอร์', channel: 'ช่อง', voiceOn: 'เสียงบรรยาย: เปิด', voiceOff: 'เสียงบรรยาย: ปิด', replay: 'ฟังอีกครั้ง', stopVoice: 'หยุดเสียง' },
  en: { open: 'Practice build mode', openSub: 'Rehearse each step before the real build', resume: 'Resume at step', exit: 'Exit practice mode', progress: 'Progress',
    step: 'Step', page: 'Manual page', pdf: 'PDF', parts: 'Parts', fasteners: 'Screws and fasteners', notes: 'Notes', warn: 'Warning', gate: 'Safety checklist',
    prev: 'Back', next: 'Installed, next', done: 'All steps done', skip: 'Skip this checklist', reset: 'Start over', positioning: 'positioning',
    figure: 'View the manual figure', expand: 'tap to expand / collapse', noText: 'This step is a figure only; see the image above', unsure: 'This step is unclear; follow the manual figure',
    model: 'The 3D model is joint-level and the order pieces appear is approximate. Follow the manual figure and text.', tick: 'Tick when you have it ready', allDone: 'All steps complete: you have rehearsed the whole manual', resetConfirm: 'Start over? This clears all progress and checklists.',
    wiringMotors: 'Motors', channel: 'Channel', voiceOn: 'Narration: on', voiceOff: 'Narration: off', replay: 'Play again', stopVoice: 'Stop audio' },
};

export function createBuild({ $, esc, state, nodes, views, data, channels = [], narration = {}, getOverlays, getFrame, getLang, renderLegend, onExit, closeDrawer }) {
  const app = $('#app');
  const steps = data.phases.flatMap((p) => p.steps.map((s) => ({ ...s, phase: p, id: `${p.id}:${s.label}` })));
  const t = (k) => T[getLang()][k];
  const L = (o) => o[getLang()];

  let idx = 0, active = false, maxIdx = 0, finished = false;
  const completed = new Set(); // step ids the user moved past (next or skip)
  const ticks = {}; // step id -> Set of ticked item keys
  let derived = null, prevShown = new Set(), viewObj = null;
  const openPhases = new Set(), collapsed = new Set(); // phases the user expanded / collapsed by hand

  // ---- persistence (best effort) ----
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ idx, maxIdx, completed: [...completed], ticks: Object.fromEntries(Object.entries(ticks).map(([k, v]) => [k, [...v]])) })); } catch { /* storage unavailable */ } };
  const load = () => {
    try {
      const j = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (j) { idx = Math.min(j.idx || 0, steps.length - 1); maxIdx = Math.min(j.maxIdx || 0, steps.length - 1); (j.completed || []).forEach((c) => completed.add(c)); Object.entries(j.ticks || {}).forEach(([k, v]) => { ticks[k] = new Set(v); }); }
    } catch { /* ignore bad data */ }
  };
  load();

  // ---- narration (Paxa TTS, one clip per step and language; failures are silent) ----
  let voiceOn = true, playingLang = null;
  try { voiceOn = localStorage.getItem(VOICE_KEY) !== 'off'; } catch { /* default on */ }
  const audio = new Audio(); audio.preload = 'none';
  const clipFor = (s) => (narration[s.id]?.file ? `${AUDIO_BASE}${getLang()}/${narration[s.id].file}.mp3` : null);
  function stopVoice() { audio.pause(); playingLang = null; }
  function playVoice() {
    const src = clipFor(steps[idx]);
    if (!active || !voiceOn || !src) { stopVoice(); return; }
    audio.src = src; playingLang = getLang();
    audio.play().catch(() => { /* blocked or missing clip: stay silent */ });
  }

  // ---- what the 3D scene shows at step i (cumulative over all earlier steps) ----
  function derive(i) {
    const shown = new Set(), keys = new Set();
    let attached = false, board = false;
    for (let k = 0; k <= i; k += 1) {
      const s = steps[k];
      (s.reveal?.show || []).forEach((n) => shown.add(n));
      if (s.reveal?.attach) attached = true;
      if (s.phase.id === 'wiring') {
        const ids = (s.motors || []).map(hexLink).filter(Boolean);
        if (ids.length === 2) for (const [x, y] of [[ids[0], ids[1]], [mirror(ids[0]), mirror(ids[1])]]) { keys.add(`${x}>${y}`); keys.add(`${y}>${x}`); } // the document wires one side and says the other is the same
        if (ids.length === 1 && s.channel) keys.add(`board>${ids[0]}`);
        if (['2.4.2', '2.5', '2.6', '3'].includes(s.section) || String(s.section).startsWith('3.')) board = true;
      }
    }
    // wiring happens on the finished robot: everything is shown
    if (steps[i].phase.id === 'wiring' || ['calibration', 'cables', 'switches'].includes(steps[i].phase.id)) {
      attached = true;
      nodes.forEach((_, n) => shown.add(n));
    }
    return { shown, keys, attached, board };
  }

  function makeView() {
    const s = steps[idx], p = s.phase;
    const base = views[s.view || p.view];
    const ghost = p.ghost || s.overlay === 'imu';
    return { ...base, focus: ghost ? [] : ['all'], dim: 0.14, explode: 0, markers: false, legend: p.id === 'wiring' ? 'can' : null,
      overlay: s.overlay || p.overlay || null, tag: p.id, tagColor: '', note: null, th: { title: '', body: '' }, en: { title: '', body: '' } };
  }

  // What the manual says on this wiring step, drawn on the hops: the harness name, its spec and length, and the CAN channel for the trunk to the board.
  const harnessLine = (h) => `${h.spec} · ${h.len_cm} cm`;
  const trunkSteps = steps.filter((x) => x.phase.id === 'wiring' && x.channel && x.harness && x.motors?.length === 1);
  function calloutsFor(s) {
    if (s.phase.id !== 'wiring') return [];
    const color = (id) => channels.find((c) => c.id === id)?.color;
    const toBoard = (x) => ['board', hexLink(x.motors[0])]; // the trunk harness runs from the board to the first motor of its chain
    if (s.label === '2.5-e') return trunkSteps.map((x) => ({ pairs: [toBoard(x)], title: `${x.motors[0]} → ${x.channel}`, sub: `${x.harness.code} ${x.harness.name} · ${x.harness.len_cm} cm`, color: color(x.channel), at: 0.7, side: x.channel === 'CAN3' ? 'left' : 'right' }));
    const h = s.harness, ids = (s.motors || []).map(hexLink).filter(Boolean);
    if (!h) return [];
    if (ids.length === 2) return [{ pairs: [[ids[0], ids[1]], [mirror(ids[0]), mirror(ids[1])]], title: `${h.code} ${h.name}`, sub: harnessLine(h) }];
    if (ids.length === 1 && s.channel) return [{ pairs: [toBoard(s)], title: `${s.channel} · ${h.code} ${h.name}`, sub: harnessLine(h), color: color(s.channel), at: 0.7 }];
    return [];
  }

  function apply() {
    derived = derive(idx);
    for (const n of derived.shown) { if (!prevShown.has(n)) { const nd = nodes.get(n); if (nd) { nd.fly = 1; nd.flash = 1; } } }
    prevShown = new Set(derived.shown);
    viewObj = makeView();
    state.userMoved = false;
    renderLegend(viewObj);
    const ov = getOverlays();
    if (ov) {
      const wiring = steps[idx].phase.id === 'wiring';
      ov.setProgress(wiring ? derived.keys : null, derived.board || !wiring);
      ov.setCallouts(calloutsFor(steps[idx]));
    }
  }

  // ---- per-frame ----
  const dirOf = (n) => new THREE.Vector3(n.base.x * 2, n.base.y * 2 + (n.base.y >= 0 ? 0.3 : -0.3), -0.7).normalize().multiplyScalar(0.8);
  const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  function update(dt) {
    if (!active || !derived) return;
    for (const [name, n] of nodes) {
      n.arrive = damp(n.arrive, derived.shown.has(name) ? 1 : 0, 5, dt);
      n.fly = damp(n.fly, 0, 3.5, dt); n.flash = damp(n.flash, 0, 2.2, dt);
      if (n.fly > 0.01) n.mesh.position.copy(dirOf(n)).multiplyScalar(n.fly); else n.mesh.position.set(0, 0, 0);
      const target = DETACH[name] && !derived.attached ? DETACH[name] : null;
      if (target) n.detach.lerp(target, 1 - Math.exp(-dt * 3)); else n.detach.multiplyScalar(Math.exp(-dt * 3));
    }
    follow();
  }

  // viewObj is this step's own copy, so its camera goal may follow the hops (they move with the robot's sway).
  // The distance makes the hops fill CAM_FILL of the visible band (the viewer minus the header and, on phones, the bottom sheet), and the view is
  // shifted so they sit in the middle of that band.
  function follow() {
    const f = viewObj && getOverlays()?.focus, fr = f && getFrame();
    if (!fr?.band) return;
    const { fov, aspect, h, band } = fr, bandH = band.bottom - band.top, tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const d = Math.min(Math.max(f.radius / (CAM_FILL * tan * Math.min(aspect, bandH / h)), CAM_NEAR), CAM_FAR);
    const lift = ((band.top + band.bottom) / 2 - h / 2) / h * 2 * d * tan, c = f.center; // world units to look below (or above) the hops
    viewObj.target = [c.x, c.y + lift, c.z];
    viewObj.cam = [c.x + CAM_DIR.x * d, c.y + lift + CAM_DIR.y * d, c.z + CAM_DIR.z * d];
    viewObj.fit = true; // already framed for this layout: skip the phone offset
  }

  function restoreNodes() {
    for (const n of nodes.values()) { n.arrive = 1; n.fly = 0; n.flash = 0; n.detach.set(0, 0, 0); n.mesh.position.set(0, 0, 0); }
    getOverlays()?.setProgress(null, true); getOverlays()?.setCallouts([]);
  }

  // ---- panel + outline ----
  const itemsOf = (s) => {
    const out = [];
    (s.parts || []).forEach((p, i) => out.push({ k: `p${i}`, kind: 'parts', text: L(p) }));
    (s.fasteners || []).forEach((f, i) => out.push({ k: `f${i}`, kind: 'fasteners', text: L(f), role: f.role }));
    if (s.gate) data.gates[s.gate].items.forEach((g, i) => out.push({ k: `g${i}`, kind: 'gate', text: L(g), page: g.page }));
    return out;
  };
  const tickedAll = (s) => { const items = itemsOf(s); const set = ticks[s.id] || new Set(); return items.every((it) => set.has(it.k)); };

  function stepTitle(s) {
    if (s.gate && !s.th) return L(data.gates[s.gate]);
    if (s.phase.id === 'wiring') return s.label === 'BOM' ? (getLang() === 'th' ? 'ตรวจสายชุดให้ครบ' : 'Check the harnesses') : `${t('step')} ${s.label}`;
    return `${t('step')} ${s.label}`;
  }

  function renderPanel() {
    const focusId = $('#bpanel').contains(document.activeElement) ? document.activeElement.id : '';
    const s = steps[idx], p = s.phase, items = itemsOf(s), set = ticks[s.id] || new Set();
    const body = L({ th: s.th, en: s.en });
    const group = (kind, title) => {
      const rows = items.filter((it) => it.kind === kind);
      if (!rows.length) return '';
      return `<div class="bp-sec"><div class="bp-label mono">${esc(title)}</div>${rows.map((it) => `<label class="bp-item"><input type="checkbox" data-k="${esc(it.k)}"${set.has(it.k) ? ' checked' : ''}><span>${esc(it.text)}${it.role === 'positioning' ? ` <em>(${esc(t('positioning'))})</em>` : ''}${it.page ? ` <small class="mono">${esc(t('page'))} ${esc(String(it.page))}</small>` : ''}</span></label>`).join('')}</div>`;
    };
    const notes = (s.notes || []).map((n) => `<p class="bp-note${s.warning ? ' warn' : ''}">${esc(L(n))}</p>`).join('');
    const motors = (s.motors || []).length ? `<p class="bp-meta mono">${esc(t('wiringMotors'))} ${esc(s.motors.join(' - '))}${s.channel ? ` · ${esc(s.channel)}` : ''}</p>` : '';
    const fig = s.pdf ? `<a class="bp-fig" id="bp-fig" href="${IMG_BASE}p${esc(String(s.pdf).padStart(2, '0'))}.jpg" target="_blank" rel="noopener"><img src="${IMG_BASE}p${esc(String(s.pdf).padStart(2, '0'))}.jpg" alt="${esc(t('figure'))}" loading="lazy"><span class="mono">${s.printed != null ? `${esc(t('page'))} ${esc(String(s.printed))} (${esc(t('pdf'))} ${esc(String(s.pdf))})` : `${esc(t('pdf'))} ${esc(String(s.pdf))}`} · ${esc(t('expand'))}</span></a>` : '';
    const ok = tickedAll(s), last = idx === steps.length - 1;
    $('#bpanel').innerHTML = `
      <div class="bp-head"><span class="mono">${esc(L(p))} · ${idx + 1} / ${steps.length}</span><span class="bp-headbtns"><button type="button" id="bp-voice" class="bp-exitbtn" aria-pressed="${voiceOn}">${esc(t(voiceOn ? 'voiceOn' : 'voiceOff'))}</button><button type="button" id="bp-exit" class="bp-exitbtn">${esc(t('exit'))}</button></span></div>
      <div class="bp-bar"><i style="width:${((idx + 1) / steps.length) * 100}%"></i></div>
      <div class="bp-scroll">
        ${finished ? `<p class="bp-done">${esc(t('allDone'))}</p>` : ''}
        <h2>${esc(stepTitle(s))}</h2>
        ${s.phase.id === 'wiring' || s.gate ? '' : `<p class="bp-model mono">${esc(t('model'))}</p>`}
        ${fig}
        ${narration[s.id]?.file && voiceOn ? `<p class="bp-voice"><button type="button" id="bp-replay" class="link">${esc(t('replay'))}</button> <button type="button" id="bp-stopv" class="link">${esc(t('stopVoice'))}</button></p>` : ''}
        ${body ? `<p class="bp-body">${esc(body)}</p>` : (s.gate ? '' : `<p class="bp-body muted">${esc(t('noText'))}</p>`)}
        ${motors}
        ${group('gate', t('gate'))}${group('parts', t('parts'))}${group('fasteners', t('fasteners'))}
        ${notes}
        ${s.unsure ? `<p class="bp-note warn">${esc(t('unsure'))}</p>` : ''}
      </div>
      <div class="bp-foot">
        <button type="button" id="bp-prev"${idx === 0 ? ' disabled' : ''}>${esc(t('prev'))}</button>
        <button type="button" id="bp-next" class="primary"${ok && !finished ? '' : ' disabled'}>${esc(last ? t('done') : t('next'))}</button>
        ${ok || !items.length ? '' : `<button type="button" id="bp-skip" class="link">${esc(t('skip'))}</button>`}
      </div>`;
    if (focusId) {
      const live = (id) => { const el = id && $(`#${id}`); return el && !el.disabled ? el : null; };
      (live(focusId) || $('#bpanel input[type=checkbox]') || live('bp-next') || live('bp-prev'))?.focus();
    }
  }

  // Ticking a box must not rebuild the panel (it would drop focus and scroll position): only update the footer.
  function refreshFoot() {
    const s = steps[idx], ok = tickedAll(s), items = itemsOf(s);
    const nextBtn = $('#bp-next'); if (nextBtn) nextBtn.disabled = !ok || finished;
    const skip = $('#bp-skip');
    if (skip) skip.hidden = ok || !items.length;
    else if (!ok && items.length) $('#bp-prev')?.parentElement.insertAdjacentHTML('beforeend', `<button type="button" id="bp-skip" class="link">${esc(t('skip'))}</button>`);
  }

  function renderOutline() {
    let k = 0;
    const html = data.phases.map((p) => {
      const first = k, rows = p.steps.map((raw) => {
        const i = k; k += 1; const s = steps[i];
        const cls = `brow${completed.has(s.id) ? ' done' : ''}`;
        const txt = L({ th: s.th || '', en: s.en || '' }) || (s.parts?.[0] && L(s.parts[0])) || (s.fasteners?.[0] && L(s.fasteners[0])) || (s.notes?.[0] && L(s.notes[0])) || (s.gate && L(data.gates[s.gate])) || '';
        const hint = txt.slice(0, 44);
        return `<button type="button" class="${cls}" data-bi="${i}" aria-current="${i === idx}"><span class="bl mono">${esc(s.label)}</span><span class="bt">${esc(hint)}</span></button>`;
      }).join('');
      const cur = idx >= first && idx < k;
      return `<details class="bph" data-ph="${esc(p.id)}"${(cur && !collapsed.has(p.id)) || openPhases.has(p.id) ? ' open' : ''}><summary><span>${esc(L(p))}</span><span class="n mono">${p.steps.length}</span></summary>${rows}</details>`;
    }).join('');
    $('#side-build').innerHTML = `<div class="bs-head"><div class="t">${esc(t('open'))}</div><div class="s mono">${esc(t('progress'))} ${idx + 1} / ${steps.length}</div><button type="button" id="bs-reset" class="link">${esc(t('reset'))}</button></div>${html}`;
  }

  function render() {
    if (!active) { renderEntry(); return; }
    if (playingLang && playingLang !== getLang()) playVoice(); // language switched while narrating
    renderPanel(); renderOutline();
    if (viewObj) renderLegend(viewObj);
    const box = $('#side-build'), row = box.querySelector('.brow[aria-current="true"]');
    if (row) { // scroll the outline only (scrollIntoView could also scroll the page on phones)
      const c = box.getBoundingClientRect(), r = row.getBoundingClientRect();
      if (r.top < c.top || r.bottom > c.bottom) box.scrollTop += (r.top - c.top) - c.height / 2;
    }
  }

  function renderEntry() {
    const el = $('#build-open'); if (!el) return;
    el.innerHTML = `<span>${esc(t('open'))}</span><span class="mono">${maxIdx > 0 ? `${idx + 1}/${steps.length}` : steps.length}</span>`;
    el.title = t('openSub');
  }

  function go(i) {
    idx = Math.max(0, Math.min(i, steps.length - 1)); maxIdx = Math.max(maxIdx, idx); finished = false;
    apply(); render(); save(); playVoice();
  }

  function enter() {
    active = true; state.mode = 'build'; state.view = null; state.selGroup = state.selSys = state.selPart = null;
    $('#side-root').hidden = true; $('#side-cat').hidden = true; $('#side-build').hidden = false;
    app.classList.add('building'); $('#bpanel').hidden = false;
    prevShown = new Set(derive(idx).shown); go(idx); closeDrawer(); // resuming must not replay the fly-in of everything shown so far
  }

  function exit(silent = false) {
    if (!active) return;
    active = false; app.classList.remove('building'); $('#bpanel').hidden = true; $('#side-build').hidden = true;
    stopVoice(); restoreNodes(); renderEntry();
    if (!silent) onExit();
  }

  const next = () => {
    completed.add(steps[idx].id);
    if (idx < steps.length - 1) go(idx + 1);
    else { finished = true; save(); render(); }
  };
  const prev = () => go(idx - 1);

  // ---- events ----
  $('#bpanel').addEventListener('change', (e) => {
    const k = e.target?.dataset?.k; if (!k) return;
    const id = steps[idx].id; const set = ticks[id] || (ticks[id] = new Set());
    if (e.target.checked) set.add(k); else set.delete(k);
    save(); refreshFoot();
  });
  $('#bpanel').addEventListener('click', (e) => {
    const fig = e.target.closest('#bp-fig');
    if (fig && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); fig.classList.toggle('open'); return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'bp-next' && !b.disabled) next();
    else if (b.id === 'bp-prev') prev();
    else if (b.id === 'bp-skip') next();
    else if (b.id === 'bp-exit') exit();
    else if (b.id === 'bp-voice') { voiceOn = !voiceOn; try { localStorage.setItem(VOICE_KEY, voiceOn ? 'on' : 'off'); } catch { /* ignore */ } if (voiceOn) playVoice(); else stopVoice(); renderPanel(); }
    else if (b.id === 'bp-replay') playVoice();
    else if (b.id === 'bp-stopv') stopVoice();
  });
  $('#side-build').addEventListener('click', (e) => {
    const r = e.target.closest('[data-bi]'); if (r) { go(+r.dataset.bi); closeDrawer(); return; }
    if (e.target.id === 'bs-reset' && confirm(t('resetConfirm'))) { Object.keys(ticks).forEach((k) => delete ticks[k]); completed.clear(); idx = 0; maxIdx = 0; prevShown = new Set(); go(0); }
  });
  $('#side-build').addEventListener('click', (e) => {
    const sum = e.target.closest('summary'); if (!sum) return;
    const d = sum.parentElement, ph = d.dataset.ph;
    setTimeout(() => { // after the browser has toggled <details>
      if (d.open) { openPhases.add(ph); collapsed.delete(ph); } else { openPhases.delete(ph); collapsed.add(ph); }
    }, 0);
  });
  $('#build-open').addEventListener('click', enter);
  renderEntry();

  return { enter, exit, update, render, next, prev, view: () => viewObj, get active() { return active; }, steps };
}
