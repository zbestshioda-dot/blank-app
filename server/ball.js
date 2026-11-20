'use strict';
// The football. There is one ball, on the pitch map. The server owns it, so everybody sees the same ball:
// it is stepped in small slices (so a hard shot cannot jump through a player), and the players on the pitch are
// told where it is. Walking into it pushes it, a kick sends it off, and it hops and rolls to a stop.
// Out over a line it comes back where it left; into a goal it scores and the game restarts from the centre spot.
// (public/game.js runs the same rolling / bouncing rules between updates so the ball moves smoothly on screen.)
const D = require('./data');
const F = D.PITCH_FIELD;

const GRAV = 30;          // tiles/s² pulling the ball down
const BOUNCE = 0.6;       // how much of its height speed it keeps on each hop
const ROLL = 0.8;         // rolling friction (per second)
const AIR = 0.25;         // air drag
const STOP = 0.15;        // slower than this on the ground = at rest
const REACH = 0.62;       // a player touches the ball inside this distance
const KICK_REACH = 1.5;   // a kick needs the ball this close
const SLICE = 0.025;      // seconds per physics slice
const GOAL_HOLD = 2600;   // ms the ball stays in the net before the restart
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;

const ball = { x: F.cx, y: F.cy, z: 0, vx: 0, vy: 0, vz: 0, by: '', goal: null };
let evs = [], lastHit = 0, lastSend = 0, sendNext = true;

function centre() { Object.assign(ball, { x: F.cx, y: F.cy, z: 0, vx: 0, vy: 0, vz: 0, goal: null }); sendNext = true; }
const moving = () => ball.vx !== 0 || ball.vy !== 0 || ball.z > 0 || ball.vz !== 0;

// state for the clients
function msg() { return { t: 'ball', x: r2(ball.x), y: r2(ball.y), z: r2(ball.z), vx: r2(ball.vx), vy: r2(ball.vy), vz: r2(ball.vz), g: ball.goal ? 1 : 0, by: ball.by }; }

// one slice of physics: gravity, hops, friction
function roll(dt) {
  const b = ball;
  if (b.z > 0 || b.vz > 0) {
    b.vz -= GRAV * dt; b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -1.6) { b.vz = -b.vz * BOUNCE; b.vx *= 0.93; b.vy *= 0.93; } else b.vz = 0;
    }
  }
  const damp = Math.exp(-(b.z > 0 ? AIR : ROLL) * dt);
  b.vx *= damp; b.vy *= damp;
  if (b.z === 0 && b.vz === 0 && Math.hypot(b.vx, b.vy) < STOP) b.vx = b.vy = 0;
  b.x += b.vx * dt; b.y += b.vy * dt;
}

// a player's running speed, worked out from where they were last time we looked
function velOf(a, t) {
  const k = a.ballTrack || (a.ballTrack = { x: a.x, y: a.y, t, vx: 0, vy: 0 });
  const d = (t - k.t) / 1000;
  if (d > 0.04) {
    const vx = clamp((a.x - k.x) / d, -9, 9), vy = clamp((a.y - k.y) / d, -9, 9);
    k.vx = k.vx * 0.4 + vx * 0.6; k.vy = k.vy * 0.4 + vy * 0.6; k.x = a.x; k.y = a.y; k.t = t;
  }
  return k;
}

// players on the pitch bump the ball: it bounces off them and gets carried along when they run into it
function touch(a, v, t) {
  const b = ball, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (d >= REACH || b.z > 0.8) return;
  let nx, ny;
  if (d > 0.01) { nx = dx / d; ny = dy / d; } else { const ang = (a.f || 0) * Math.PI / 4 - Math.PI; nx = Math.cos(ang); ny = Math.sin(ang); }
  const before = Math.hypot(b.vx, b.vy);
  const rel = (b.vx - v.vx) * nx + (b.vy - v.vy) * ny;
  if (rel < 0) { b.vx -= 1.55 * rel * nx; b.vy -= 1.55 * rel * ny; }          // it came at the player: bounce off
  const want = v.vx * nx + v.vy * ny + 1.3;                                      // the player runs into it: carry it ahead
  const have = b.vx * nx + b.vy * ny;
  if (have < want && Math.hypot(v.vx, v.vy) > 0.4) { b.vx += (want - have) * nx; b.vy += (want - have) * ny; }
  b.x = a.x + nx * REACH; b.y = a.y + ny * REACH;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > 5) b.vz = Math.max(b.vz, 1.8);                                        // a firm touch makes it hop
  if (Math.abs(sp - before) > 0.4) {
    b.by = a.name;
    if (t - lastHit > 160) { lastHit = t; evs.push({ k: 'hit', v: r2(Math.min(1, sp / 14)) }); }
  }
}

