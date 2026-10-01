// WallRush AI.
// Difficulty is a skill dial: the chance of playing the strong move vs a weak
// one. function blockedFeasy/normal/hard use a fast look-ahead; hardcore runs a real search
// engine (alpha-beta negamax + transposition table + iterative deepening) that
// looks many moves ahead — it examines the opponent's replies to every line and
// only plays into positions it can hold, so a human practically cannot win.
import { pawnMoves, canPlaceWall, distToGoal, goalRow, cloneState, applyMove, N } from './engine.js';

export const AI_LEVELS = {
  easy:     { skill: 1.00, engine: true, budget: 300,  maxDepth: 10 },
  normal:   { skill: 1.00, engine: true, budget: 800,  maxDepth: 14 },
  hard:     { skill: 1.00, engine: true, budget: 1800, maxDepth: 18 },
  hardcore: { skill: 1.00, engine: true, budget: 3000, maxDepth: 22 },
};

const dimsOf = (s) => [s.cols || 9, s.rows || 9];

function pawnDist(state, p) {
  const [cols, rows] = dimsOf(state);
  return distToGoal(state.walls, goalRow(p, state), cols, rows)[state.pawns[p].r * cols + state.pawns[p].c];
}

function myBestStep(state, p) {
  const [cols, rows] = dimsOf(state);
  const dist = distToGoal(state.walls, goalRow(p, state), cols, rows);
  const moves = pawnMoves(state, p);
  let bestD = Infinity;
  for (const m of moves) { const d = dist[m.r * cols + m.c]; if (d !== -1 && d < bestD) bestD = d; }
  const best = moves.filter(m => dist[m.r * cols + m.c] === bestD);
  const pool = best.length ? best : moves;
  return { move: pool[Math.floor(Math.random() * pool.length)], dist: bestD };
}

function shortestPathCells(state, p) {
  const [cols, rows] = dimsOf(state);
  const dist = distToGoal(state.walls, goalRow(p, state), cols, rows);
  const cells = [];
  let cur = { ...state.pawns[p] };
  let guard = 0;
  while (dist[cur.r * cols + cur.c] > 0 && guard++ < 160) {
    cells.push(cur);
    const opts = [[-1, 0], [1, 0], [0, -1], [0, 1]]
      .map(([dr, dc]) => ({ r: cur.r + dr, c: cur.c + dc }))
      .filter(m => m.r >= 0 && m.r < rows && m.c >= 0 && m.c < cols)
      .filter(m => dist[m.r * cols + m.c] === dist[cur.r * cols + cur.c] - 1);
    if (!opts.length) break;
    cur = opts[0];
  }
  return cells;
}

// Legal wall candidates that matter, each with its path-length gain, sorted best
// first (good move ordering makes alpha-beta prune hard so the search goes deep).
function candidateWalls(state, p, cap) {
  if (state.left[p] <= 0) return [];
  const [cols, rows] = dimsOf(state);
  const set = new Map();
  const add = (cells, span) => {
    for (const cell of cells.slice(0, span))
      for (let dr = -1; dr <= 0; dr++)
        for (let dc = -1; dc <= 0; dc++)
          for (const o of ['h', 'v']) {
            const w = { r: cell.r + dr, c: cell.c + dc, o };
            if (w.r < 0 || w.r > rows - 2 || w.c < 0 || w.c > cols - 2) continue;
            set.set(`${w.r},${w.c},${w.o}`, w);
          }
  };
  add(shortestPathCells(state, 1 - p), 8);
  add(shortestPathCells(state, p), 4);
  // extend existing walls (choke points)
  for (const e of state.walls)
    for (const o of ['h', 'v'])
      for (const d of [-2, -1, 1, 2]) {
        const w = o === 'h' ? { r: e.r, c: e.c + d, o } : { r: e.r + d, c: e.c, o };
        if (w.r < 0 || w.r > N - 2 || w.c < 0 || w.c > N - 2) continue;
        set.set(`${w.r},${w.c},${w.o}`, w);
      }

  const opp = 1 - p, oppPos = state.pawns[opp], myPos = state.pawns[p];
  const gOpp = goalRow(opp, state), gMy = goalRow(p, state);
  const dOpp0 = distToGoal(state.walls, gOpp, cols, rows)[oppPos.r * cols + oppPos.c];
  const dMy0 = distToGoal(state.walls, gMy, cols, rows)[myPos.r * cols + myPos.c];
  const scored = [];
  for (const w of set.values()) {
    if (!canPlaceWall(state, p, w)) continue;
    const walls = [...state.walls, w];
    const gain = (distToGoal(walls, gOpp, cols, rows)[oppPos.r * cols + oppPos.c] - dOpp0)
               - (distToGoal(walls, gMy, cols, rows)[myPos.r * cols + myPos.c] - dMy0);
    scored.push({ w, gain });
  }
  scored.sort((a, b) => b.gain - a.gain);
  return scored.slice(0, cap);
}

