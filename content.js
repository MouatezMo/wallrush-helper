(() => {
'use strict';

const COLORS = ['blue', 'red', 'yellow', 'green'];
const $ = id => document.getElementById(id);
const colorOf = el => COLORS.find(c => el.classList.contains(c)) || null;

const RECENT = [];
const RECENT_MAX = 16;

const WR_LOG = [];
const WR_LOG_MAX = 5000;
const WR_T0 = Date.now();

let wrLastObservedKey = '';
let wrLastObservedState = null;
let wrLastSuggestion = null;
let wrLogTrimmed = false;
let wrLastGameOverKey = '';

let autoPlay = false;
let autoAttempts = {};
let lastSuggestion = null;
let autoMoveInFlight = false;
let wrThinkingEl = null;

function wrNow() {
  return ((Date.now() - WR_T0) / 1000).toFixed(3);
}

function wrPush(kind, obj) {
  const entry = Object.assign({ t: Date.now(), rel: wrNow(), kind: kind }, obj || {});
  WR_LOG.push(entry);
  if (WR_LOG.length > WR_LOG_MAX) {
    WR_LOG.splice(0, WR_LOG.length - WR_LOG_MAX);
    wrLogTrimmed = true;
  }
}

function wrPosStr(p) {
  return p ? '(' + p.r + ',' + p.c + ')' : '(none)';
}

function wrWallStr(w) {
  return w ? '(' + w.r + ',' + w.c + ',' + w.o + ')' : '(none)';
}

function wrMoveStr(m) {
  if (!m) return null;
  if (m.type === 'pawn') return 'pawn(' + m.r + ',' + m.c + ')';
  return 'wall(' + m.r + ',' + m.c + ',' + m.o + ')';
}

function wrStateSummary(state) {
  return {
    mode: state.mode,
    turn: state.turn,
    myIndex: state.myIndex,
    isMyTurn: state.isMyTurn,
    pawns: state.pawns ? state.pawns.map(wrPosStr) : [],
    left: state.left,
    walls: state.walls ? state.walls.length : 0,
    alive: state.alive || null
  };
}

function wrStateKey(state) {
  return JSON.stringify({
    m: state.mode,
    p: state.pawns,
    w: state.walls,
    l: state.left,
    t: state.turn,
    a: state.alive || null
  });
}

function wrSnapshot(state) {
  return {
    mode: state.mode,
    turn: state.turn,
    myIndex: state.myIndex,
    isMyTurn: state.isMyTurn,
    pawns: state.pawns ? state.pawns.map(p => p ? { r: p.r, c: p.c } : null) : [],
    walls: state.walls ? state.walls.map(w => ({ r: w.r, c: w.c, o: w.o })) : [],
    left: state.left ? state.left.slice() : [],
    alive: state.alive ? state.alive.slice() : null
  };
}

function wrDiffStates(prev, curr) {
  const moves = [];
  const actor = prev.turn;

  const len = Math.min(prev.pawns.length, curr.pawns.length);
  for (let i = 0; i < len; i++) {
    const a = prev.pawns[i];
    const b = curr.pawns[i];
    if ((a === null || a === undefined) && (b === null || b === undefined)) continue;
    if ((a === null || a === undefined) || (b === null || b === undefined) || a.r !== b.r || a.c !== b.c) {
      moves.push({ type: 'pawn', seat: i, from: a || null, to: b || null });
    }
  }

  const prevWallKeys = new Set(prev.walls.map(w => w.r + ',' + w.c + ',' + w.o));
  const currWallKeys = new Set(curr.walls.map(w => w.r + ',' + w.c + ',' + w.o));
  const newWalls = curr.walls.filter(w => !prevWallKeys.has(w.r + ',' + w.c + ',' + w.o));
  const removedWalls = prev.walls.filter(w => !currWallKeys.has(w.r + ',' + w.c + ',' + w.o));

  if (newWalls.length) {
    let wallSeat = null;
    for (let i = 0; i < curr.left.length; i++) {
      if ((prev.left[i] || 0) > (curr.left[i] || 0)) {
        wallSeat = i;
        break;
      }
    }
    for (const w of newWalls) {
      moves.push({ type: 'wall', seat: wallSeat, wall: w });
    }
  }

  for (const w of removedWalls) {
    moves.push({ type: 'wall_removed', seat: null, wall: w });
  }

  if (prev.alive && curr.alive) {
    for (let i = 0; i < curr.alive.length; i++) {
      if (prev.alive[i] !== curr.alive[i]) {
        moves.push({ type: 'alive_change', seat: i, from: prev.alive[i], to: curr.alive[i] });
      }
    }
  }

  if (prev.mode !== curr.mode) {
    moves.push({ type: 'mode_change', from: prev.mode, to: curr.mode });
  }

  return { actor: actor, moves: moves };
}

function wrMoveMatchesSuggestion(mv, sug) {
  if (!sug || !sug.move) return false;
  const m = sug.move;
  if (m.type === 'pawn' && mv.type === 'pawn') {
    return mv.to && m.r === mv.to.r && m.c === mv.to.c;
  }
  if (m.type === 'wall' && mv.type === 'wall') {
    return mv.wall && m.o === mv.wall.o && m.r === mv.wall.r && m.c === mv.wall.c;
  }
  return false;
}

function observeState(state) {
  if (!state) return;
  if (state.pawns && state.pawns.some(p => p && (!Number.isFinite(p.r) || !Number.isFinite(p.c)))) return;

  const key = wrStateKey(state);
  if (key === wrLastObservedKey) return;

  wrPush('STATE', wrStateSummary(state));

  if (wrLastObservedState && wrLastObservedState.mode === state.mode) {
    const diff = wrDiffStates(wrLastObservedState, state);
    if (diff.moves.length) {
      for (const mv of diff.moves) {
        wrPush('MOVE_DETECTED', {
          by: mv.seat,
          actorGuess: diff.actor,
          type: mv.type,
          from: mv.from ? wrPosStr(mv.from) : undefined,
          to: mv.to ? wrPosStr(mv.to) : undefined,
          wall: mv.wall ? wrWallStr(mv.wall) : undefined,
          wasOurSuggestion: wrMoveMatchesSuggestion(mv, wrLastSuggestion)
        });
      }
      wrLastSuggestion = null;
    } else {
      wrPush('STATE_CHANGE_NO_MOVE', { fromKey: wrLastObservedKey, toKey: key });
    }
  }

  wrLastObservedKey = key;
  wrLastObservedState = wrSnapshot(state);
}

function wrLogEngineResponse(state, resp) {
  wrPush('ENGINE_RESPONSE', {
    engine: resp.engine,
    level: resp.level,
    levelName: resp.levelName,
    ms: resp.ms,
    budget: resp.budget,
    maxDepth: resp.maxDepth,
    move: wrMoveStr(resp.move),
    error: resp.error || undefined
  });

  if (resp.move) {
    wrLastSuggestion = {
      move: resp.move,
      at: Date.now(),
      stateKey: wrStateKey(state),
      levelName: resp.levelName
    };
    lastSuggestion = wrLastSuggestion;
    wrPush('SUGGESTION', {
      move: wrMoveStr(resp.move),
      levelName: resp.levelName,
      ms: resp.ms
    });
  }
}

function wrSerializeLog() {
  const lines = [];
  lines.push('WallRush Helper Log');
  lines.push('Generated: ' + new Date().toISOString());
  lines.push('Page: ' + location.href);
  lines.push('Entries: ' + WR_LOG.length);
  lines.push('Trimmed: ' + wrLogTrimmed);
  lines.push('');

  for (const e of WR_LOG) {
    const copy = Object.assign({}, e);
    const rel = copy.rel;
    const kind = copy.kind;
    delete copy.t;
    delete copy.rel;
    delete copy.kind;
    lines.push('[+' + rel + 's] ' + kind + ' ' + JSON.stringify(copy));
  }

  return lines.join('\n');
}

function checkGameOver(state) {
  const overlay = document.getElementById('overlay-gameover');
  if (!overlay || overlay.hidden) return;

  const title = (document.getElementById('result-title') || {}).textContent || '';
  const reason = (document.getElementById('result-reason') || {}).textContent || '';
  const ptsDelta = (document.getElementById('pts-delta') || {}).textContent || '';
  const myNick = (document.getElementById('rs-nick-me') || {}).textContent || '';
  const oppNick = (document.getElementById('rs-nick-opp') || {}).textContent || '';

  let result = 'unknown';
  const t = title.toLowerCase();
  if (t.indexOf('victory') >= 0 || t.indexOf('win') >= 0) result = 'win';
  else if (t.indexOf('defeat') >= 0 || t.indexOf('loss') >= 0) result = 'loss';
  else if (t.indexOf('resign') >= 0) result = 'resign';

  const key = JSON.stringify({ title: title, reason: reason, ptsDelta: ptsDelta });
  if (key === wrLastGameOverKey) return;
  wrLastGameOverKey = key;

  wrPush('GAME_OVER', {
    result: result,
    title: title,
    reason: reason,
    ptsDelta: ptsDelta,
    myNick: myNick,
    oppNick: oppNick,
    mode: state ? state.mode : null
  });
}

function setAutoPlay(enabled, source) {
  enabled = !!enabled;

  if (autoPlay === enabled) {
    if (enabled) {
      clearHighlight();
      lastKey = '';
      if (!busy) setTimeout(tick, 0);
    }
    return;
  }

  autoPlay = enabled;
  wrPush('AUTO_PLAY', { enabled: enabled, source: source || 'unknown' });

  if (enabled) {
    clearHighlight();
    lastKey = '';
    if (!busy) setTimeout(tick, 0);
  } else {
    clearHighlight();
  }
}

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.autoPlay) {
    setAutoPlay(!!changes.autoPlay.newValue, 'storage');
    if (!changes.autoPlay.newValue) wrHideThinking();
  }
  if (changes.level) {
    wrPush('LEVEL_CHANGED', { from: changes.level.oldValue, to: changes.level.newValue });
  }
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'WR_GET_LOG') {
    try {
      sendResponse({ ok: true, text: wrSerializeLog() });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }

  if (msg && msg.type === 'SET_AUTO_PLAY') {
    chrome.storage.local.set({ autoPlay: !!msg.enabled }, function () {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

function recordRecent(state) {
  if (state.mode !== 'duel') return;
  if (!state.pawns[0] || !state.pawns[1]) return;

  const k = state.pawns[0].r + ',' + state.pawns[0].c + '|' +
            state.pawns[1].r + ',' + state.pawns[1].c + '|' +
            state.left[0] + ',' + state.left[1];

  if (RECENT[RECENT.length - 1] === k) return;
  RECENT.push(k);
  while (RECENT.length > RECENT_MAX) RECENT.shift();
}

function spinCell(r, c, k, n) {
  for (let i = 0; i < k; i++) {
    const nr = c;
    const nc = n - 1 - r;
    r = nr;
    c = nc;
  }
  return { r: r, c: c };
}

function spinWall(w, k, m) {
  let r = w.r, c = w.c, o = w.o;
  for (let i = 0; i < k; i++) {
    const nr = c;
    const nc = m - 1 - r;
    const no = (o === 'h') ? 'v' : 'h';
    r = nr;
    c = nc;
    o = no;
  }
  return { r: r, c: c, o: o };
}

function readBoard() {
  const board = $('board');
  if (!board) return null;

  const cells = board.querySelectorAll('.cell');
  if (!cells.length) return null;

  let rows = 0, cols = 0;
  for (let i = 0; i < cells.length; i++) {
    const vr = +cells[i].dataset.vr;
    const vc = +cells[i].dataset.vc;
    if (vr + 1 > rows) rows = vr + 1;
    if (vc + 1 > cols) cols = vc + 1;
  }

  const n = rows > cols ? rows : cols;

  let myColor = (board.className.match(/my-(\w+)/) || [])[1];
  if (!myColor) {
    const cb = $('chip-me') ? $('chip-me').querySelector('.chip-ball') : null;
    myColor = cb ? colorOf(cb) : 'blue';
  }

  const mySeat = COLORS.indexOf(myColor);
  if (mySeat < 0) return null;

  const quadRow = $('quad-row');
  const isQuad = !!(quadRow && !quadRow.hidden && quadRow.dataset.built === '4');

  let mode = 'duel';
  if (isQuad) mode = 'quad';
  else if (rows > cols) mode = 'race';

  const QUAD_TURNS = [0, 3, 2, 1];
  let viewTurns = 0;
  if (isQuad) viewTurns = QUAD_TURNS[mySeat] || 0;
  else if (mySeat === 1 && mode === 'duel') viewTurns = 2;

  const u = board.clientWidth / (cols * 1.3 + 0.3);
  const g = 0.3 * u;
  const pad = g;
  const off = u * 0.09;

  const seatPawn = [null, null, null, null];
  const pawnEls = board.querySelectorAll('.pawn');

  for (let i = 0; i < pawnEls.length; i++) {
    const el = pawnEls[i];
    const seat = COLORS.indexOf(colorOf(el));
    if (seat < 0) continue;
    if (el.hidden || el.classList.contains('gone')) continue;

    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    const vr = Math.round((top - pad - off) / (u + g));
    const vc = Math.round((left - pad - off) / (u + g));
    const w = spinCell(vr, vc, (4 - viewTurns) % 4, n);
    seatPawn[seat] = { r: w.r, c: w.c };
  }

  const walls = [];
  const wallEls = board.querySelectorAll('.wall:not(.preview)');

  for (let i = 0; i < wallEls.length; i++) {
    const dw = wallEls[i].dataset.w;
    if (!dw) continue;
    const parts = dw.split(',');
    walls.push({ r: +parts[0], c: +parts[1], o: parts[2] });
  }

  const left = [0, 0, 0, 0];

  if (isQuad) {
    const pills = quadRow.querySelectorAll('.q-pill');
    for (let i = 0; i < pills.length; i++) {
      const seat = COLORS.indexOf(colorOf(pills[i]));
      if (seat < 0) continue;
      const txt = pills[i].querySelector('.q-walls');
      const m = txt ? (txt.textContent || '').match(/(\d+)/) : null;
      left[seat] = m ? +m[1] : 0;
    }
  } else {
    left[mySeat] = parseInt(($('me-walls') || {}).textContent) || 0;
    left[1 - mySeat] = parseInt(($('opp-walls') || {}).textContent) || 0;
  }

  let activeSeat = mySeat;

  if (isQuad) {
    const active = quadRow.querySelector('.q-pill.turn-active');
    if (active) {
      const s = COLORS.indexOf(colorOf(active));
      if (s >= 0) activeSeat = s;
    }
  } else {
    const meChip = $('chip-me');
    const on = meChip ? meChip.classList.contains('turn-active') : false;
    activeSeat = on ? mySeat : (1 - mySeat);
  }

  let pawns, leftOut;

  if (isQuad) {
    pawns = seatPawn;
    leftOut = left;
  } else {
    pawns = [seatPawn[0], seatPawn[1]];
    leftOut = [left[0], left[1]];
  }

  let aliveFlags = undefined;
  let goalCell = undefined;

  if (isQuad) {
    aliveFlags = [true, true, true, true];
    const pe = board.querySelectorAll('.pawn');
    for (let i = 0; i < pe.length; i++) {
      const seat = COLORS.indexOf(colorOf(pe[i]));
      if (seat < 0) continue;
      if (pe[i].hidden || pe[i].classList.contains('gone')) aliveFlags[seat] = false;
    }
    goalCell = { r: Math.floor((rows - 1) / 2), c: Math.floor((cols - 1) / 2) };
  }

  return {
    mode: mode,
    rows: rows,
    cols: cols,
    n: n,
    myIndex: mySeat,
    turn: activeSeat,
    isMyTurn: activeSeat === mySeat,
    viewTurns: viewTurns,
    pawns: pawns,
    left: leftOut,
    walls: walls,
    alive: aliveFlags,
    goal: goalCell,
    u: u,
    g: g,
    pad: pad
  };
}

let highlight = null;

function clearHighlight() {
  if (highlight && highlight.parentNode) highlight.parentNode.removeChild(highlight);
  highlight = null;
}

function wrShowThinking(reason) {
  if (!autoPlay) return;
  if (!document.body) return;
  if (!wrThinkingEl) {
    wrThinkingEl = document.createElement('div');
    wrThinkingEl.className = 'wr-thinking wr-thinking-enhanced';
    wrThinkingEl.textContent = 'WallRush Helper thinking...';
    document.body.appendChild(wrThinkingEl);
  }
  if (reason) wrThinkingEl.dataset.reason = reason;
  var board = document.getElementById('board');
  if (board && !board.classList.contains('wr-board-thinking')) {
    board.classList.add('wr-board-thinking');
  }
}

function wrHideThinking() {
  if (wrThinkingEl && wrThinkingEl.parentNode) wrThinkingEl.parentNode.removeChild(wrThinkingEl);
  wrThinkingEl = null;
  var board = document.getElementById('board');
  if (board) board.classList.remove('wr-board-thinking');
}

function wallRectGeom(vw, u, g, pad) {
  const thick = g * 0.78;
  const inset = -g / 2;
  const len = 2 * u + g - 2 * inset;
  const ax = pad + vw.c * (u + g);
  const ay = pad + vw.r * (u + g);

  if (vw.o === 'h') {
    return { x: ax + inset, y: ay + u + g / 2 - thick / 2, w: len, h: thick };
  }

  return { x: ax + u + g / 2 - thick / 2, y: ay + inset, w: thick, h: len };
}

function showSuggestion(state, move) {
  clearHighlight();

  const board = $('board');
  if (!board) return;

  let x = 0, y = 0, w = 0, h = 0;

  if (move.type === 'pawn') {
    const v = spinCell(move.r, move.c, state.viewTurns, state.n);
    x = state.pad + v.c * (state.u + state.g);
    y = state.pad + v.r * (state.u + state.g);
    w = state.u;
    h = state.u;
  } else {
    const vw = spinWall({ r: move.r, c: move.c, o: move.o }, state.viewTurns, state.n - 1);
    const rect = wallRectGeom(vw, state.u, state.g, state.pad);
    x = rect.x;
    y = rect.y;
    w = rect.w;
    h = rect.h;
  }

  const div = document.createElement('div');
  div.className = 'wr-suggestion';
  div.style.position = 'absolute';
  div.style.pointerEvents = 'none';
  div.style.zIndex = '9999';
  div.style.left = x + 'px';
  div.style.top = y + 'px';
  div.style.width = w + 'px';
  div.style.height = h + 'px';
  div.style.border = '3px solid #00e676';
  div.style.borderRadius = '6px';
  div.style.boxShadow = '0 0 12px #00e676, inset 0 0 8px rgba(0,230,118,0.4)';
  div.style.background = 'rgba(0,230,118,0.12)';
  div.style.boxSizing = 'border-box';
  div.style.animation = 'wr-pulse 0.9s ease-in-out infinite';

  board.appendChild(div);
  highlight = div;
}

if (!document.getElementById('wr-style')) {
  const st = document.createElement('style');
  st.id = 'wr-style';
  st.textContent = '@keyframes wr-pulse {0%,100%{opacity:1}50%{opacity:.45}} @keyframes wr-thinking {0%,100%{opacity:.95}50%{opacity:.55}} @keyframes wr-board-thinking {0%,100%{box-shadow:0 0 20px rgba(0,230,118,0.3)}50%{box-shadow:0 0 30px rgba(0,230,118,0.6)}} .wr-thinking{position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 18px;border-radius:999px;background:rgba(10,14,20,.95);color:#8fe6ff;font:bold 14px system-ui,-apple-system,sans-serif;border:2px solid #00e676;box-shadow:0 0 15px rgba(0,230,118,.5);pointer-events:none;animation:wr-thinking 1.1s ease-in-out infinite;letter-spacing:0.5px;} .wr-thinking::before{content:"⚡";margin-right:6px;font-size:16px;} .wr-board-thinking{animation:wr-board-thinking 1.5s ease-in-out infinite !important;}';
  document.head.appendChild(st);
}

function fireSim(target, type, x, y) {
  if (!target) return;
  try {
    if (type.indexOf('pointer') === 0 && window.PointerEvent) {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
        pointerId: 1,
        isPrimary: true,
        pointerType: 'mouse'
      }));
    } else {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1
      }));
    }
  } catch (e) {}
}

function simulateTapAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return false;

  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
    fireSim(el, t, x, y);
  });

  return true;
}

function simulateDrag(handle, x1, y1, x2, y2) {
  ['pointerdown', 'mousedown'].forEach(function (t) {
    fireSim(handle, t, x1, y1);
  });

  const steps = 10;

  for (let i = 1; i <= steps; i++) {
    const x = x1 + (x2 - x1) * i / steps;
    const y = y1 + (y2 - y1) * i / steps;

    ['pointermove', 'mousemove'].forEach(function (t) {
      fireSim(handle, t, x, y);
      fireSim(document, t, x, y);
      fireSim(document.body, t, x, y);
    });
  }

  ['pointerup', 'mouseup'].forEach(function (t) {
    fireSim(handle, t, x2, y2);
    fireSim(document, t, x2, y2);
    fireSim(document.body, t, x2, y2);
  });
}


// ---- Auto-play wall drag helpers (patched) ----
function wrDelay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function wrFirePointer(target, type, x, y) {
  if (!target || typeof PointerEvent === 'undefined') return;
  try {
    var isUp = (type === 'pointerup' || type === 'pointercancel');
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: isUp ? 0 : 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      width: 1, height: 1, pressure: isUp ? 0 : 0.5
    }));
  } catch (e) {}
}

