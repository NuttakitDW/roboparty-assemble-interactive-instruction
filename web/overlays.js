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
  const can = new THREE.Group(); urdfRoot.add(can); can.visible = false;
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
  const segs = [];
  const boardMat = new THREE.MeshBasicMaterial({ color: '#e4e4e7', transparent: true });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.012), boardMat); can.add(board);
  for (const ch of channels) {
    const names = ['board', ...ch.chain];
    for (let i = 0; i < names.length - 1; i += 1) {
      const m = new THREE.Mesh(cyl, new THREE.MeshBasicMaterial({ color: ch.color, transparent: true })); can.add(m);
      segs.push({ m, ch: ch.id, key: `${names[i]}>${names[i + 1]}`, from: names[i], to: names[i + 1], r: i === 0 ? 0.008 : 0.005, a: 0 });
    }
  }

  // Floating labels.
  const pins = [];
  const addPin = (id, pos) => { const el = document.createElement('div'); el.className = 'pin mono'; host.appendChild(el); pins.push({ id, el, pos }); };
  addPin('imu', () => { imu.getWorldPosition(tmp); return tmp; });
  addPin('board', () => { board.getWorldPosition(tmp); return tmp; });
  channels.forEach((ch) => addPin(ch.id, () => { nodes.get(ch.chain[0]).group.getWorldPosition(tmp); return tmp; }));

  let aImu = 0, aCan = 0, progress = null, boardOn = true, boardA = 0; // progress: Set of 'from>to' keys, or null for all
  const proj = new THREE.Vector3();

  return {
    // Show only the given hops (build mode). null shows everything. Either direction of a key matches.
    setProgress(keys, board = true) { progress = keys; boardOn = board; },
    update(dt, overlay, camera, w, h, lang) {
      aImu = damp(aImu, overlay === 'imu' ? 1 : 0, 4, dt); aCan = damp(aCan, overlay === 'can' ? 1 : 0, 4, dt);
      imu.visible = aImu > 0.01; can.visible = aCan > 0.01;
      if (imu.visible) { imu.traverse((o) => { if (o.material) o.material.opacity = aImu; }); axes.material.opacity = aImu * 0.8; }
      if (can.visible) {
        urdfRoot.updateMatrixWorld(true);
        const t = local('torso_link', a); board.position.set(t.x - 0.03, t.y, t.z + 0.1);
        boardA = damp(boardA, boardOn ? 1 : 0, 5, dt); boardMat.opacity = aCan * boardA * 0.9; board.visible = boardA > 0.02;
        for (const s of segs) {
          const p0 = s.from === 'board' ? a.copy(board.position) : local(s.from, a);
          const p1 = local(s.to, b);
          const d = tmp.subVectors(p1, p0), len = d.length() || 1e-4;
          s.m.position.copy(p0).addScaledVector(d, 0.5); s.m.scale.set(s.r, len, s.r);
          const on = !progress || progress.has(s.key) || progress.has(`${s.to}>${s.from}`);
          s.a = damp(s.a, on ? 1 : 0, 6, dt); s.m.visible = s.a > 0.02;
          s.m.quaternion.setFromUnitVectors(Y, d.divideScalar(len)); s.m.material.opacity = aCan * s.a * 0.95;
        }
      }
      for (const p of pins) {
        const chOn = !progress || segs.some((s) => s.ch === p.id && s.a > 0.5);
        const on = (p.id === 'imu' ? aImu : aCan) > 0.3 && (p.id === 'board' ? boardA > 0.5 : (p.id === 'imu' || chOn));
        if (!on) { p.el.style.opacity = '0'; continue; }
        proj.copy(p.pos()).project(camera);
        const behind = proj.z > 1;
        p.el.style.opacity = behind ? '0' : '1';
        p.el.style.transform = `translate(${(proj.x * 0.5 + 0.5) * w + 8}px, ${(-proj.y * 0.5 + 0.5) * h - 8}px)`;
        p.el.textContent = text(p.id, lang);
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