/* ---------- shallow strong move: easy / normal / hard ---------- */
function greedyMove(state, p) {
  const my = myBestStep(state, p);
  const oppDist = pawnDist(state, 1 - p);
  const walls = candidateWalls(state, p, 8);
  if (walls.length) {
    const { w, gain } = walls[0];
    const behindOrTied = my.dist >= oppDist;
    if (gain >= 2 || (behindOrTied && gain >= 1)) return { type: 'wall', ...w };
  }
  return { type: 'pawn', r: my.move.r, c: my.move.c };
}

/* ================= deep search engine (hardcore) =================
   Fast internal board: wall slots as bit arrays, incremental make/unmake,
   Zobrist hashing + transposition table, alpha-beta negamax with iterative
   deepening. 10-50x faster per node than the object representation, so it
   really does look many moves ahead — including defensive walls that guard
   its own path. */
const MATE = 1e6;

// --- Zobrist tables (deterministic PRNG so tests are reproducible) ---
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}
const _rng = mulberry32(0xC0FFEE);
const Z_H = new Uint32Array(100);   // 10×10 slots (11×11 board)
const Z_V = new Uint32Array(100);
const Z_P = [
  new Uint32Array(121), new Uint32Array(121),
  new Uint32Array(121), new Uint32Array(121)
];
const Z_L = [
  new Uint32Array(32), new Uint32Array(32),
  new Uint32Array(32), new Uint32Array(32)
];
const Z_T = [ _rng(), _rng(), _rng(), _rng() ];
for (let i = 0; i < 100; i++) { Z_H[i] = _rng(); Z_V[i] = _rng(); }
for (let p = 0; p < 4; p++) {
  for (let i = 0; i < 121; i++) Z_P[p][i] = _rng();
  for (let i = 0; i < 32; i++) Z_L[p][i] = _rng();
}

class FastState {
  constructor(state) {
    this.mode = state.mode || 'duel';
    this.cols = state.cols || 9;
    this.rows = state.rows || 9;
    this.cells = this.cols * this.rows;
    this.slotCols = this.cols - 1;
    this.slotRows = this.rows - 1;
    this.slots = this.slotCols * this.slotRows;
    this.n = state.pawns.length;

    this.h = new Uint8Array(this.slots);
    this.v = new Uint8Array(this.slots);
    for (const w of state.walls) {
      const idx = w.r * this.slotCols + w.c;
      if (w.o === 'h') this.h[idx] = 1;
      else this.v[idx] = 1;
    }

    this.pos = new Int16Array(this.n);
    this.left = new Uint8Array(this.n);
    this.alive = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const pawn = state.pawns[i];
      if (!pawn) { this.alive[i] = 0; this.pos[i] = -1; continue; }
      const alive = (!state.alive || state.alive[i] !== false);
      this.alive[i] = alive ? 1 : 0;
      this.pos[i] = alive ? pawn.r * this.cols + pawn.c : -1;
      this.left[i] = state.left[i] | 0;
    }

    this.turn = state.turn | 0;
    if (!this.alive[this.turn]) this.turn = nextAliveF(this, this.turn);

    if (this.mode === 'quad') {
      const g = state.goal || { r: (this.rows - 1) >> 1, c: (this.cols - 1) >> 1 };
      this.goalCell = g.r * this.cols + g.c;
    } else {
      this.goalCell = -1;
    }

    // reusable BFS buffers, per-instance for safe recursion
    this.q = new Int16Array(this.cells);
    this.dist = new Int16Array(this.cells);
    this.seen = new Uint8Array(this.cells);
    this.evalDist = new Int16Array(4);

    this.hash = this._computeHash();
  }

  _computeHash() {
    let h = 0;
    for (let i = 0; i < this.slots; i++) {
      if (this.h[i]) h ^= Z_H[i];
      if (this.v[i]) h ^= Z_V[i];
    }
    for (let p = 0; p < this.n; p++) {
      if (!this.alive[p]) continue;
      h ^= Z_P[p][this.pos[p]];
      h ^= Z_L[p][this.left[p] & 31];
    }
    h ^= Z_T[this.turn];
    return h >>> 0;
  }
}

// is the step from cell (r,c) in direction (dr,dc) blocked by wall/edge?
function blockedF(fs, r, c, dr, dc) {
  const sc = fs.slotCols;
  const sr = fs.slotRows;
  if (dr === -1) {
    if (r === 0) return true;
    const rr = r - 1;
    return (c < sc && fs.h[rr * sc + c]) || (c > 0 && fs.h[rr * sc + c - 1]);
  }
  if (dr === 1) {
    if (r === fs.rows - 1) return true;
    return (c < sc && fs.h[r * sc + c]) || (c > 0 && fs.h[r * sc + c - 1]);
  }
  if (dc === -1) {
    if (c === 0) return true;
    const cc = c - 1;
    return (r < sr && fs.v[r * sc + cc]) || (r > 0 && fs.v[(r - 1) * sc + cc]);
  }
  if (c === fs.cols - 1) return true;
  return (r < sr && fs.v[r * sc + c]) || (r > 0 && fs.v[(r - 1) * sc + c]);
}

const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const _q = new Int16Array(81);
const _dist = new Int16Array(81);

// distance map from every cell to goal row (walls only)
function goalRowForPlayer(fs, p) {
  if (fs.mode === 'race') return 0;
  return p === 0 ? 0 : fs.rows - 1;
}