function wrFireTouch(target, type, x, y) {
  if (!target || typeof Touch === 'undefined' || typeof TouchEvent === 'undefined') return;
  try {
    var isEnd = (type === 'touchend' || type === 'touchcancel');
    var touch = new Touch({
      identifier: 1, target: target,
      clientX: x, clientY: y, screenX: x, screenY: y,
      radiusX: 5, radiusY: 5, force: isEnd ? 0 : 1
    });
    target.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: isEnd ? [] : [touch],
      targetTouches: isEnd ? [] : [touch],
      changedTouches: [touch]
    }));
  } catch (e) {}
}

function wrFireMouse(target, type, x, y) {
  if (!target) return;
  try {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: (type === 'mouseup') ? 0 : 1
    }));
  } catch (e) {}
}

async function wrSimulateWallDrag(handle, board, sx, sy, tx, ty) {
  var steps = 15;
  var stepMs = 18;
  var wallsBefore = board.querySelectorAll('.wall:not(.preview)').length;

  // Strategy A: PointerEvent
  wrFirePointer(handle, 'pointerdown', sx, sy);
  await wrDelay(stepMs);
  for (var i = 1; i <= steps; i++) {
    var x = sx + (tx - sx) * i / steps;
    var y = sy + (ty - sy) * i / steps;
    wrFirePointer(handle, 'pointermove', x, y);
    wrFirePointer(document, 'pointermove', x, y);
    if (i % 4 === 0) await wrDelay(stepMs);
  }
  wrFirePointer(board, 'pointerup', tx, ty);
  wrFirePointer(document, 'pointerup', tx, ty);
  await wrDelay(200);
  if (board.querySelectorAll('.wall:not(.preview)').length > wallsBefore) return 'pointer';

  // Strategy B: TouchEvent
  wrFireTouch(handle, 'touchstart', sx, sy);
  await wrDelay(stepMs);
  for (var i = 1; i <= steps; i++) {
    var x = sx + (tx - sx) * i / steps;
    var y = sy + (ty - sy) * i / steps;
    wrFireTouch(handle, 'touchmove', x, y);
    wrFireTouch(document, 'touchmove', x, y);
    if (i % 4 === 0) await wrDelay(stepMs);
  }
  wrFireTouch(board, 'touchend', tx, ty);
  wrFireTouch(document, 'touchend', tx, ty);
  await wrDelay(200);
  if (board.querySelectorAll('.wall:not(.preview)').length > wallsBefore) return 'touch';

  // Strategy C: MouseEvent
  wrFireMouse(handle, 'mousedown', sx, sy);
  await wrDelay(stepMs);
  for (var i = 1; i <= steps; i++) {
    var x = sx + (tx - sx) * i / steps;
    var y = sy + (ty - sy) * i / steps;
    wrFireMouse(document, 'mousemove', x, y);
    if (i % 4 === 0) await wrDelay(stepMs);
  }
  wrFireMouse(board, 'mouseup', tx, ty);
  wrFireMouse(document, 'mouseup', tx, ty);
  await wrDelay(200);
  if (board.querySelectorAll('.wall:not(.preview)').length > wallsBefore) return 'mouse';

  return 'none';
}

