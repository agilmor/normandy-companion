// Dice thrown in 3D over the board: every Attack, Suppress and Blast roll, by themselves (no gesture).
// Copied from 56_Valpiedra/src/ui/dice3d.js (itself from 50's Paranormal and 53_Constantinople_Inv_Eng), with the
// d10 of Undaunted added (a pentagonal trapezohedron, faces 0–9, opposite faces adding up to 9) and the colours of
// the two sides; the d4, d6 and d8 stay as they were.
//
// The engine decides the values, not the physics: the throw is simulated in full beforehand (cannon-es),
// it sees which face (or, on a d4, which corner) ends up on top, and turns the model of each die inside
// its physical body, by one of the rotations that leave the solid as it is, so that the face on top
// carries the value asked for. The paths are real physics; only the numbers on the faces are chosen.
// Then the recorded simulation is played back (three.js).
//
//   const tray = createDiceTray();
//   await tray.roll([{ sides: 10, value: 7, color: 'us' }, { sides: 10, value: 0, color: 'us' }], { rect, rate });
//   tray.skip();  tray.destroy();
//
// three.js r169 and cannon-es 0.20 (MIT), in vendor/. combat.js loads this module with import() the first
// time it is needed; without WebGL the game goes on with flat dice.

import * as THREE from '../../vendor/three.module.min.js';
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';
import * as CANNON from '../../vendor/cannon-es.js';

const HZ = 60; // simulation and playback steps per second
const HOLD = 650; // ms the dice stay in sight once they stop

const COLORS = {
    us: { face: '#2f8a3d', ink: '#fbf7ea', edge: '#173f1d' }, // the attacker's side
    de: { face: '#2b7a86', ink: '#fbf7ea', edge: '#123a40' },
    black: { face: '#1c1a20', ink: '#f2ead8', edge: '#000' },
    red: { face: '#a8231b', ink: '#fff4ec', edge: '#4a0c08' },
    gold: { face: '#1c1a20', ink: '#e6b54c', edge: '#000' }, // Dan's d8
    row: { face: '#efe9dc', ink: '#26222b', edge: '#8a8070' },
    column: { face: '#3f5f8f', ink: '#ffffff', edge: '#1d2d45' },
};

// ------------------------------------------------------------------ solids

/** The 24 rotations of the cube (and the octahedron): signed permutation matrices with determinant 1. */
const CUBE_GROUP = (() => {
    const out = [];
    for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
        for (let s = 0; s < 8; s++) {
            const e = Array(9).fill(0);
            for (let r = 0; r < 3; r++) e[r * 3 + p[r]] = (s >> r) & 1 ? -1 : 1;
            const m3 = new THREE.Matrix3().set(...e);
            if (Math.abs(m3.determinant() - 1) > 1e-6) continue;
            out.push(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(m3)));
        }
    }
    return out;
})();

const v3 = (a) => new THREE.Vector3(...a);
/** The rotations of `group` that leave the points `verts` (the solid) as they are. */
const keeping = (group, verts) => group.filter((q) => verts.every((a) => verts.some((b) => v3(a).applyQuaternion(q).distanceTo(v3(b)) < 1e-4)));

/** A solid with triangular faces: `faces` are vertex indices, wound outwards (counter-clockwise). */
function outward(verts, faces) {
    return faces.map(([a, b, c]) => {
        const [A, B, C] = [a, b, c].map((i) => v3(verts[i]));
        const n = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
        return n.dot(A.add(B).add(C)) < 0 ? [a, c, b] : [a, b, c];
    });
}

const R8 = 0.8; // vertex distance of the d8
const D8_VERTS = [[R8, 0, 0], [-R8, 0, 0], [0, R8, 0], [0, -R8, 0], [0, 0, R8], [0, 0, -R8]];
// one face per octant; opposite faces add up to 9, as on a real d8
const D8_OCTANTS = [[1, 1, 1, 1], [1, 1, -1, 2], [1, -1, 1, 3], [1, -1, -1, 4], [-1, 1, 1, 5], [-1, 1, -1, 6], [-1, -1, 1, 7], [-1, -1, -1, 8]];
const D8_FACES = outward(D8_VERTS, D8_OCTANTS.map(([x, y, z]) => [x > 0 ? 0 : 1, y > 0 ? 2 : 3, z > 0 ? 4 : 5]));