function distMapF(fs, p) {
  fs.dist.fill(-1);
  let head = 0, tail = 0;

  if (fs.mode === 'quad') {
    fs.dist[fs.goalCell] = 0;
    fs.q[tail++] = fs.goalCell;
  } else {
    const row = goalRowForPlayer(fs, p);
    for (let c = 0; c < fs.cols; c++) {
      const k = row * fs.cols + c;
      fs.dist[k] = 0;
      fs.q[tail++] = k;
    }
  }

  while (head < tail) {
    const cur = fs.q[head++];
    const r = (cur / fs.cols) | 0, c = cur % fs.cols;
    const d1 = fs.dist[cur] + 1;
    for (let d = 0; d < 4; d++) {
      const dr = DIRS4[d][0], dc = DIRS4[d][1];
      if (blockedF(fs, r, c, dr, dc)) continue;
      const nr = r + dr, nc = c + dc;
      const k = nr * fs.cols + nc;
      if (fs.dist[k] !== -1) continue;
      fs.dist[k] = d1;
      fs.q[tail++] = k;
    }
  }
  return fs.dist;
}

function distOfF(fs, p) {
  const dm = distMapF(fs, p);
  return dm[fs.pos[p]];
}

const _seen = new Uint8Array(81);
function hasPathF(fs, p) {
  fs.seen.fill(0);
  let head = 0, tail = 0;
  fs.q[tail++] = fs.pos[p];
  fs.seen[fs.pos[p]] = 1;

  const cellGoal = (fs.mode === 'quad') ? fs.goalCell : -1;
  const rowGoal = (fs.mode === 'quad') ? -1 : goalRowForPlayer(fs, p);

  while (head < tail) {
    const cur = fs.q[head++];
    if (cellGoal >= 0 && cur === cellGoal) return true;
    const r = (cur / fs.cols) | 0;
    if (rowGoal >= 0 && r === rowGoal) return true;
    const c = cur % fs.cols;
    for (let d = 0; d < 4; d++) {
      const dr = DIRS4[d][0], dc = DIRS4[d][1];
      if (blockedF(fs, r, c, dr, dc)) continue;
      const nr = r + dr, nc = c + dc;
      const k = nr * fs.cols + nc;
      if (fs.seen[k]) continue;
      fs.seen[k] = 1;
      fs.q[tail++] = k;
    }
  }
  return false;
}

// pawn destination cells (with jumps), as cell indices
function pawnMovesF(fs, p) {
  const me = fs.pos[p];
  const r = (me / fs.cols) | 0, c = me % fs.cols;
  const out = [];

  const occBy = (k) => {
    for (let i = 0; i < fs.n; i++) {
      if (i === p || !fs.alive[i]) continue;
      if (fs.pos[i] === k) return true;
    }
    return false;
  };

  for (let d = 0; d < 4; d++) {
    const dr = DIRS4[d][0], dc = DIRS4[d][1];
    if (blockedF(fs, r, c, dr, dc)) continue;
    const r1 = r + dr, c1 = c + dc;
    const k1 = r1 * fs.cols + c1;
    if (!occBy(k1)) { out.push(k1); continue; }

    // straight jump over the adjacent pawn
    if (!blockedF(fs, r1, c1, dr, dc)) {
      const r2 = r1 + dr, c2 = c1 + dc;
      const k2 = r2 * fs.cols + c2;
      if (!occBy(k2)) { out.push(k2); continue; }
    }

    // diagonal sidestep around the pawn
    const perps = dr === 0 ? [[-1,0],[1,0]] : [[0,-1],[0,1]];
    for (const [pr, pc] of perps) {
      if (blockedF(fs, r1, c1, pr, pc)) continue;
      const r3 = r1 + pr, c3 = c1 + pc;
      if (r3 < 0 || r3 >= fs.rows || c3 < 0 || c3 >= fs.cols) continue;
      const k3 = r3 * fs.cols + c3;
      if (k3 === me) continue;
      if (occBy(k3)) continue;
      out.push(k3);
    }
  }
  return out;
}

// slot occupancy rules (without path check)
function slotFree(fs, o, r, c) {
  if (r < 0 || r >= fs.slotRows || c < 0 || c >= fs.slotCols) return false;
  const i = r * fs.slotCols + c;
  if (fs.h[i] || fs.v[i]) return false;
  if (o === 0) {
    return !(c > 0 && fs.h[i - 1]) && !(c + 1 < fs.slotCols && fs.h[i + 1]);
  }
  return !(r > 0 && fs.v[i - fs.slotCols]) && !(r + 1 < fs.slotRows && fs.v[i + fs.slotCols]);
}

function canPlaceF(fs, o, r, c) {
  if (!slotFree(fs, o, r, c)) return false;
  const arr = o === 0 ? fs.h : fs.v;
  const i = r * fs.slotCols + c;
  arr[i] = 1;
  let ok = true;
  for (let p = 0; p < fs.n; p++) {
    if (!fs.alive[p]) continue;
    if (!hasPathF(fs, p)) { ok = false; break; }
  }
  arr[i] = 0;
  return ok;
}

