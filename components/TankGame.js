'use client';

import { useEffect, useRef, useState } from 'react';

// ---------- 常量 ----------
const CELL = 48; // 粗网格单元（坦克大小）
const TILE = 24; // 细网格（砖块破坏粒度）
const GRID = 13; // 13x13 粗网格
const W = CELL * GRID; // 624
const H = CELL * GRID;
const SIZE = 44; // 坦克实际尺寸
const OFF = 2; // 坦克在单元格内的偏移

const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIR_ANGLE = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

// 关卡定义（13x13）：. 空地  B 砖墙  S 钢墙  E 基地  P 玩家出生点  e 敌人出生点
const LEVELS = [
  [
    'e.....e.....e',
    '.............',
    '.BB.BB.BB.BB.',
    '.BB.BB.BB.BB.',
    '.BB.BB.BB.BB.',
    '.............',
    '.BB.BB.BB.BB.',
    '.BB.BB.BB.BB.',
    '.BB.BB.BB.BB.',
    '.............',
    '.BB..BBB..BB.',
    '.....BBB.....',
    '....PBEB.....',
  ],
  [
    'e.....e.....e',
    '.............',
    '.BB.BB.BB.BB.',
    '.BB.SS.BB.SS.',
    '.BB.BB.BB.BB.',
    '.............',
    'BB..BB.BB..BB',
    'BB..BB.BB..BB',
    'BB..BB.BB..BB',
    '.............',
    '.BB..BBB..BB.',
    '.....BBB.....',
    '....PBEB.....',
  ],
  [
    'e.....e.....e',
    '.............',
    '.BB.BB.BB.BB.',
    '.SS.BB.BB.SS.',
    '.BB.BB.BB.BB.',
    '.............',
    '.BB.SS..SS.BB',
    '.BB.BB..BB.BB',
    '.BB.BB..BB.BB',
    '.............',
    '.BB..BBB..BB.',
    '.....BBB.....',
    '....PBEB.....',
  ],
];

const ENEMY_SPAWNS = [
  { x: 0 * CELL + OFF, y: OFF },
  { x: 6 * CELL + OFF, y: OFF },
  { x: 12 * CELL + OFF, y: OFF },
];

// ---------- 工具函数 ----------
function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

const snap = (v) => Math.round((v - OFF) / CELL) * CELL + OFF;

// 解析关卡字符串 -> 26x26 细网格地图（0空 1砖 2钢 3基地）
function parseLevel(def) {
  const map = Array.from({ length: GRID * 2 }, () => new Array(GRID * 2).fill(0));
  let eagle = null;
  let playerSpawn = { x: 4 * CELL + OFF, y: 12 * CELL + OFF };
  const setCell = (r, c, v) => {
    for (let dr = 0; dr < 2; dr++)
      for (let dc = 0; dc < 2; dc++) map[r * 2 + dr][c * 2 + dc] = v;
  };
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const ch = def[r][c];
      if (ch === 'B') setCell(r, c, 1);
      else if (ch === 'S') setCell(r, c, 2);
      else if (ch === 'E') {
        setCell(r, c, 3);
        eagle = { x: c * CELL, y: r * CELL, alive: true };
      } else if (ch === 'P') playerSpawn = { x: c * CELL + OFF, y: r * CELL + OFF };
    }
  }
  if (!eagle) {
    // 容错：关卡必须包含基地(E)，否则使用默认底部中央位置
    console.error('关卡缺少基地(E)定义，使用默认底部中央位置');
    setCell(GRID - 1, 6, 3);
    eagle = { x: 6 * CELL, y: (GRID - 1) * CELL, alive: true };
  }
  return { map, eagle, playerSpawn };
}