const R4 = 0.95; // vertex distance of the d4
const D4_VERTS = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((p) => p.map((x) => (x * R4) / Math.sqrt(3)));
// face k is the one opposite vertex k; a d4 is read on the corner that points up (each corner shows its number)
const D4_FACES = outward(D4_VERTS, [0, 1, 2, 3].map((k) => [0, 1, 2, 3].filter((i) => i !== k)));

// d10: two apexes on the y axis and a zigzag ring of ten vertices; every face is a flat kite
const R10 = 0.8; // ring radius
const K10 = 0.08; // the ring goes this far above and below the middle
const C36 = Math.cos(Math.PI / 5);
const H10 = (K10 * (1 + C36)) / (1 - C36); // the apex height that keeps each kite flat
const ring = (i, up) => {
    const a = (Math.PI / 5) * (2 * i + (up ? 0 : 1));
    return [R10 * Math.cos(a), up ? K10 : -K10, R10 * Math.sin(a)];
};
// 0 top apex, 1 bottom apex, 2–6 upper ring, 7–11 lower ring
const D10_VERTS = [[0, H10, 0], [0, -H10, 0], ...[0, 1, 2, 3, 4].map((i) => ring(i, true)), ...[0, 1, 2, 3, 4].map((i) => ring(i, false))];
const U = (i) => 2 + (i % 5);
const L = (i) => 7 + (i % 5);
/** Kites as [apex, side, far corner, side], wound outwards. */
const D10_FACES = [...[0, 1, 2, 3, 4].map((i) => [0, U(i), L(i), U(i + 1)]), ...[0, 1, 2, 3, 4].map((i) => [1, L(i), U(i + 1), L(i + 1)])].map((f) => {
    const [A, B, C] = f.slice(0, 3).map((i) => v3(D10_VERTS[i]));
    const n = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
    const mid = f.reduce((s, i) => s.add(v3(D10_VERTS[i])), new THREE.Vector3());
    return n.dot(mid) < 0 ? [f[0], f[3], f[2], f[1]] : f;
});
const D10_NORMALS = D10_FACES.map((f) => {
    const [A, B, C] = f.slice(0, 3).map((i) => v3(D10_VERTS[i]));
    return new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A)).normalize();
});
// the upper kites carry 0 2 4 6 8 round the die, each lower one 9 minus the kite opposite it
const D10_VALUES = (() => {
    const v = [0, 2, 4, 6, 8];
    for (let j = 5; j < 10; j++) {
        const opp = D10_NORMALS.findIndex((n, i) => i < 5 && n.dot(D10_NORMALS[j]) < -0.999);
        v[j] = 9 - v[opp];
    }
    return v;
})();
// its 10 rotations: turns of 72° about the axis, and half turns that swap the apexes
const D10_GROUP = (() => {
    const out = [];
    for (let k = 0; k < 10; k++) {
        const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.PI / 5) * k);
        out.push(turn.clone(), turn.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)));
    }
    return keeping(out, D10_VERTS);
})();

const SOLIDS = {
    10: {
        labels: Object.fromEntries(D10_VALUES.map((v, i) => [v, D10_NORMALS[i].toArray()])),
        group: D10_GROUP, verts: D10_VERTS, faces: D10_FACES,
    },
    6: { labels: { 1: [0, 1, 0], 6: [0, -1, 0], 2: [1, 0, 0], 5: [-1, 0, 0], 3: [0, 0, 1], 4: [0, 0, -1] }, group: CUBE_GROUP },
    8: {
        labels: Object.fromEntries(D8_OCTANTS.map(([x, y, z, v]) => [v, [x, y, z].map((c) => c / Math.sqrt(3))])),
        group: keeping(CUBE_GROUP, D8_VERTS), verts: D8_VERTS, faces: D8_FACES,
        faceValue: D8_FACES.map((f) => { const c = f.map((i) => D8_VERTS[i]).reduce((s, p) => s.map((x, k) => x + p[k]), [0, 0, 0]); return D8_OCTANTS.find(([x, y, z]) => Math.sign(c[0]) === x && Math.sign(c[1]) === y && Math.sign(c[2]) === z)[3]; }),
    },
    4: {
        labels: Object.fromEntries(D4_VERTS.map((p, i) => [i + 1, p.map((x) => x / R4)])),
        group: keeping(CUBE_GROUP, D4_VERTS), verts: D4_VERTS, faces: D4_FACES,
    },
};

/** The label (value) whose direction points most up, and how straight it is (1 = flat on the table). */
function upLabel(sides, q) {
    let best = 0;
    let dot = -2;
    for (const [v, n] of Object.entries(SOLIDS[sides].labels)) {
        const y = v3(n).applyQuaternion(q).y;
        if (y > dot) { dot = y; best = Number(v); }
    }
    return { value: best, dot };
}