function isGoalF(fs, p, cell) {
  if (fs.mode === 'quad') return cell === fs.goalCell;
  return ((cell / fs.cols) | 0) === goalRowForPlayer(fs, p);
}
function nextAliveF(fs, p) {
  for (let i = 1; i <= fs.n; i++) {
    const q = (p + i) % fs.n;
    if (fs.alive[q]) return q;
  }
  return p;
}

function makePawn(fs, p, to) {
  const from = fs.pos[p];
  const nxt = nextAliveF(fs, p);
  fs.hash ^= Z_P[p][from] ^ Z_P[p][to] ^ Z_T[fs.turn] ^ Z_T[nxt];
  fs.pos[p] = to;
  fs.turn = nxt;
  return from;
}

function unmakePawn(fs, p, from) {
  const to = fs.pos[p];
  fs.hash ^= Z_P[p][from] ^ Z_P[p][to] ^ Z_T[fs.turn] ^ Z_T[p];
  fs.pos[p] = from;
  fs.turn = p;
}

function makeWall(fs, p, o, r, c) {
  const i = r * fs.slotCols + c;
  const arr = o === 0 ? fs.h : fs.v;
  const nxt = nextAliveF(fs, p);
  arr[i] = 1;
  fs.hash ^= (o === 0 ? Z_H[i] : Z_V[i]) ^ Z_T[fs.turn] ^ Z_T[nxt];
  fs.hash ^= Z_L[p][fs.left[p] & 31] ^ Z_L[p][(fs.left[p] - 1) & 31];
  fs.left[p]--;
  fs.turn = nxt;
}

function unmakeWall(fs, p, o, r, c) {
  const i = r * fs.slotCols + c;
  const arr = o === 0 ? fs.h : fs.v;
  arr[i] = 0;
  fs.hash ^= (o === 0 ? Z_H[i] : Z_V[i]) ^ Z_T[fs.turn] ^ Z_T[p];
  fs.hash ^= Z_L[p][(fs.left[p] + 1) & 31] ^ Z_L[p][fs.left[p] & 31];
  fs.left[p]++;
  fs.turn = p;
}

// one shortest path for p as cell list (greedy descent over the dist map)
function pathCellsF(fs, p, cap) {
  const dm = distMapF(fs, p);
  const cells = [];
  let cur = fs.pos[p];
  let guard = 0;
  while (dm[cur] > 0 && guard++ < 200 && cells.length < cap) {
    cells.push(cur);
    const r = (cur / fs.cols) | 0, c = cur % fs.cols;
    let next = -1;
    for (let d = 0; d < 4; d++) {
      const dr = DIRS4[d][0], dc = DIRS4[d][1];
      if (blockedF(fs, r, c, dr, dc)) continue;
      const k = (r + dr) * fs.cols + (c + dc);
      if (dm[k] === dm[cur] - 1) { next = k; break; }
    }
    if (next < 0) break;
    cur = next;
  }
  cells.push(cur);
  return cells;
}

function candSlotsF(fs, p) {
  const out = new Set();
  const addAround = (cell) => {
    const r = (cell / fs.cols) | 0, c = cell % fs.cols;
    for (let dr = -1; dr <= 0; dr++) {
      for (let dc = -1; dc <= 0; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr > fs.slotRows - 1 || cc < 0 || cc > fs.slotCols - 1) continue;
        out.add(rr * fs.slotCols + cc);
        out.add(fs.slots + rr * fs.slotCols + cc);
      }
    }
  };

  const ranked = [];
  for (let i = 0; i < fs.n; i++) {
    if (i === p || !fs.alive[i]) continue;
    ranked.push([i, distOfF(fs, i)]);
  }
  ranked.sort((a, b) => a[1] - b[1]);

  const attackN = fs.n > 2 ? 2 : 1;
  for (let k = 0; k < attackN && k < ranked.length; k++) {
    const cells = pathCellsF(fs, ranked[k][0], fs.n > 2 ? 9 : 12);
    for (const cell of cells) addAround(cell);
  }
  for (const cell of pathCellsF(fs, p, fs.n > 2 ? 6 : 6)) addAround(cell);

  for (let i = 0; i < fs.n; i++) {
    if (fs.alive[i]) addAround(fs.pos[i]);
  }

  for (let i = 0; i < fs.slots; i++) {
    const r = (i / fs.slotCols) | 0, c = i % fs.slotCols;
    if (fs.h[i]) {
      for (const d of [-2,-1,1,2]) {
        const cc = c + d;
        if (cc >= 0 && cc < fs.slotCols) out.add(r * fs.slotCols + cc);
      }
      out.add(fs.slots + i);
    }
    if (fs.v[i]) {
      for (const d of [-2,-1,1,2]) {
        const rr = r + d;
        if (rr >= 0 && rr < fs.slotRows) out.add(fs.slots + rr * fs.slotCols + c);
      }
      out.add(i);
    }
  }
  return out;
}