// 某位置是否可以放置坦克（边界 / 地形 / 其他坦克）
function canPlace(g, x, y, self) {
  if (x < 0 || y < 0 || x + SIZE > W || y + SIZE > H) return false;
  const t0 = Math.floor(x / TILE);
  const t1 = Math.floor((x + SIZE - 0.01) / TILE);
  const r0 = Math.floor(y / TILE);
  const r1 = Math.floor((y + SIZE - 0.01) / TILE);
  for (let r = r0; r <= r1; r++)
    for (let t = t0; t <= t1; t++) if (g.map[r][t] !== 0) return false;
  const list = [...g.enemies];
  if (g.player.alive) list.push(g.player);
  for (const o of list) {
    if (o === self || !o.alive) continue;
    if (overlaps(x, y, SIZE, SIZE, o.x, o.y, SIZE, SIZE)) return false;
  }
  return true;
}

// 转向时对齐到粗网格，方便钻缝
function setDir(tank, dir, g) {
  if (tank.dir === dir) return;
  const oldAxis = tank.dir === 'up' || tank.dir === 'down' ? 'v' : 'h';
  const newAxis = dir === 'up' || dir === 'down' ? 'v' : 'h';
  tank.dir = dir;
  if (oldAxis === newAxis) return; // 原地掉头不需要对齐
  if (newAxis === 'h') {
    const sx = snap(tank.x);
    if (canPlace(g, sx, tank.y, tank)) tank.x = sx;
  } else {
    const sy = snap(tank.y);
    if (canPlace(g, tank.x, sy, tank)) tank.y = sy;
  }
}

function fire(g, tank) {
  const [dx, dy] = DIR_VEC[tank.dir];
  g.bullets.push({
    x: tank.x + SIZE / 2 + dx * 26,
    y: tank.y + SIZE / 2 + dy * 26,
    dx,
    dy,
    speed: tank.isPlayer ? 430 : 300,
    fromPlayer: !!tank.isPlayer,
    owner: tank,
  });
}

function explosion(g, x, y, big) {
  const n = big ? 18 : 6;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (big ? 60 : 30) + Math.random() * (big ? 160 : 60);
    g.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.3 + Math.random() * 0.35,
      maxLife: 0.65,
      size: (big ? 5 : 3) + Math.random() * 4,
      color: ['#ffdd55', '#ff9922', '#ff5500', '#999999'][Math.floor(Math.random() * 4)],
    });
  }
}
const spark = (g, x, y) => explosion(g, x, y, false);

// 子弹与地形碰撞，返回 'eagle' | 'steel' | 'brick' | null
function bulletTileCheck(g, b) {
  const t0 = Math.floor((b.x - 3) / TILE);
  const t1 = Math.floor((b.x + 3 - 0.01) / TILE);
  const r0 = Math.floor((b.y - 3) / TILE);
  const r1 = Math.floor((b.y + 3 - 0.01) / TILE);
  let brick = false;
  for (let r = r0; r <= r1; r++) {
    for (let t = t0; t <= t1; t++) {
      if (r < 0 || r >= GRID * 2 || t < 0 || t >= GRID * 2) continue;
      const v = g.map[r][t];
      if (v === 3) return 'eagle';
      if (v === 2) return 'steel';
      if (v === 1) brick = true;
    }
  }
  if (brick) {
    // 垂直于飞行方向扩大破坏带（约两个细格宽）
    const N = GRID * 2;
    if (b.dy !== 0) {
      const ct0 = Math.floor((b.x - 20) / TILE);
      const ct1 = Math.floor((b.x + 20) / TILE);
      for (let r = r0; r <= r1; r++)
        for (let t = ct0; t <= ct1; t++)
          if (r >= 0 && r < N && t >= 0 && t < N && g.map[r][t] === 1) g.map[r][t] = 0;
    } else {
      const cr0 = Math.floor((b.y - 20) / TILE);
      const cr1 = Math.floor((b.y + 20) / TILE);
      for (let r = cr0; r <= cr1; r++)
        for (let t = t0; t <= t1; t++)
          if (r >= 0 && r < N && t >= 0 && t < N && g.map[r][t] === 1) g.map[r][t] = 0;
    }
    return 'brick';
  }
  return null;
}