async function applyMove(state, move) {
  if (!state || !move) return;

  try {
    if (move.type === 'pawn') {
      var v = spinCell(move.r, move.c, state.viewTurns, state.n);
      var cell = document.querySelector('.cell[data-vr="' + v.r + '"][data-vc="' + v.c + '"]');
      if (cell) {
        cell.click();
        wrPush('AUTO_MOVE_DETAIL', { type: 'pawn', cell: v.r + ',' + v.c });
      }
      return;
    }

    if (move.type === 'wall') {
      var handle = move.o === 'h'
        ? document.getElementById('drag-h')
        : document.getElementById('drag-v');
      var board = document.getElementById('board');

      if (!handle || !board) {
        wrPush('AUTO_MOVE_FAIL', { type: 'wall', reason: 'missing handle or board' });
        return;
      }

      var wallsBefore = board.querySelectorAll('.wall:not(.preview)').length;

      var vw = spinWall({ r: move.r, c: move.c, o: move.o }, state.viewTurns, state.n - 1);
      var rect = wallRectGeom(vw, state.u, state.g, state.pad);
      var boardRect = board.getBoundingClientRect();
      var handleRect = handle.getBoundingClientRect();

      var sx = handleRect.left + handleRect.width / 2;
      var sy = handleRect.top + handleRect.height / 2;
      var tx = boardRect.left + rect.x + rect.w / 2;
      var tyRaw = boardRect.top + rect.y + rect.h / 2;
      var ty = tyRaw + (state.u + state.g);
      wrPush('AUTO_WALL_TARGET_OFFSET', { wall: move.o + '(' + move.r + ',' + move.c + ')', yRaw: Math.round(tyRaw), yAdjusted: Math.round(ty), dy: Math.round(state.u + state.g) });

      wrPush('AUTO_MOVE_DETAIL', {
        type: 'wall',
        wall: move.o + '(' + move.r + ',' + move.c + ')',
        start: [Math.round(sx), Math.round(sy)],
        target: [Math.round(tx), Math.round(ty)],
        handleDisabled: handle.disabled,
        handleClass: handle.className,
        wallsBefore: wallsBefore
      });

      var strategy = await wrSimulateWallDrag(handle, board, sx, sy, tx, ty);

      await wrDelay(300);
      var wallsAfter = board.querySelectorAll('.wall:not(.preview)').length;

      wrPush('AUTO_MOVE_VERIFY', {
        type: 'wall',
        strategy: strategy,
        wallsBefore: wallsBefore,
        wallsAfter: wallsAfter,
        placed: wallsAfter > wallsBefore
      });

      [120, 400, 800, 1400].forEach(function (delayMs) {
        setTimeout(function () {
          var realNow = board.querySelectorAll('.wall:not(.preview)').length;
          var previewNow = board.querySelectorAll('.wall.preview').length;
          wrPush('AUTO_WALL_SURVIVAL', {
            wall: move.o + '(' + move.r + ',' + move.c + ')',
            strategy: strategy,
            delayMs: delayMs,
            realWalls: realNow,
            previewWalls: previewNow,
            deltaReal: realNow - wallsBefore,
            latestKey: latestKey,
            isMyTurn: latestState ? latestState.isMyTurn : null,
            turn: latestState ? latestState.turn : null
          });
        }, delayMs);
      });
    }
  } catch (e) {
    wrPush('AUTO_MOVE_ERROR', { error: String(e) });
  }
}