/** The rotation of the solid's group that takes the label `from` to where the label `to` is. */
function rigFor(sides, from, to) {
    const { labels, group } = SOLIDS[sides];
    const a = v3(labels[from]);
    const b = v3(labels[to]);
    return (group.find((q) => a.clone().applyQuaternion(q).distanceTo(b) < 1e-4) ?? new THREE.Quaternion()).clone();
}

// ------------------------------------------------------------------ looks

const PIPS = {
    1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};
// a triangular face on its 256 px canvas: top, bottom left, bottom right (counter-clockwise, as the faces)
const TRI = [[128, 18], [14, 214], [242, 214]];
const textures = new Map();

function canvasTexture(key, draw) {
    if (textures.has(key)) return textures.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    textures.set(key, t);
    return t;
}

const pipTexture = (n, col) => canvasTexture(`6:${n}:${col.face}`, (g) => {
    g.fillStyle = col.face;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = n === 1 && col.one ? col.one : col.ink;
    for (const [x, y] of PIPS[n]) {
        g.beginPath();
        g.arc(64 + x * 64, 64 + y * 64, 22, 0, Math.PI * 2);
        g.fill();
    }
});

function number(g, text, x, y, size, angle = 0) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.font = `800 ${size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
}

const d8Texture = (n, col) => canvasTexture(`8:${n}:${col.face}:${col.ink}`, (g) => {
    g.fillStyle = col.face;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = col.ink;
    number(g, String(n), 128, 150, 92);
    if (n === 6) g.fillRect(104, 200, 48, 7); // 6, not 9
});

/** A d4 face: each corner carries the number of its vertex, its top towards the corner. */
const d4Texture = (nums, col) => canvasTexture(`4:${nums.join('')}:${col.face}`, (g) => {
    g.fillStyle = col.face;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = col.ink;
    const cx = (TRI[0][0] + TRI[1][0] + TRI[2][0]) / 3;
    const cy = (TRI[0][1] + TRI[1][1] + TRI[2][1]) / 3;
    TRI.forEach(([x, y], k) => number(g, String(nums[k]), cx + (x - cx) * 0.6, cy + (y - cy) * 0.6, 54, Math.atan2(y - cy, x - cx) + Math.PI / 2));
});

// a d10 kite on its 256 px canvas: apex, side, far corner, side (counter-clockwise, as the faces)
const KITE = [[128, 8], [32, 202], [128, 248], [224, 202]];

/** A d10 face: its number in the wide part, the top towards the apex; 6 and 9 underlined. */
const d10Texture = (n, col) => canvasTexture(`10:${n}:${col.face}`, (g) => {
    g.fillStyle = col.face;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = col.ink;
    number(g, String(n), 128, 150, 86);
    if (n === 6 || n === 9) g.fillRect(108, 192, 40, 7);
});

/** Non-indexed geometry of the d10: two triangles per kite, one material group per kite. */
function kiteGeometry(verts, faces) {
    const pos = [];
    const uv = [];
    const geo = new THREE.BufferGeometry();
    faces.forEach((f, k) => {
        for (const j of [0, 1, 2, 0, 2, 3]) {
            pos.push(...verts[f[j]]);
            uv.push(KITE[j][0] / 256, 1 - KITE[j][1] / 256);
        }
        geo.addGroup(k * 6, 6, k);
    });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
}

/** Non-indexed geometry of a triangular solid, one material group per face, the canvas triangle as UVs. */
function solidGeometry(verts, faces) {
    const pos = [];
    const uv = [];
    const geo = new THREE.BufferGeometry();
    faces.forEach((f, k) => {
        f.forEach((i, j) => {
            pos.push(...verts[i]);
            uv.push(TRI[j][0] / 256, 1 - TRI[j][1] / 256);
        });
        geo.addGroup(k * 3, 3, k);
    });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
}

const GEOMETRY = {
    10: () => kiteGeometry(D10_VERTS, D10_FACES),
    6: () => new RoundedBoxGeometry(1, 1, 1, 4, 0.12),
    8: () => solidGeometry(D8_VERTS, D8_FACES),
    4: () => solidGeometry(D4_VERTS, D4_FACES),
};
const geometries = {};

function dieMesh(sides, color) {
    const col = COLORS[color] ?? COLORS.black;
    const mat = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.05 });
    let mats;
    if (sides === 10) mats = D10_VALUES.map((n) => mat(d10Texture(n, col)));
    else if (sides === 6) mats = [2, 5, 1, 6, 3, 4].map((n) => mat(pipTexture(n, col))); // BoxGeometry order: +x −x +y −y +z −z
    else if (sides === 8) mats = SOLIDS[8].faceValue.map((n) => mat(d8Texture(n, col)));
    else mats = D4_FACES.map((f) => mat(d4Texture(f.map((i) => i + 1), col)));
    const mesh = new THREE.Mesh(geometries[sides] ??= GEOMETRY[sides](), mats);
    mesh.castShadow = true;
    return mesh;
}

function body(sides, mat) {
    const shape = sides === 6
        ? new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5))
        : new CANNON.ConvexPolyhedron({ vertices: SOLIDS[sides].verts.map((p) => new CANNON.Vec3(...p)), faces: SOLIDS[sides].faces });
    return new CANNON.Body({ mass: 1, material: mat, shape, linearDamping: 0.1, angularDamping: 0.12, sleepSpeedLimit: 0.2, sleepTimeLimit: 0.2 });
}

// ------------------------------------------------------------------ the tray

export function createDiceTray() {
    const root = document.createElement('div');
    root.className = 'dice-layer';
    Object.assign(root.style, { position: 'fixed', zIndex: '45', display: 'none', touchAction: 'none', cursor: 'pointer' });
    document.body.append(root);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    root.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(3, 12, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 30 });
    scene.add(sun);
    // no table: only the shadows, over the board
    const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.4 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);

    // the part of the table the camera sees (with a margin): the walls go there
    let bounds = { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };
    const ray = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const toTable = (nx, ny) => {
        ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
        const p = new THREE.Vector3();
        return ray.ray.intersectPlane(ground, p) ? p : null;
    };
    function place(rect) {
        Object.assign(root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        renderer.setSize(w, h, false);
        Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
        camera.aspect = w / h;
        // seen from above, a little tilted; further away on narrow areas so the table fits
        const dist = 13 / Math.min(1, camera.aspect * 0.9);
        camera.position.set(0, dist, dist * 0.35);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        const a = toTable(-1, -1); const b = toTable(1, 1); const c = toTable(1, -1);
        const m = 0.2;
        bounds = { minX: Math.max(a.x, -c.x) + m, maxX: Math.min(c.x, b.x) - m, minZ: b.z + m, maxZ: Math.min(a.z, c.z) - m };
    }

    /** Simulates the whole throw: frames of every die and the label each one ends with. */
    function simulate(dice, inits) {
        const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -32, 0) });
        world.allowSleep = true;
        const mat = new CANNON.Material();
        world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, { friction: 0.25, restitution: 0.32 }));
        const wall = (normal, pos) => {
            const b = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
            b.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(...normal));
            b.position.set(...pos);
            world.addBody(b);
        };
        wall([0, 1, 0], [0, 0, 0]);
        wall([1, 0, 0], [bounds.minX, 0, 0]);
        wall([-1, 0, 0], [bounds.maxX, 0, 0]);
        wall([0, 0, 1], [0, 0, bounds.minZ]);
        wall([0, 0, -1], [0, 0, bounds.maxZ]);
        const bodies = dice.map((d, k) => {
            const b = body(d.sides, mat);
            const init = inits[k];
            b.position.set(...init.p);
            b.quaternion.set(...init.q);
            b.velocity.set(...init.v);
            b.angularVelocity.set(...init.w);
            world.addBody(b);
            return b;
        });
        const frames = dice.map(() => []);
        for (let i = 0; i < HZ * 8; i++) {
            world.step(1 / HZ);
            bodies.forEach((b, k) => frames[k].push([b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]));
            if (bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) break;
        }
        const ups = dice.map((d, k) => { const f = frames[k].at(-1); return upLabel(d.sides, new THREE.Quaternion(f[3], f[4], f[5], f[6])); });
        return { frames, ups };
    }

    /** Random starting conditions: the dice come in from the bottom edge, side by side. */
    function launch(n) {
        const rnd = (a, b) => a + Math.random() * (b - a);
        const span = bounds.maxX - bounds.minX - 2;
        return Array.from({ length: n }, (_, k) => {
            const x = bounds.minX + 1 + (n === 1 ? span / 2 : (span * k) / (n - 1)) + rnd(-0.2, 0.2);
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3)));
            const speed = rnd(7.5, 11);
            return {
                p: [x, rnd(1.4, 2.2), bounds.maxZ - 0.9],
                q: [q.x, q.y, q.z, q.w],
                v: [rnd(-2.5, 2.5), rnd(2, 5), -speed],
                w: [rnd(-speed, speed), rnd(-speed, speed), rnd(-speed, speed)],
            };
        });
    }

    // ---------------------------------------------------------------- playback
    let play = null; // { meshes, sides, frames, rigs, t0, rate, resolve, ended, hold, skipped }
    let raf = 0;

    function pose(mesh, f, a, t, rig) {
        mesh.position.set(f[0] + (a[0] - f[0]) * t, f[1] + (a[1] - f[1]) * t, f[2] + (a[2] - f[2]) * t);
        const q1 = new THREE.Quaternion(f[3], f[4], f[5], f[6]);
        const q2 = new THREE.Quaternion(a[3], a[4], a[5], a[6]);
        mesh.quaternion.copy(q1.slerp(q2, t)).multiply(rig);
    }

    function clear() {
        for (const m of play?.meshes ?? []) {
            scene.remove(m);
            for (const x of m.material) x.dispose();
        }
    }

    function done() {
        cancelAnimationFrame(raf);
        raf = 0;
        root.style.display = 'none';
        const p = play;
        // the value each die shows on top: it has to be the one asked for
        const shown = p ? p.meshes.map((m, k) => upLabel(p.sides[k], m.quaternion).value) : [];
        clear();
        play = null;
        p?.resolve(shown);
    }

    function frame(now) {
        raf = requestAnimationFrame(frame);
        const p = play;
        if (!p) return;
        const t = Math.max(0, ((now - p.t0) / 1000) * HZ * p.rate);
        const i = Math.floor(t);
        p.meshes.forEach((m, k) => {
            const fr = p.frames[k];
            if (i >= fr.length - 1) pose(m, fr.at(-1), fr.at(-1), 0, p.rigs[k]);
            else pose(m, fr[i], fr[i + 1], t - i, p.rigs[k]);
        });
        if (!p.ended && p.frames.every((fr) => i >= fr.length - 1)) {
            p.ended = now;
            p.hold = p.skipped ? 250 : HOLD / p.rate;
        }
        if (p.ended && now - p.ended >= p.hold) done();
        renderer.render(scene, camera);
    }

    /** A tap: the dice stop where they land, and a moment later they go. */
    function skip() {
        const p = play;
        if (!p) return;
        p.t0 = -1e9;
        p.skipped = true;
        if (p.ended) p.hold = Math.min(p.hold, 150);
    }
    root.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        skip();
    });

    return {
        /**
         * Throws `dice` ({ sides: 4 | 6 | 8 | 10, value, color }) over `rect` (a DOMRect of the page) and
         * resolves once they have stopped and been seen, with the values they show; `rate` speeds the
         * playback up.
         */
        roll(dice, { rect, rate = 1 }) {
            if (play) done();
            root.style.display = '';
            place(rect);
            let inits = launch(dice.length);
            let sim = simulate(dice, inits);
            // a die resting on an edge or a corner: simulate again with a slightly different spin
            for (let k = 0; k < 8 && sim.ups.some((u) => u.dot < 0.95); k++) {
                inits = inits.map((x) => ({ ...x, w: x.w.map((w) => w * 0.9 + 0.6) }));
                sim = simulate(dice, inits);
            }
            const meshes = dice.map((d) => dieMesh(d.sides, d.sides === 8 && d.color === 'black' ? 'gold' : d.color));
            meshes.forEach((m) => scene.add(m));
            const rigs = dice.map((d, k) => rigFor(d.sides, d.value, sim.ups[k].value));
            return new Promise((resolve) => {
                play = { meshes, sides: dice.map((d) => d.sides), frames: sim.frames, rigs, t0: performance.now(), rate, resolve, ended: 0, hold: HOLD, skipped: false };
                if (!raf) raf = requestAnimationFrame(frame);
            });
        },
        /** The same throw without drawing it: the values the dice would show (for tests). */
        dryRun(dice, { rect }) {
            place(rect);
            const sim = simulate(dice, launch(dice.length));
            return dice.map((d, k) => {
                const f = sim.frames[k].at(-1);
                const q = new THREE.Quaternion(f[3], f[4], f[5], f[6]).multiply(rigFor(d.sides, d.value, sim.ups[k].value));
                return { shown: upLabel(d.sides, q).value, flat: sim.ups[k].dot };
            });
        },
        skip,
        get busy() { return Boolean(play); },
        destroy() {
            done();
            renderer.dispose();
            root.remove();
        },
    };
}
