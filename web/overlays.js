// Schematic overlays drawn on top of the joint-level model: the IMU and the CAN wiring chains.
// Positions come from real data where it exists (URDF joint origins, MJCF IMU site); the rest is labelled approximate in the UI.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const Y = new THREE.Vector3(0, 1, 0);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export function createOverlays({ nodes, urdfRoot, host, channels, text }) {
  const tmp = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const local = (name, out) => { nodes.get(name).group.getWorldPosition(out); return urdfRoot.worldToLocal(out); };

  // IMU: HiPNUC HI14 (M12 straight) from the official 3D model, +x away from the connector (datasheet X axis), +z up.
  const imu = new THREE.Group();
  const axes = new THREE.AxesHelper(0.07); axes.material.transparent = true; axes.material.depthTest = false; axes.renderOrder = 12;
  imu.add(axes);
  nodes.get('base_link').group.add(imu); imu.visible = false;
  new GLTFLoader().loadAsync('assets/models/hi14m0-m12.glb').then((gltf) => {
    const looks = { housing: ['#e4e4e7', 0.25, 0.45], plate: ['#a1a1aa', 0.5, 0.5], connector: ['#a1a1aa', 0.8, 0.3], plug: ['#18181b', 0.1, 0.7] };
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const [color, metalness, roughness] = looks[o.parent?.name] || looks[o.name] || looks.housing;
      o.material?.dispose?.();
      o.material = new THREE.MeshStandardMaterial({ color, metalness, roughness, transparent: true });
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.028), new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.6, transparent: true }));
    label.position.set(0, 0, 0.0102); gltf.scene.add(label);
    imu.add(gltf.scene);
  }).catch((err) => { console.error('IMU model failed to load', err); });

  // CAN: one straight tube per hop, coloured by channel, plus a plate standing in for the 3-in-1 board.
  // The four ports sit in a row on the plate in the manual's order (CAN0..CAN3 are silkscreened on the real PCB).
  const can = new THREE.Group(); urdfRoot.add(can); can.visible = false;
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
  const segs = [];
  const boardMat = new THREE.MeshBasicMaterial({ color: '#e4e4e7', transparent: true });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.012), boardMat); can.add(board);
  const portAt = (i, out) => out.set(board.position.x + 0.035, board.position.y + (1.5 - i) * 0.015, board.position.z);
  const portGeo = new THREE.BoxGeometry(0.01, 0.011, 0.01);
  const ports = channels.map((ch) => {
    const m = new THREE.Mesh(portGeo, new THREE.MeshBasicMaterial({ color: ch.color, transparent: true })); can.add(m);
    return m;
  });
  channels.forEach((ch, ci) => {
    const names = ['board', ...ch.chain];
    for (let i = 0; i < names.length - 1; i += 1) {
      const m = new THREE.Mesh(cyl, new THREE.MeshBasicMaterial({ color: ch.color, transparent: true })); can.add(m);
      segs.push({ m, ch: ch.id, port: i === 0 ? ci : -1, key: `${names[i]}>${names[i + 1]}`, from: names[i], to: names[i + 1], r: i === 0 ? 0.008 : 0.005, a: 0, h: 0 });
    }
  });
  const segOf = (x, y) => segs.find((s) => (s.from === x && s.to === y) || (s.from === y && s.to === x));

  // Floating labels: the IMU, the board, each chain's first link (overview only) and each CAN port on the board.
  const pins = [];
  const addPin = (kind, id, pos, ch) => {
    const el = document.createElement('div'); el.className = 'pin mono'; host.appendChild(el);
    if (kind === 'port') { el.classList.add('port'); el.style.borderColor = ch.color; }
    pins.push({ kind, id, el, pos, ch, slot: ch ? channels.indexOf(ch) : 0 });
  };
  addPin('imu', 'imu', () => { imu.getWorldPosition(tmp); return tmp; });
  addPin('board', 'board', () => { board.getWorldPosition(tmp); return tmp; });
  channels.forEach((ch, ci) => {
    addPin('chain', ch.id, () => { nodes.get(ch.chain[0]).group.getWorldPosition(tmp); return tmp; });
    addPin('port', ch.id, () => { ports[ci].getWorldPosition(tmp); return tmp; }, ch);
  });

  // Callouts for the current build step: the harness it adds (name, spec, length) on each hop, as the manual names it.
  let callouts = [], focusKeys = new Set();
  const focus = { center: new THREE.Vector3(), radius: 0, on: false };
  const sum = new THREE.Vector3();
  function setCallouts(list) {
    callouts.forEach((c) => c.el.remove());
    callouts = []; focusKeys = new Set(); focus.on = false; // a stale goal must not outlive its step
    for (const item of list || []) {
      for (const [x, y] of item.pairs) {
        const seg = segOf(x, y); if (!seg) continue; // e.g. the mirrored side of a hop that only exists on one side
        const el = document.createElement('div'); el.className = 'pin call mono'; host.appendChild(el);
        const title = document.createElement('b'); title.textContent = item.title; el.appendChild(title);
        if (item.sub) { const sub = document.createElement('span'); sub.textContent = item.sub; el.appendChild(sub); }
        if (item.color) el.style.borderColor = item.color;
        callouts.push({ seg, el, at: item.at ?? 0.5, side: item.side || 'auto', pos: new THREE.Vector3(), anchor: new THREE.Vector3(), ndc: new THREE.Vector3(), on: false, show: false }); focusKeys.add(seg.key);
      }
    }
  }

  let aImu = 0, aCan = 0, progress = null, boardOn = true, boardA = 0; // progress: Set of 'from>to' keys, or null for all
  const proj = new THREE.Vector3();
  // Label layout. Each label tries spots beside its anchor (preferred side first, then the other, then rows up and down) and keeps the first one that is
  // inside the visible band and clear of everything placed before it. Narrow viewers get a second pass that slides labels sideways into view. A label
  // that is not `required` and finds no clear spot is hidden; a required one sits at its preferred spot, clamped into view.
  const placed = [];
  const clear = (r) => !placed.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
  const ROWS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
  const put = (el, ax, ay, dx, dy, leftOf, w, band, required = false) => {
    const bw = el.offsetWidth, bh = el.offsetHeight, lo = band ? band.top : -1e9, hi = band ? band.bottom : 1e9;
    const sides = leftOf ? [-1, 1] : [1, -1], fitX = (x) => Math.min(Math.max(x, 4), Math.max(w - bw - 4, 4));
    let spot = null;
    for (const slide of [false, true]) {
      for (const k of ROWS) {
        for (const side of sides) {
          const x0 = side > 0 ? ax + dx : ax - dx - bw, x = slide ? fitX(x0) : x0;
          const r = { x, y: ay + dy + k * (bh + 6), w: bw, h: bh };
          if (r.x >= 4 && r.x + bw <= w - 4 && r.y >= lo && r.y + bh <= hi && clear(r)) { spot = r; break; }
        }
        if (spot) break;
      }
      if (spot) break;
    }
    if (!spot && !required) { el.style.opacity = '0'; return; }
    if (!spot) spot = { x: fitX(leftOf ? ax - dx - bw : ax + dx), y: Math.min(Math.max(ay + dy, lo), Math.max(hi - bh, lo)), w: bw, h: bh };
    placed.push(spot);
    el.style.opacity = '1';
    el.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
  };
  const px = (ndc, w, h, out) => out.set((ndc.x * 0.5 + 0.5) * w, (-ndc.y * 0.5 + 0.5) * h);
  const anchorPx = new THREE.Vector2();
  const seen = (ndc, w, h, band) => { px(ndc, w, h, anchorPx); return ndc.z <= 1 && anchorPx.x > -20 && anchorPx.x < w + 20 && anchorPx.y > (band ? band.top - 24 : -20) && anchorPx.y < (band ? band.bottom + 24 : h + 20); };
  const RANK = { port: 0, board: 1, imu: 1, chain: 2 };
  const pinOrder = [...pins].sort((p, q) => RANK[p.kind] - RANK[q.kind]); // the labels the step is about get the best spots

  return {
    // Show only the given hops (build mode). null shows everything. Either direction of a key matches.
    setProgress(keys, board = true) { progress = keys; boardOn = board; },
    setCallouts,
    // Bounding sphere (world space) of the hops carrying a callout, or null: build mode points the camera at it.
    get focus() { return focus.on ? focus : null; },
    // band: the part of the viewer that is visible (not under the header or a bottom sheet), with `obstacles` rects labels keep clear of; null = all of it
    update(dt, overlay, camera, w, h, lang, band = null) {
      aImu = damp(aImu, overlay === 'imu' ? 1 : 0, 4, dt); aCan = damp(aCan, overlay === 'can' ? 1 : 0, 4, dt);
      imu.visible = aImu > 0.01; can.visible = aCan > 0.01;
      if (imu.visible) { imu.traverse((o) => { if (o.material) o.material.opacity = aImu; }); axes.material.opacity = aImu * 0.8; }
      if (can.visible) {
        urdfRoot.updateMatrixWorld(true);
        const t = local('torso_link', a); board.position.set(t.x - 0.03, t.y, t.z + 0.1);
        boardA = damp(boardA, boardOn ? 1 : 0, 5, dt); boardMat.opacity = aCan * boardA * 0.9; board.visible = boardA > 0.02;
        ports.forEach((m, i) => { portAt(i, m.position); m.visible = board.visible; m.material.opacity = aCan * boardA; });
        for (const s of segs) {
          const p0 = s.from === 'board' ? portAt(s.port, a) : local(s.from, a);
          const p1 = local(s.to, b);
          const d = tmp.subVectors(p1, p0), len = d.length() || 1e-4;
          const on = !progress || progress.has(s.key) || progress.has(`${s.to}>${s.from}`);
          s.a = damp(s.a, on ? 1 : 0, 6, dt); s.m.visible = s.a > 0.02;
          s.h = damp(s.h, focusKeys.has(s.key) ? 1 : 0, 6, dt); // the hops of the current step are drawn thicker, the rest recede
          s.m.position.copy(p0).addScaledVector(d, 0.5); s.m.scale.set(s.r * (1 + 0.35 * s.h), len, s.r * (1 + 0.35 * s.h));
          s.m.quaternion.setFromUnitVectors(Y, d.divideScalar(len));
          s.m.material.opacity = aCan * s.a * (focusKeys.size ? 0.4 + 0.55 * s.h : 0.95);
        }
      }
      let live = 0; sum.set(0, 0, 0);
      for (const c of callouts) {
        c.seg.m.getWorldPosition(c.pos); // by geometry, so the camera need not wait for the hop to fade in
        c.on = aCan > 0.3 && c.seg.a > 0.5; // the label does
        if (aCan > 0.3) { sum.add(c.pos); live += 1; }
      }
      focus.on = live > 0;
      if (focus.on) {
        sum.divideScalar(live); focus.center.copy(sum); focus.radius = 0;
        for (const c of callouts) focus.radius = Math.max(focus.radius, c.pos.distanceTo(sum) + c.seg.m.scale.y / 2);
      }
      placed.length = 0; if (band?.obstacles) placed.push(...band.obstacles);
      let autos = 0;
      for (const c of callouts) {
        c.show = false;
        if (!c.on) { c.el.style.opacity = '0'; continue; }
        c.seg.m.updateWorldMatrix(true, false); c.anchor.set(0, c.at - 0.5, 0); c.seg.m.localToWorld(c.anchor); // a point `at` of the way from the hop's start to its end
        c.ndc.copy(c.anchor).project(camera);
        c.show = seen(c.ndc, w, h, band);
        if (!c.show) c.el.style.opacity = '0';
        else if (c.side === 'auto') autos += 1;
      }
      for (const c of callouts) { // labels without a fixed side flank their hops (leftmost half to the left), so a mirrored pair does not overlap
        if (!c.show) continue;
        let leftOf = c.side === 'left';
        if (c.side === 'auto' && autos > 1) { let rank = 0; for (const o of callouts) if (o.show && o.side === 'auto' && o.ndc.x < c.ndc.x) rank += 1; leftOf = rank < autos / 2; }
        px(c.ndc, w, h, anchorPx); put(c.el, anchorPx.x, anchorPx.y, 12, -14, leftOf, w, band, true);
      }
      for (const p of pinOrder) {
        const showing = (p.kind === 'imu' ? aImu : aCan) > 0.3;
        // chain-head labels are for the overview; in build mode the callouts and port labels say it (a port shows once its trunk harness is in).
        const on = showing && (p.kind === 'imu' || (p.kind === 'board' ? boardA > 0.5 : p.kind === 'chain' ? !progress : !!progress && segs.some((s) => s.ch === p.id && s.port >= 0 && s.a > 0.5)));
        if (!on) { p.el.style.opacity = '0'; continue; }
        const label = text(p.id, lang);
        if (p.el.textContent !== label) p.el.textContent = label;
        proj.copy(p.pos()).project(camera);
        if (!seen(proj, w, h, band)) { p.el.style.opacity = '0'; continue; }
        if (p.kind === 'board') put(p.el, anchorPx.x, anchorPx.y, 10, -8, true, w, band);
        else if (p.kind === 'port') put(p.el, anchorPx.x, anchorPx.y, 10, -8 - p.slot * (p.el.offsetHeight + 2), false, w, band); // the ports sit a few cm apart: fan their labels out so they stay readable
        else put(p.el, anchorPx.x, anchorPx.y, 8, -8, false, w, band);
      }
    },
  };
}

function labelTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f5'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#18181b'; g.fillStyle = '#18181b'; g.lineWidth = 5; g.lineCap = 'round';
  const arrow = (x0, y0, x1, y1) => {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const ang = Math.atan2(y1 - y0, x1 - x0);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 16 * Math.cos(ang - 0.4), y1 - 16 * Math.sin(ang - 0.4));
    g.lineTo(x1 - 16 * Math.cos(ang + 0.4), y1 - 16 * Math.sin(ang + 0.4)); g.closePath(); g.fill();
  };
  arrow(150, 100, 150, 22); arrow(150, 100, 60, 100); // X up, Y left (Z out of the page)
  g.beginPath(); g.arc(150, 100, 9, 0, 7); g.stroke(); g.beginPath(); g.arc(150, 100, 2.5, 0, 7); g.fill();
  g.font = 'bold 26px sans-serif'; g.fillText('X', 160, 40); g.fillText('Y', 62, 132); g.fillText('Z', 100, 90);
  g.font = '900 40px sans-serif'; g.fillText('H', 34, 214); g.fillStyle = '#2563eb'; g.fillText('i', 62, 214); g.fillStyle = '#18181b'; g.fillText('PNUC', 76, 214);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}