function killEnemy(g, e) {
  explosion(g, e.x + SIZE / 2, e.y + SIZE / 2, true);
  g.score += e.fast ? 200 : 100;
  g.killed++;
  g.enemies = g.enemies.filter((x) => x !== e);
}

function killPlayer(g) {
  const p = g.player;
  explosion(g, p.x + SIZE / 2, p.y + SIZE / 2, true);
  p.alive = false;
  p.respawnTimer = 2;
  g.lives--;
  if (g.lives <= 0) g.state = 'gameover';
}

// ---------- 敌人 AI ----------
function pickDir(g, e) {
  const r = Math.random();
  if (r < 0.35 && g.player.alive) {
    // 追击玩家
    const t = g.player;
    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const hx = dx > 0 ? 'right' : 'left';
    const vy = dy > 0 ? 'down' : 'up';
    const primary = Math.abs(dx) > Math.abs(dy) ? hx : vy;
    const secondary = Math.abs(dx) > Math.abs(dy) ? vy : hx;
    return Math.random() < 0.75 ? primary : secondary;
  }
  if (r < 0.45 && g.eagle.alive) {
    // 偶尔冲击基地
    const t = { x: g.eagle.x + OFF, y: g.eagle.y + OFF };
    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const hx = dx > 0 ? 'right' : 'left';
    const vy = dy > 0 ? 'down' : 'up';
    const primary = Math.abs(dx) > Math.abs(dy) ? hx : vy;
    const secondary = Math.abs(dx) > Math.abs(dy) ? vy : hx;
    return Math.random() < 0.75 ? primary : secondary;
  }
  return ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)];
}

// 是否正面朝向目标（用于 AI 开火判断）
function facingTarget(e, t) {
  const ecx = e.x + SIZE / 2;
  const ecy = e.y + SIZE / 2;
  const tcx = t.x + SIZE / 2;
  const tcy = t.y + SIZE / 2;
  if (Math.abs(ecx - tcx) < CELL / 2) {
    if (tcy > ecy && e.dir === 'down') return true;
    if (tcy < ecy && e.dir === 'up') return true;
  }
  if (Math.abs(ecy - tcy) < CELL / 2) {
    if (tcx > ecx && e.dir === 'right') return true;
    if (tcx < ecx && e.dir === 'left') return true;
  }
  return false;
}

function updateEnemy(g, e, dt) {
  e.moveTimer -= dt;
  const [dx, dy] = DIR_VEC[e.dir];
  const nx = e.x + dx * e.speed * dt;
  const ny = e.y + dy * e.speed * dt;
  let moved = false;
  if (canPlace(g, nx, ny, e)) {
    e.x = nx;
    e.y = ny;
    moved = true;
  }
  if (moved) {
    e.blockedTime = 0;
  } else {
    e.blockedTime += dt;
    if (e.blockedTime > 0.2) {
      setDir(e, pickDir(g, e), g);
      e.blockedTime = 0;
      e.moveTimer = 0.5 + Math.random() * 1.5;
    }
  }
  if (e.moveTimer <= 0) {
    setDir(e, pickDir(g, e), g);
    e.moveTimer = 1 + Math.random() * 2;
  }
  // 射击
  e.shootTimer -= dt;
  let wantShoot = e.shootTimer <= 0;
  if (!wantShoot && Math.random() < 0.006) {
    const targets = [];
    if (g.player.alive) targets.push(g.player);
    if (g.eagle.alive) targets.push({ x: g.eagle.x + OFF, y: g.eagle.y + OFF });
    if (
      targets.some(
        (t) => facingTarget(e, t) && Math.hypot(t.x - e.x, t.y - e.y) < 300
      )
    )
      wantShoot = true;
  }
  if (wantShoot && !g.bullets.some((b) => b.owner === e)) {
    fire(g, e);
    e.shootTimer = 1.2 + Math.random() * 2;
  }
}

