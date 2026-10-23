#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");

const DW = 8;
const DH = 7;
const SEGS = [
  [0, 0, 2, DW - 3],
  [1, 2, DW - 2, DW - 1],
  [4, 5, DW - 2, DW - 1],
  [6, 6, 2, DW - 3],
  [4, 5, 0, 1],
  [1, 2, 0, 1],
  [3, 3, 2, DW - 3],
];
const DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

const PHASE = {
  focus: { label: "focus", color: "\x1b[38;5;214m" },
  short: { label: "short break", color: "\x1b[38;5;114m" },
  long: { label: "long break", color: "\x1b[38;5;111m" },
};
const DIM = "\x1b[38;5;240m";
const RESET = "\x1b[0m";

function readFlag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return null;
  return process.argv[i + 1];
}

function minutesFlag(name, fallbackMin) {
  const raw = readFlag(name);
  if (raw == null) return fallbackMin * 60;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 180) {
    console.error(`${name} must be a whole number of minutes from 1 to 180`);
    process.exit(1);
  }
  return n * 60;
}

function roundsFlag() {
  const raw = readFlag("--rounds");
  if (raw == null) return 4;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    console.error("--rounds must be a whole number from 1 to 12");
    process.exit(1);
  }
  return n;
}

function help() {
  console.log(`clockfocus — terminal pomodoro

  npm start
  node pomodoro.js --focus 25 --short 5 --long 15 --rounds 4

  space     start / pause
  n         next phase
  r         restart phase
  q         quit
`);
}

function chime() {
  process.stdout.write("\x07");
  if (process.platform === "darwin") {
    const child = spawn("afplay", ["/System/Library/Sounds/Glass.aiff"], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
  }
}

function makeGrid(cols, rows) {
  return Array.from({ length: rows }, () => Array(cols).fill(" "));
}

function put(grid, x, y, ch) {
  if (y < 0 || x < 0 || y >= grid.length || x >= grid[0].length) return;
  grid[y][x] = ch;
}

function putText(grid, x, y, text) {
  for (let i = 0; i < text.length; i++) put(grid, x + i, y, text[i]);
}

function centerText(grid, y, text) {
  const cols = grid[0].length;
  const slice = text.slice(0, cols);
  putText(grid, Math.max(0, Math.floor((cols - slice.length) / 2)), y, slice);
}

function drawDigit(grid, x, y, n) {
  const mask = n < 0 || n > 9 ? 0 : DIGITS[n];
  SEGS.forEach(([r0, r1, c0, c1], s) => {
    const ch = (mask >> s) & 1 ? "█" : "░";
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) put(grid, x + c, y + r, ch);
    }
  });
}

function drawColon(grid, x, y, on) {
  const ch = on ? "█" : "░";
  for (const r of [2, 4]) {
    put(grid, x, y + r, ch);
    put(grid, x + 1, y + r, ch);
  }
}

function groupsOf(seconds) {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return h > 0 ? [h, m, s] : [m, s];
}

function clockWidth(groups) {
  return groups * (2 * DW + 2) + (groups - 1) * 6;
}

function fmt(seconds) {
  const g = groupsOf(seconds);
  return g.map((n) => String(n).padStart(2, "0")).join(":");
}

function paint(grid, phaseColor) {
  return grid
    .map((row) => {
      let line = "";
      let open = "";
      for (const ch of row) {
        const next = ch === "█" ? phaseColor : ch === "░" ? DIM : "";
        if (next !== open) {
          line += RESET + next;
          open = next;
        }
        line += ch;
      }
      return line + RESET;
    })
    .join("\n");
}