function wallMovesF(fs, p, cap, withGain) {
  if (fs.left[p] <= 0) return [];

  const d0 = new Int16Array(4);
  for (let i = 0; i < fs.n; i++) {
    d0[i] = fs.alive[i] ? distOfF(fs, i) : -1;
  }

  const out = [];
  for (const id of candSlotsF(fs, p)) {
    const o = id >= fs.slots ? 1 : 0;
    const i = id % fs.slots;
    const r = (i / fs.slotCols) | 0, c = i % fs.slotCols;
    if (!canPlaceF(fs, o, r, c)) continue;

    let score = 0;
    if (withGain) {
      const arr = o === 0 ? fs.h : fs.v;
      arr[i] = 1;
      let legal = true;
      const d1 = new Int16Array(4);
      for (let k = 0; k < fs.n; k++) {
        if (!fs.alive[k]) { d1[k] = -1; continue; }
        d1[k] = distOfF(fs, k);
        if (d1[k] < 0) legal = false;
      }
      arr[i] = 0;
      if (!legal) continue;

      if (fs.n === 2) {
        const op = 1 - p;
        score = (d1[op] - d0[op]) * 3 - (d1[p] - d0[p]) * 2.0;
      } else {
        const enemies = [];
        for (let k = 0; k < fs.n; k++) {
          if (k === p || !fs.alive[k]) continue;
          enemies.push({ k, d0: d0[k], gain: d1[k] - d0[k] });
        }
        enemies.sort((a, b) => a.d0 - b.d0);

        for (let idx = 0; idx < enemies.length; idx++) {
          const w = idx === 0 ? 3.0 : idx === 1 ? 1.0 : 0.4;
          score += enemies[idx].gain * w;
        }
        const positives = enemies.filter(e => e.gain > 0);
        if (positives.length >= 2) {
          score += positives[0].gain * 0.6 + positives[1].gain * 0.4;
        }
        score -= (d1[p] - d0[p]) * 2.0;
      }
    }

    out.push({ o, r, c, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, cap);
}

function fsKey(fs) {
  const p0 = fs.pos[0], p1 = fs.pos[1];
  return `${(p0 / 9) | 0},${p0 % 9}|${(p1 / 9) | 0},${p1 % 9}|${fs.left[0]},${fs.left[1]}`;
}

function evalF(fs, me) {
  let myD = -1;
  const ds = fs.evalDist;
  for (let i = 0; i < fs.n; i++) {
    if (!fs.alive[i]) { ds[i] = -1; continue; }
    const d = distOfF(fs, i);
    ds[i] = d;
    if (i === me) myD = d;
  }

  if (myD < 0) return -MATE / 2;

  let score = -myD * 105;

  if (fs.n === 2) {
    const op = 1 - me;
    const opD = ds[op] < 0 ? 100 : ds[op];
    score += opD * 105;
    score += (fs.left[me] - fs.left[op]) * 4;
// TEMPO_PATCH_V1
if (fs.turn === me) { if (myD <= opD) score += 12; }
else { if (opD <= myD) score -= 12; }
    // ==========================================
// VISION-3 PRO: Balanced Full Board Vision
// ==========================================
// 1. MOBILITY الناعمة (ماشي -150 الوحشية)
let mob3 = 0;
{
  const q = [fs.pos[me]];
  const seen = new Uint8Array(fs.cells);
  seen[fs.pos[me]] = 1;
  let head = 0;
  for (let step = 0; step < 3; step++) {
    const sz = q.length - head;
    for (let k = 0; k < sz; k++) {
      const cur = q[head++];
      const r = (cur / fs.cols) | 0, c = cur % fs.cols;
      for (let d = 0; d < 4; d++) {
        const dr = DIRS4[d][0], dc = DIRS4[d][1];
        if (blockedF(fs, r, c, dr, dc)) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= fs.rows || nc >= fs.cols) continue;
        const nid = nr * fs.cols + nc;
        if (seen[nid]) continue;
        seen[nid] = 1; q.push(nid); mob3++;
      }
    }
  }
}
// عقوبة ناعمة فقط كي تكون مخنوق فعلا
if (mob3 < 5) score -= (5 - mob3) * 25;
else score += Math.min(mob3, 12) * 3; // مكافأة صغيرة للحرية

// 2. GLOBAL REACH: هل أنا في جزيرة معزولة؟
let totalReach = 0;
{
  const q2 = [fs.pos[me]];
  const seen2 = new Uint8Array(fs.cells);
  seen2[fs.pos[me]] = 1;
  let h2 = 0;
  while (h2 < q2.length && totalReach < 40) {
    const cur = q2[h2++];
    totalReach++;
    const r = (cur / fs.cols) | 0, c = cur % fs.cols;
    for (let d = 0; d < 4; d++) {
      const dr = DIRS4[d][0], dc = DIRS4[d][1];
      if (blockedF(fs, r, c, dr, dc)) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= fs.rows || nc >= fs.cols) continue;
      const nid = nr * fs.cols + nc;
      if (seen2[nid]) continue;
      seen2[nid] = 1; q2.push(nid);
    }
  }
}
if (totalReach < 15) score -= (15 - totalReach) * 30; // جزيرة = خطر حقيقي

// 3. WALL ECONOMY لكل لاعب
let avgEnemyWalls = 0, aliveEnemies = 0;
for (let i = 0; i < fs.n; i++) {
  if (i!== me && fs.alive[i]) { avgEnemyWalls += fs.left[i]; aliveEnemies++; }
}
if (aliveEnemies > 0) avgEnemyWalls /= aliveEnemies;
const gamePhase = myD < 4? 0.5 : 1.0; // في نهاية اللعبة الجدران أقل قيمة
score += (fs.left[me] - avgEnemyWalls) * 4 * gamePhase;

// 4. TEMPO وترتيب الدور
if (typeof fs.turn!== 'undefined') {
  const myOffset = (me - fs.turn + fs.n) % fs.n;
  let bestOppD = 999, bestOppOffset = 0;
  for (let i = 0; i < fs.n; i++) {
    if (i!== me && fs.alive[i] && typeof fs.dist!== 'undefined' && fs.dist[i] < bestOppD) {
      bestOppD = fs.dist[i];
      bestOppOffset = (i - fs.turn + fs.n) % fs.n;
    }
  }
  if (bestOppD < 900) {
    // إذا الخصم يلعب قبلك، عنده أفضلية نصف دور
    const tempoAdv = (bestOppOffset < myOffset? 0.6 : 0);
    const myRace = myD + myOffset * 0.25;
    const oppRace = bestOppD + tempoAdv;
    score += (oppRace - myRace) * 12; // سباق حقيقي، ماشي مجرد مسافة
  }
}

// 5. MULTI-PATH: هل عندي طريق بديل؟ (هندسة عكسية مبسطة)
let altPaths = 0;
{
  const r0 = (fs.pos[me] / fs.cols) | 0, c0 = fs.pos[me] % fs.cols;
  for (let d = 0; d < 4; d++) {
    const dr = DIRS4[d][0], dc = DIRS4[d][1];
    if (blockedF(fs, r0, c0, dr, dc)) continue;
    // كل جار هو بداية طريق محتمل، نكافئ كثرة الخيارات
    altPaths++;
  }
}
// نفضل المواقع المفتوحة (3-4 مخارج) على الخانقة (1-2)
if (altPaths <= 1) score -= 40;
else if (altPaths === 2) score -= 10;
else score += (altPaths - 2) * 15;
    return Math.round(score);
  }

    // LF1_QUAD_EVAL — LeapFrog-1 (Chem-Lab T2_CONTROL ported, Pop-1 trained)
  // Molecules: my100 + enemy120 + panic100(@<=3) + eco30(avg) + smartTaxi100(+5/step) + pliesTempo10(cap12)
  let closestD = Infinity;
  let aliveEnemies = 0;
  let wallSum = 0;
  for (let i = 0; i < fs.n; i++) {
    if (i === me || !fs.alive[i]) continue;
    const d = ds[i] < 0 ? 100 : ds[i];
    if (d < closestD) closestD = d;
    wallSum += fs.left[i];
    aliveEnemies++;
  }
  if (closestD < Infinity) score += closestD * (closestD <= 3 ? 220 : 120);
  if (aliveEnemies > 0) {
    const wd = fs.left[me] - (wallSum / aliveEnemies);
    if (wd < 0) score += wd * 30;
  }
  if (closestD < Infinity && myD >= 0) {
    const dm = distMapF(fs, me);
    const mr = (fs.pos[me] / fs.cols) | 0, mc = fs.pos[me] % fs.cols;
    const occJump = (k) => {
      for (let i = 0; i < fs.n; i++) {
        if (i === me || !fs.alive[i]) continue;
        if (fs.pos[i] === k) return true;
      }
      return false;
    };
    for (let i = 0; i < fs.n; i++) {
      if (i === me || !fs.alive[i]) continue;
      if (ds[i] < 0 || ds[i] >= myD) continue;
      const er = (fs.pos[i] / fs.cols) | 0, ec = fs.pos[i] % fs.cols;
      const dr = er - mr, dc = ec - mc;
      if (Math.abs(dr) + Math.abs(dc) !== 1) continue;
      const jr = er + dr, jc = ec + dc;
      if (jr < 0 || jr >= fs.rows || jc < 0 || jc >= fs.cols) continue;
      if (blockedF(fs, mr, mc, dr, dc)) continue;
      if (blockedF(fs, er, ec, dr, dc)) continue;
      const jk = jr * fs.cols + jc;
      if (occJump(jk)) continue;
      const jd = dm[jk];
      if (jd < 0 || jd >= myD) continue;
      score += 100 + (myD - jd) * 5;
      break;
    }
    // PLIES TEMPO (turn-order-aware race counting)
    const order = [];
    let cur = fs.turn;
    for (let k = 0; k < fs.n; k++) {
      if (fs.alive[cur]) order.push(cur);
      cur = (cur + 1) % fs.n;
    }
    const cycle = order.length || 1;
    const pliesOf = (p, d) => {
      if (d <= 0) return -999;
      const idx = order.indexOf(p);
      if (idx < 0) return 999;
      return idx + cycle * (d - 1);
    };
    const myP = pliesOf(me, myD);
    let bestP = 999;
    for (let i = 0; i < fs.n; i++) {
      if (i === me || !fs.alive[i] || ds[i] < 0) continue;
      const pp = pliesOf(i, ds[i]);
      if (pp < bestP) bestP = pp;
    }
    let adv = bestP - myP;
    if (adv > 12) adv = 12;
    if (adv < -12) adv = -12;
    score += adv * 10;
  }
  return Math.round(score);
}