// ---------- 更新逻辑 ----------
function updatePlayer(g, keys, dirStack, dt) {
  const p = g.player;
  if (!p.alive) {
    p.respawnTimer -= dt;
    if (p.respawnTimer <= 0 && g.lives > 0 && canPlace(g, g.playerSpawn.x, g.playerSpawn.y, null)) {
      p.x = g.playerSpawn.x;
      p.y = g.playerSpawn.y;
      p.dir = 'up';
      p.alive = true;
      p.shield = 2.5;
      p.cooldown = 0;
    }
    return;
  }
  p.shield = Math.max(0, p.shield - dt);
  p.cooldown = Math.max(0, p.cooldown - dt);
  const dir = dirStack.length ? dirStack[dirStack.length - 1] : null;
  if (dir) {
    setDir(p, dir, g);
    const [dx, dy] = DIR_VEC[p.dir];
    const nx = p.x + dx * p.speed * dt;
    const ny = p.y + dy * p.speed * dt;
    if (canPlace(g, nx, ny, p)) {
      p.x = nx;
      p.y = ny;
    }
  }
  if (keys.fire && p.cooldown <= 0 && g.bullets.filter((b) => b.fromPlayer).length < 2) {
    fire(g, p);
    p.cooldown = 0.22;
  }
}

function updateBullets(g, dt) {
  for (let i = g.bullets.length - 1; i >= 0; i--) {
    const b = g.bullets[i];
    b.x += b.dx * b.speed * dt;
    b.y += b.dy * b.speed * dt;
    if (b.x < 4 || b.x > W - 4 || b.y < 4 || b.y > H - 4) {
      spark(g, b.x, b.y);
      g.bullets.splice(i, 1);
      continue;
    }
    const res = bulletTileCheck(g, b);
    if (res === 'eagle') {
      g.eagle.alive = false;
      explosion(g, b.x, b.y, true);
      g.state = 'gameover';
      g.bullets.splice(i, 1);
      continue;
    }
    if (res === 'steel' || res === 'brick') {
      spark(g, b.x, b.y);
      g.bullets.splice(i, 1);
      continue;
    }
    let hit = false;
    if (b.fromPlayer) {
      for (const e of g.enemies) {
        if (overlaps(b.x - 4, b.y - 4, 8, 8, e.x, e.y, SIZE, SIZE)) {
          killEnemy(g, e);
          hit = true;
          break;
        }
      }
    } else {
      const p = g.player;
      if (p.alive && p.shield <= 0 && overlaps(b.x - 4, b.y - 4, 8, 8, p.x, p.y, SIZE, SIZE)) {
        killPlayer(g);
        hit = true;
      }
    }
    if (hit) g.bullets.splice(i, 1);
  }
  // 敌我子弹对撞
  for (let i = g.bullets.length - 1; i >= 0; i--) {
    for (let j = i - 1; j >= 0; j--) {
      const a = g.bullets[i];
      const c = g.bullets[j];
      if (a.fromPlayer !== c.fromPlayer && overlaps(a.x - 4, a.y - 4, 8, 8, c.x - 4, c.y - 4, 8, 8)) {
        spark(g, (a.x + c.x) / 2, (a.y + c.y) / 2);
        g.bullets.splice(i, 1);
        g.bullets.splice(j, 1);
        break;
      }
    }
  }
}

function updateSpawns(g, dt) {
  if (g.spawnedCount >= g.totalEnemies || g.enemies.length >= g.maxOnField) return;
  g.spawnTimer -= dt;
  if (g.spawnTimer > 0) return;
  for (let i = 0; i < 3; i++) {
    const sp = ENEMY_SPAWNS[g.spawnCycle % 3];
    g.spawnCycle++;
    if (canPlace(g, sp.x, sp.y, null)) {
      const fast = g.spawnedCount % 4 === 3; // 每 4 个出一个快速坦克
      g.enemies.push({
        x: sp.x,
        y: sp.y,
        dir: 'down',
        speed: (fast ? 150 : 95) + (g.level - 1) * 15,
        fast,
        alive: true,
        shootTimer: 1.2 + Math.random(),
        moveTimer: 0.5,
        blockedTime: 0,
        shield: 0,
      });
      g.spawnedCount++;
      g.spawnTimer = 2.2;
      return;
    }
  }
  g.spawnTimer = 0.5;
}