function render(state) {
  const { cols, rows, phase, remaining, total, paused, started, completed, rounds, colonOn } = state;
  const grid = makeGrid(cols, rows);
  const info = PHASE[phase];
  const groups = groupsOf(remaining);
  const top = Math.max(0, Math.floor((rows - (DH + 4)) / 2));
  let x = Math.floor((cols - clockWidth(groups.length)) / 2);

  groups.forEach((value, i) => {
    if (i) {
      drawColon(grid, x + 2, top, colonOn);
      x += 6;
    }
    drawDigit(grid, x, top, Math.floor(value / 10));
    drawDigit(grid, x + DW + 2, top, value % 10);
    x += 2 * DW + 2;
  });

  const barW = Math.min(28, Math.max(8, cols - 4));
  const filled = total > 0 ? Math.round(barW * (1 - remaining / total)) : 0;
  const barX = Math.floor((cols - barW) / 2);
  for (let i = 0; i < barW; i++) put(grid, barX + i, top + DH + 1, i < filled ? "█" : "░");

  const slot = (completed % rounds) + 1;
  const status = !started
    ? "ready"
    : paused
      ? `paused  ·  ${info.label}  ·  ${fmt(remaining)}  ·  ${slot} of ${rounds}`
      : `${info.label}  ·  ${fmt(remaining)}  ·  pomodoro ${slot} of ${rounds}`;
  centerText(grid, top + DH + 3, status);

  const hint = !started
    ? cols >= 36
      ? "space start     q quit"
      : "space  q"
    : cols >= 62
      ? "space pause     n next     r restart     q quit"
      : "sp  n  r  q";
  centerText(grid, Math.min(rows - 1, top + DH + 4), hint);

  return paint(grid, info.color);
}

function finishPhase(state, lens) {
  if (state.phase === "focus") {
    state.completed += 1;
    if (state.completed % state.rounds === 0) {
      state.phase = "long";
      state.total = lens.long;
    } else {
      state.phase = "short";
      state.total = lens.short;
    }
  } else {
    state.phase = "focus";
    state.total = lens.focus;
  }
  state.remaining = state.total;
  state.acc = 0;
  chime();
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    help();
    return;
  }

  const lens = {
    focus: minutesFlag("--focus", 25),
    short: minutesFlag("--short", 5),
    long: minutesFlag("--long", 15),
  };
  const rounds = roundsFlag();
  const state = {
    phase: "focus",
    remaining: lens.focus,
    total: lens.focus,
    paused: true,
    started: false,
    completed: 0,
    rounds,
    acc: 0,
  };

  if (process.argv.includes("--preview")) {
    const frame = render({
      cols: 80,
      rows: 24,
      ...state,
      paused: false,
      started: true,
      remaining: 25 * 60,
      colonOn: true,
    });
    if (!frame.includes("█") || !frame.includes("focus")) {
      console.error("preview failed");
      process.exit(1);
    }
    process.stdout.write(frame + "\n");
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("clockfocus needs an interactive terminal. Try: npm start");
    process.exit(1);
  }

  const stdin = process.stdin;
  const stdout = process.stdout;
  let last = Date.now();
  let timer = null;

  const cleanup = (code) => {
    if (timer) clearInterval(timer);
    stdout.write("\x1b[?25h\x1b[?1049l");
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
    process.exit(code);
  };

  const draw = () => {
    const colonOn = state.started && !state.paused && Math.floor(Date.now() / 500) % 2 === 0;
    const frame = render({
      cols: stdout.columns || 80,
      rows: stdout.rows || 24,
      ...state,
      colonOn,
    });
    stdout.write("\x1b[H" + frame + "\x1b[J");
  };

  stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  stdin.on("data", (key) => {
    if (key === "q" || key === "Q" || key === "\u0003" || key === "\u001b") cleanup(0);
    if (key === " ") {
      if (!state.started) state.started = true;
      state.paused = !state.paused;
      if (!state.paused) last = Date.now();
    } else if ((key === "n" || key === "N" || key === "s" || key === "S") && state.started) {
      finishPhase(state, lens);
      state.paused = false;
      last = Date.now();
    } else if (key === "r" || key === "R") {
      state.remaining = state.total;
      state.acc = 0;
      last = Date.now();
    }
    draw();
  });

  process.on("SIGWINCH", draw);
  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));

  timer = setInterval(() => {
    const now = Date.now();
    const dt = now - last;
    last = now;
    if (state.started && !state.paused) {
      state.acc += dt;
      while (state.acc >= 1000) {
        state.acc -= 1000;
        state.remaining -= 1;
        if (state.remaining <= 0) {
          finishPhase(state, lens);
          break;
        }
      }
    }
    draw();
  }, 100);

  draw();
}

main();