let TT, nodes, deadline, timedOut;
let historyW = new Map();
let killerW = [];

function wKeyF(o, r, c) { return o + '|' + r + '|' + c; }

function wallOrderScoreF(w, ply) {
  let s = (typeof w.score === 'number') ? w.score : 0;
  const key = wKeyF(w.o, w.r, w.c);
  s += historyW.get(key) || 0;
  const ks = killerW[ply];
  if (ks && (ks[0] === key || ks[1] === key)) s += 10000;
  return s;
}

function bumpHistoryF(key, depth) {
  historyW.set(key, (historyW.get(key) || 0) + depth * depth);
}

function addKillerF(ply, key) {
  if (!killerW[ply]) killerW[ply] = [null, null];
  if (killerW[ply][0] !== key) {
    killerW[ply][1] = killerW[ply][0];
    killerW[ply][0] = key;
  }
}

function searchF(fs, depth, alpha, beta, ply, me) {
  if ((++nodes & 255) === 0 && Date.now() > deadline) { timedOut = true; return alpha; }
  const alpha0 = alpha;

  const tk = fs.hash;
  const hit = TT.get(tk);
let ttMove = (hit && hit.m) ? hit.m : null;
  if (hit !== undefined && hit.d >= depth) {
    if (hit.f === 0) return hit.s;
    if (hit.f < 0 && hit.s <= alpha) return hit.s;
    if (hit.f > 0 && hit.s >= beta) return hit.s;
  }
  if (depth === 0) return evalF(fs, me);

  const p = fs.turn;
  const maximizing = (p === me);

  const dm = distMapF(fs, p);
  const here = dm[fs.pos[p]];
  const pmoves = pawnMovesF(fs, p).map(to => ({
    t: 0, to,
    prog: (here >= 0 && dm[to] >= 0) ? (here - dm[to]) : 0
  })).sort((a, b) => b.prog - a.prog);

  const withGain = depth >= 3;
  const cap = depth >= 5 ? 10 : depth >= 3 ? 7 : 4;
  const wmoves = (depth >= 2 && fs.left[p] > 0) ? wallMovesF(fs, p, cap, withGain) : [];

  wmoves.sort((a, b) => wallOrderScoreF(b, ply) - wallOrderScoreF(a, ply));
const seq = [];
if (ttMove && ttMove.t === 0) {
  const idx = pmoves.findIndex(m => m.to === ttMove.to);
  if (idx >= 0) { seq.push(pmoves[idx]); pmoves.splice(idx, 1); }
} else if (ttMove && ttMove.t === 1 && ttMove.w) {
  const idx = wmoves.findIndex(m => m.o === ttMove.w.o && m.r === ttMove.w.r && m.c === ttMove.w.c);
  if (idx >= 0) { seq.push({ t: 1, w: wmoves[idx] }); wmoves.splice(idx, 1); }
}
if (pmoves.length) seq.push(pmoves[0]);
for (const w of wmoves) seq.push({ t: 1, w });
for (let i = 1; i < pmoves.length; i++) seq.push(pmoves[i]);
if (!seq.length) return evalF(fs, me);
let best = maximizing ? -Infinity : Infinity;
let bestM = null;
  for (const mv of seq) {
    let s;
    if (mv.t === 0) {
      const from = makePawn(fs, p, mv.to);
      if (isGoalF(fs, p, mv.to)) s = (p === me) ? (MATE - ply) : -(MATE - ply);
      else s = searchF(fs, depth - 1, alpha, beta, ply + 1, me);
      unmakePawn(fs, p, from);
    } else {
      makeWall(fs, p, mv.w.o, mv.w.r, mv.w.c);
      s = searchF(fs, depth - 1, alpha, beta, ply + 1, me);
      unmakeWall(fs, p, mv.w.o, mv.w.r, mv.w.c);
    }
    if (timedOut) return maximizing ? alpha : beta;

    if (maximizing) {
if (s > best) { best = s; bestM = mv; }
if (best > alpha) alpha = best;
} else {
if (s < best) { best = s; bestM = mv; }
if (best < beta) beta = best;
}
if (alpha >= beta) {
if (mv.t === 1 && mv.w) {
const key = wKeyF(mv.w.o, mv.w.r, mv.w.c);
bumpHistoryF(key, depth);
addKillerF(ply, key);
}
break;
}
  }

  const f = (best <= alpha0) ? -1 : (best >= beta) ? 1 : 0;
  TT.set(tk, { d: depth, s: best, f, m: bestM });
  return best;
}