function updateParticles(g, dt) {
  for (let i = g.particles.length - 1; i >= 0; i--) {
    const p = g.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) g.particles.splice(i, 1);
  }
}

function update(g, keys, dirStack, dt) {
  updateParticles(g, dt);
  if (g.state === 'playing') {
    updatePlayer(g, keys, dirStack, dt);
    for (const e of [...g.enemies]) updateEnemy(g, e, dt);
    updateBullets(g, dt);
    updateSpawns(g, dt);
    if (g.state === 'playing' && g.killed >= g.totalEnemies && g.enemies.length === 0) {
      g.score += 500;
      if (g.level >= LEVELS.length) {
        g.state = 'win';
      } else {
        g.state = 'levelclear';
        g.clearTimer = 2;
      }
    }
  } else if (g.state === 'levelclear') {
    g.clearTimer -= dt;
    if (g.clearTimer <= 0) {
      g.level++;
      g.lives = Math.min(g.lives + 1, 5); // 过关奖励一条命
      initLevel(g, g.level);
      g.state = 'playing';
    }
  }
}

// ---------- 游戏初始化 ----------
function initLevel(g, level) {
  const { map, eagle, playerSpawn } = parseLevel(LEVELS[level - 1]);
  g.map = map;
  g.eagle = eagle;
  g.playerSpawn = playerSpawn;
  g.player.x = playerSpawn.x;
  g.player.y = playerSpawn.y;
  g.player.dir = 'up';
  g.player.alive = true;
  g.player.shield = 2;
  g.player.cooldown = 0;
  g.enemies = [];
  g.bullets = [];
  g.particles = [];
  g.spawnedCount = 0;
  g.killed = 0;
  g.totalEnemies = 6 + level * 2;
  g.maxOnField = Math.min(2 + level, 4);
  g.spawnTimer = 1;
  g.spawnCycle = 0;
}

function initGame() {
  const g = {
    state: 'menu',
    level: 1,
    score: 0,
    lives: 3,
    time: 0,
    player: { isPlayer: true, x: 0, y: 0, dir: 'up', speed: 130, alive: true, respawnTimer: 0, shield: 0, cooldown: 0 },
    enemies: [],
    bullets: [],
    particles: [],
    map: null,
    eagle: null,
    playerSpawn: null,
    spawnedCount: 0,
    killed: 0,
    totalEnemies: 0,
    maxOnField: 3,
    spawnTimer: 0,
    spawnCycle: 0,
    clearTimer: 0,
  };
  initLevel(g, 1);
  return g;
}

// ---------- 绘制 ----------
function drawBrick(ctx, x, y) {
  ctx.fillStyle = '#7a3000';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#b3500e';
  ctx.fillRect(x + 1, y + 1, TILE - 2, 10);
  ctx.fillRect(x + 1, y + 13, 10, 10);
  ctx.fillRect(x + 13, y + 13, 10, 10);
}

function drawSteel(ctx, x, y) {
  ctx.fillStyle = '#63636e';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#aeaebe';
  ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  ctx.fillStyle = '#7c7c8a';
  ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
}