let lastKey = '';
let busy = false;
let extDead = false;
let reqGen = 0;
let lastSentKey = '';
let latestState = null;
let latestKey = '';

function tick() {
  if (extDead) return;

  const state = readBoard();
  if (!state) {
    clearHighlight();
    wrHideThinking();
    return;
  }

  observeState(state);
  checkGameOver(state);

  latestState = state;
  latestKey = JSON.stringify({
    m: state.mode,
    p: state.pawns,
    w: state.walls,
    l: state.left,
    t: state.turn
  });

  if (autoMoveInFlight) return;
  if (busy) {
    if (lastSentKey && lastSentKey !== latestKey) {
      clearHighlight();
      wrHideThinking(); // FIX: إخفاء التفكير فوراً عند القيام بحركة يدوية استباقية
      wrPush('STALE_WHILE_BUSY', { isMyTurn: state.isMyTurn, latestKey: latestKey });
      lastKey = '';
    }
    return;
  }

  if (!state.isMyTurn) {
    clearHighlight();
    wrHideThinking();
    lastKey = '';
    lastSentKey = '';
    return;
  }

  const key = latestKey;
  if (key === lastKey) return;

  lastKey = key;
  lastSentKey = key;
  reqGen++;
  const gen = reqGen;
  busy = true;

  try {
    recordRecent(state);
    const recent = RECENT.slice();

    wrShowThinking('engine_request');
    wrPush('ENGINE_REQUEST', {
      mode: state.mode,
      myIndex: state.myIndex,
      turn: state.turn,
      recent: recent.length,
      autoPlay: autoPlay
    });

    chrome.runtime.sendMessage({
      type: 'ANALYZE',
      state: state,
      recent: recent
    }, function (resp) {
      busy = false;
      wrHideThinking();

      if (gen !== reqGen || !latestState || latestKey !== lastSentKey) {
        wrPush('ENGINE_RESPONSE_IGNORED_STALE', {
          gen: gen,
          reqGen: reqGen,
          latestKey: latestKey,
          lastSentKey: lastSentKey
        });
        clearHighlight();
        setTimeout(tick, 0);
        return;
      }

      if (chrome.runtime.lastError) {
        const msg = String(chrome.runtime.lastError.message || '');
        if (msg.indexOf('Extension context invalidated') >= 0) {
          extDead = true;
          console.info('[WR] extension reloaded — refresh page to reconnect.');
        } else {
          console.warn('[WR] msg failed:', msg);
        }
        return;
      }

      if (!resp) return;

      wrLogEngineResponse(latestState || state, resp);

      if (resp.error) {
        console.warn('[WR] solver:', resp.error);
        return;
      }

      if (resp.move) {
        const st = latestState || state;

        if (autoPlay && st.isMyTurn) {
          const keyNow = latestKey;
          autoAttempts[keyNow] = (autoAttempts[keyNow] || 0) + 1;

          wrPush('AUTO_MOVE', {
            type: resp.move.type,
            move: wrMoveStr(resp.move),
            attempt: autoAttempts[keyNow]
          });

          autoMoveInFlight = true;
          Promise.resolve(applyMove(st, resp.move)).then(function () {
            autoMoveInFlight = false;
            setTimeout(function () {
              if (!autoPlay) return;

              if (latestState && latestState.isMyTurn && latestKey === keyNow) {
                if ((autoAttempts[keyNow] || 0) < 3) {
                  wrPush('AUTO_RETRY', {
                    move: wrMoveStr(resp.move),
                    attempt: autoAttempts[keyNow],
                    reason: 'state_unchanged_after_apply'
                  });
                  lastKey = '';
                  setTimeout(tick, 0);
                } else {
                  wrPush('AUTO_FAILED', { move: wrMoveStr(resp.move), reason: 'too_many_attempts_same_state' });
                  showSuggestion(latestState, resp.move);
                }
              } else {
                delete autoAttempts[keyNow];
              }
            }, 650);
          }).catch(function (err) {
            autoMoveInFlight = false;
            wrPush('AUTO_MOVE_PROMISE_ERROR', { error: String(err) });
          });
        } else if (!autoPlay) {
          showSuggestion(st, resp.move);
        } else {
          clearHighlight();
        }
      }
    });
  } catch (e) {
    busy = false;
    wrHideThinking();

    if (String(e).indexOf('Extension context invalidated') >= 0) {
      extDead = true;
      console.info('[WR] extension reloaded — refresh page to reconnect.');
    } else {
      console.warn('[WR] send failed:', e);
    }
  }
}

setInterval(tick, 400);

new MutationObserver(function () {
  clearTimeout(window.__wrT);
  window.__wrT = setTimeout(tick, 120);
}).observe(document.body, { childList: true, subtree: true });

chrome.storage.local.get({ level: 4, autoPlay: false }, function (r) {
  wrPush('LEVEL_LOADED', { level: r.level });
  setAutoPlay(!!r.autoPlay, 'init');
});

wrPush('CONTENT_SCRIPT_INIT', {
  href: location.href,
  time: new Date().toISOString()
});

})();