function searchRootF(fs, depth, me, recent) {
  const p = fs.turn;
  const dm = distMapF(fs, p);
  const here = dm[fs.pos[p]];
  const pmoves = pawnMovesF(fs, p).map(to => ({
    t: 0, to,
    prog: (here >= 0 && dm[to] >= 0) ? (here - dm[to]) : 0
  })).sort((a, b) => b.prog - a.prog);

  const cap = depth >= 5 ? 14 : depth >= 3 ? 10 : 6;
  const wmoves = fs.left[p] > 0 ? wallMovesF(fs, p, cap, true) : [];

  wmoves.sort((a, b) => wallOrderScoreF(b, 0) - wallOrderScoreF(a, 0));
const all = [];
if (pmoves.length) all.push(pmoves[0]);
for (const w of wmoves) all.push({ t: 1, w });
for (let i = 1; i < pmoves.length; i++) all.push(pmoves[i]);

  let alpha = -Infinity;
  const scored = [];
  for (const mv of all) {
    if (timedOut) break;
    let s;
    if (mv.t === 0) {
      const from = makePawn(fs, p, mv.to);
      if (isGoalF(fs, p, mv.to)) s = MATE;
      else s = searchF(fs, depth - 1, alpha, Infinity, 1, me);
      unmakePawn(fs, p, from);
    } else {
      makeWall(fs, p, mv.w.o, mv.w.r, mv.w.c);
      s = searchF(fs, depth - 1, alpha, Infinity, 1, me);
      unmakeWall(fs, p, mv.w.o, mv.w.r, mv.w.c);
    }
    if (timedOut) break;

    if (recent && mv.t === 0 && fs.n === 2) {
      const old = fs.pos[p];
      fs.pos[p] = mv.to;
      const key = (((fs.pos[0] / fs.cols) | 0) + ',' + (fs.pos[0] % fs.cols) + '|' +
                   ((fs.pos[1] / fs.cols) | 0) + ',' + (fs.pos[1] % fs.cols) + '|' +
                   fs.left[0] + ',' + fs.left[1]);
      fs.pos[p] = old;
      if (recent.has(key)) s -= 40;
    }

    scored.push({ mv, s });
    if (s > alpha) alpha = s;
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.s - a.s);
  const top = scored.filter(x => x.s >= scored[0].s - 0.001);
  const pick = top[Math.floor(Math.random() * top.length)];
  return { pick: pick.mv, score: scored[0].s };
}