function drawEagle(ctx, e) {
  const { x, y } = e;
  if (e.alive) {
    ctx.fillStyle = '#6b5116';
    ctx.fillRect(x + 2, y + 2, 44, 44);
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(x + 6, y + 6, 36, 36);
    ctx.fillStyle = '#5a3c00';
    ctx.font = 'bold 30px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', x + 24, y + 26);
  } else {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(x + 2, y + 2, 44, 44);
    ctx.fillStyle = '#666';
    ctx.fillRect(x + 8, y + 28, 12, 14);
    ctx.fillRect(x + 26, y + 22, 14, 20);
    ctx.fillRect(x + 14, y + 12, 10, 10);
  }
}

function drawTank(ctx, t, time) {
  const cx = t.x + SIZE / 2;
  const cy = t.y + SIZE / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(DIR_ANGLE[t.dir]);
  const body = t.isPlayer ? '#e8a020' : t.fast ? '#d84040' : '#c0c0c0';
  const dark = t.isPlayer ? '#8a5a00' : t.fast ? '#7a1a1a' : '#666666';
  const light = t.isPlayer ? '#ffd970' : t.fast ? '#ff8080' : '#eeeeee';
  // 履带
  ctx.fillStyle = dark;
  ctx.fillRect(-22, -20, 10, 40);
  ctx.fillRect(12, -20, 10, 40);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = -20; i < 20; i += 8) {
    ctx.fillRect(-22, i, 10, 3);
    ctx.fillRect(12, i, 10, 3);
  }
  // 车体
  ctx.fillStyle = body;
  ctx.fillRect(-12, -16, 24, 34);
  // 炮塔
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(0, 2, 10, 0, Math.PI * 2);
  ctx.fill();
  // 炮管
  ctx.fillStyle = dark;
  ctx.fillRect(-3, -26, 6, 22);
  ctx.restore();
  // 复活护盾
  if (t.shield > 0) {
    ctx.strokeStyle = `rgba(80,200,255,${0.5 + 0.4 * Math.sin(time * 12)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawOverlay(ctx, g) {
  const s = g.state;
  if (s === 'playing') return;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const blink = 0.55 + 0.45 * Math.sin(g.time * 4);
  const title = (str, color = '#f5c518') => {
    ctx.font = 'bold 52px "Courier New", monospace';
    ctx.fillStyle = color;
    ctx.fillText(str, W / 2, H / 2 - 110);
  };
  const text = (str, y, a = 1) => {
    ctx.font = '20px "Courier New", monospace';
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillText(str, W / 2, y);
  };
  if (s === 'menu') {
    title('坦 克 大 战');
    text('保护你的基地（★），消灭所有敌人！', H / 2 - 40);
    text('按 ENTER 或点击画面开始', H / 2 + 20, blink);
    text('移动：W A S D / 方向键', H / 2 + 75);
    text('开火：空格 / J      暂停：P', H / 2 + 108);
  } else if (s === 'paused') {
    title('暂 停', '#eeeeee');
    text('按 P 继续', H / 2 + 20, blink);
  } else if (s === 'gameover') {
    title('游 戏 结 束', '#e04040');
    text(`得分：${g.score}`, H / 2 - 40);
    text('按 ENTER 或点击画面重新开始', H / 2 + 20, blink);
  } else if (s === 'win') {
    title('胜 利 ！');
    text(`得分：${g.score}`, H / 2 - 40);
    text('按 ENTER 或点击画面再来一局', H / 2 + 20, blink);
  } else if (s === 'levelclear') {
    title(`第 ${g.level} 关完成！`);
    text(`奖励 500 分 · 准备下一关...`, H / 2 - 40);
  }
}

function draw(ctx, g) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  // 地形
  for (let r = 0; r < GRID * 2; r++)
    for (let t = 0; t < GRID * 2; t++) {
      const v = g.map[r][t];
      if (v === 1) drawBrick(ctx, t * TILE, r * TILE);
      else if (v === 2) drawSteel(ctx, t * TILE, r * TILE);
    }
  drawEagle(ctx, g.eagle);
  // 子弹
  ctx.fillStyle = '#ffffff';
  for (const b of g.bullets) ctx.fillRect(b.x - 3, b.y - 3, 6, 6);
  // 坦克
  for (const e of g.enemies) drawTank(ctx, e, g.time);
  if (g.player.alive) drawTank(ctx, g.player, g.time);
  // 爆炸粒子
  for (const p of g.particles) {
    const k = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = k;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * k), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawOverlay(ctx, g);
}

// ---------- React 组件 ----------
const KEY_DIR = {
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down',
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
};

export default function TankGame() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const keysRef = useRef({ fire: false });
  const dirStackRef = useRef([]);
  const startGameRef = useRef(null);
  const lastHudRef = useRef('');
  const [hud, setHud] = useState({ score: 0, lives: 3, level: 1, remaining: 8 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;
    let last = performance.now();

    const g = initGame();
    gameRef.current = g;

    const startGame = () => {
      g.score = 0;
      g.lives = 3;
      g.level = 1;
      initLevel(g, 1);
      g.state = 'playing';
    };
    startGameRef.current = startGame;

    const onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (k === 'enter') {
        const s = gameRef.current.state;
        if (s === 'menu' || s === 'gameover' || s === 'win') startGameRef.current();
        return;
      }
      if (k === 'p') {
        const s = gameRef.current.state;
        if (s === 'playing') gameRef.current.state = 'paused';
        else if (s === 'paused') gameRef.current.state = 'playing';
        return;
      }
      const d = KEY_DIR[k];
      if (d && !dirStackRef.current.includes(d)) dirStackRef.current.push(d);
      if (k === ' ' || k === 'j') keysRef.current.fire = true;
    };

    const onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      const d = KEY_DIR[k];
      if (d) dirStackRef.current = dirStackRef.current.filter((x) => x !== d);
      if (k === ' ' || k === 'j') keysRef.current.fire = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const syncHud = () => {
      const info = {
        score: g.score,
        lives: Math.max(0, g.lives),
        level: g.level,
        remaining: Math.max(0, g.totalEnemies - g.killed),
      };
      const key = JSON.stringify(info);
      if (key !== lastHudRef.current) {
        lastHudRef.current = key;
        setHud(info);
      }
    };

    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      g.time += dt;
      try {
        update(g, keysRef.current, dirStackRef.current, dt);
        draw(ctx, g);
      } catch (err) {
        // 单帧出错不应导致整个游戏循环死亡
        console.error('游戏循环出错:', err);
      }
      syncHud();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const handleCanvasClick = () => {
    const s = gameRef.current?.state;
    if (s === 'menu' || s === 'gameover' || s === 'win') startGameRef.current?.();
  };

  return (
    <div className="game-wrapper">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onClick={handleCanvasClick}
        style={{ cursor: 'pointer' }}
      />
      <aside className="game-info">
        <h2>战况信息</h2>
        <div className="info-row">
          <span>关卡</span>
          <span className="value">{hud.level} / {LEVELS.length}</span>
        </div>
        <div className="info-row">
          <span>得分</span>
          <span className="value">{hud.score}</span>
        </div>
        <div className="info-row">
          <span>生命</span>
          <span className="value">{'❤'.repeat(hud.lives) || '—'}</span>
        </div>
        <div className="info-row">
          <span>剩余敌人</span>
          <span className="value">{hud.remaining}</span>
        </div>
        <h2>操作说明</h2>
        <div className="help-section">
          <p>
            <span className="key">W</span>
            <span className="key">A</span>
            <span className="key">S</span>
            <span className="key">D</span> / 方向键 移动
          </p>
          <p>
            <span className="key">空格</span> / <span className="key">J</span> 开火
          </p>
          <p>
            <span className="key">P</span> 暂停 / 继续
          </p>
          <p>
            <span className="key">Enter</span> 开始 / 重新开始
          </p>
          <p style={{ marginTop: 8, color: '#999' }}>
            提示：红色坦克速度快，得分 200；过关奖励一条命。
          </p>
        </div>
      </aside>
    </div>
  );
}