function out() {
  const b = ball;
  b.x = clamp(b.x, F.x0 + 0.45, F.x1 - 0.45); b.y = clamp(b.y, F.y0 + 0.45, F.y1 - 0.45);
  b.vx = b.vy = b.vz = 0; b.z = 0;
  evs.push({ k: 'out', x: r2(b.x), y: r2(b.y) });
}
function score(side, t) {
  const b = ball;
  b.goal = { t, side, by: b.by };
  b.vx *= 0.25; b.vy *= 0.25;
  evs.push({ k: 'goal', side, by: b.by });
}
// inside the net the ball cannot leave: it thuds against the netting and settles
function inNet() {
  const b = ball, lo = b.goal.side === 'L' ? F.x0 - F.gd + 0.3 : F.x1 + 0.3, hi = b.goal.side === 'L' ? F.x0 - 0.3 : F.x1 + F.gd - 0.3;
  if (b.x < lo) { b.x = lo; b.vx = Math.abs(b.vx) * 0.3; } else if (b.x > hi) { b.x = hi; b.vx = -Math.abs(b.vx) * 0.3; }
  const ylo = F.cy - F.gh + 0.3, yhi = F.cy + F.gh - 0.3;
  if (b.y < ylo) { b.y = ylo; b.vy = Math.abs(b.vy) * 0.3; } else if (b.y > yhi) { b.y = yhi; b.vy = -Math.abs(b.vy) * 0.3; }
}

// players: the accounts standing on the pitch map right now. Returns what happened (kicks, hits, goals, balls that went out)
// and whether the clients should be sent the ball's state this time. A kick waits in evs until the next tick.
function tick(t, dt, players) {
  const b = ball;
  if (b.goal && t - b.goal.t > GOAL_HOLD) { centre(); evs.push({ k: 'kickoff' }); }
  const vels = players.map(a => velOf(a, t));
  if (moving() || players.length) {
    const n = Math.max(1, Math.ceil(dt / SLICE)), h = dt / n;
    for (let i = 0; i < n; i++) {
      roll(h);
      if (b.goal) { inNet(); continue; }
      players.forEach((a, j) => touch(a, vels[j], t));
      if (b.x < F.x0 || b.x > F.x1 || b.y < F.y0 || b.y > F.y1) {
        const end = b.x < F.x0 || b.x > F.x1;
        if (end && Math.abs(b.y - F.cy) < F.gh && b.z < F.gz) score(b.x < F.x0 ? 'L' : 'R', t); else out();
      }
    }
  }
  const active = moving() || !!b.goal || evs.length > 0;
  const send = sendNext || active || t - lastSend > 1000;
  sendNext = false; if (send) lastSend = t;
  const happened = evs; evs = [];
  return { evs: happened, send };
}

// a kick: the player must have the ball at their feet. power 0 = a light pass, 1 = a full-blooded shot
function kick(a, power, t) {
  const b = ball;
  if (b.goal) return false;
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (d > KICK_REACH || b.z > 1.3) return false;
  const p = clamp(+power || 0, 0, 1), ang = (a.f || 0) * Math.PI / 4 - Math.PI;
  let dir = [Math.cos(ang), Math.sin(ang)];
  if (d > 0.2 && dir[0] * dx / d + dir[1] * dy / d < 0.15) dir = [dx / d, dy / d];   // ball is beside or behind: knock it away from you
  const sp = 7 + 12 * p;
  b.vx = dir[0] * sp; b.vy = dir[1] * sp; b.vz = 2 + 7.5 * p; b.by = a.name;
  evs.push({ k: 'kick', v: r2(p) }); lastHit = t; sendNext = true;
  return true;
}
module.exports = { ball, tick, kick, msg, centre };