function engineMove(state, p, budgetMs, maxDepth, recent) {
  const fs = new FastState(state);
  if (!fs.alive[p]) return null;
  if (fs.turn !== p) p = fs.turn;

  let recentSet = null;
  if (recent) {
    recentSet = recent instanceof Set ? recent : new Set(recent);
  }

  TT = new Map();
  nodes = 0;
  timedOut = false;
historyW = new Map();
killerW = [];
  deadline = Date.now() + (budgetMs || 700);

  let effectiveDepth = maxDepth || 12;
  // quad has a 4-player branching factor; trim one ply so a midgame search
  // still completes within the same budget.
  if (fs.n > 2) effectiveDepth = Math.max(2, effectiveDepth - 1);

  let best = null;
  for (let depth = 2; depth <= effectiveDepth; depth++) {
    const res = searchRootF(fs, depth, p, recentSet);
    if (timedOut) break;
    if (res) {
      best = res;
      if (res.score >= MATE - 1000) break;
    }
  }

  if (!best || !best.pick) {
    // legal fallback: closest pawn step to the goal
    const dm = distMapF(fs, p);
    const pm = pawnMovesF(fs, p);
    let bestMove = null, bestD = Infinity;
    for (const to of pm) {
      const d = dm[to];
      if (d >= 0 && d < bestD) { bestD = d; bestMove = to; }
    }
    if (bestMove == null) return null;
    return { type: 'pawn', r: (bestMove / fs.cols) | 0, c: bestMove % fs.cols };
  }
  const pk = best.pick;
  if (pk.t === 0) {
    return { type: 'pawn', r: (pk.to / fs.cols) | 0, c: pk.to % fs.cols };
  }
  return { type: 'wall', o: pk.w.o === 0 ? 'h' : 'v', r: pk.w.r, c: pk.w.c };
}

/* ---------- casual move: always races toward the goal, never backward ----------
   The weak play still WANTS to win — it just doesn't bother placing walls and
   may take a harmless equal-distance sidestep now and then. It never walks the
   wrong way, so an easy opponent looks like a real (if unambitious) player. */
function weakMove(state, p) {
  const [cols, rows] = dimsOf(state);
  const dist = distToGoal(state.walls, goalRow(p, state), cols, rows);
  const moves = pawnMoves(state, p);
  const here = dist[state.pawns[p].r * cols + state.pawns[p].c];
  let bd = Infinity;
  for (const m of moves) { const d = dist[m.r * cols + m.c]; if (d !== -1 && d < bd) bd = d; }
  const best = moves.filter(m => dist[m.r * cols + m.c] === bd);
  // a little human variety: sometimes a sidestep that keeps distance, never one that loses ground
  if (Math.random() < 0.2) {
    const okay = moves.filter(m => { const d = dist[m.r * cols + m.c]; return d !== -1 && d <= here; });
    const pool = okay.length ? okay : best;
    const m = pool[Math.floor(Math.random() * pool.length)];
    return { type: 'pawn', r: m.r, c: m.c };
  }
  const m = best[Math.floor(Math.random() * best.length)];
  return { type: 'pawn', r: m.r, c: m.c };
}

export function aiMove(state, level = 'normal', opts = {}) {
  const cfg = AI_LEVELS[level] || AI_LEVELS.hardcore;
  const p = state.turn;
  const budget = opts.budgetMs ?? cfg.budget;
  const depth = opts.maxDepth ?? cfg.maxDepth;
  return engineMove(state, p, budget, depth, opts.recent);
}