// The full-terminal intro: a small robot in the colour of the model that is about to work.
import { visibleLength } from './text.js';

// Each letter is one pixel (drawn two characters wide). # body, o eye, a antenna, . nothing.
const ROBOT = [
  '.....a.....',
  '.....a.....',
  '..#######..',
  '.#########.',
  '.#oo###oo#.',
  '.#oo###oo#.',
  '.#########.',
  '..#######..',
  '.....#.....',
  '.#########.',
  '##.#####.##',
  '##.#####.##',
  '...#...#...',
];

// The DeepSeek whale as a silhouette (# = ink), made from the logo once and drawn with half-block characters.
const WHALE_BIG = [
  '.............................................##...................',
  '..............................#####..........##...................',
  '...........................########.........###...................',
  '...............###################..........####..................',
  '...........######################...........#####...............##',
  '.........########################...........#######............###',
  '........#########################...........########..........####',
  '.......###########################..........#########...##########',
  '......#############################.........##########.###########',
  '.....################################.......#####################.',
  '....##################################.......####################.',
  '...####################################......####################.',
  '...#####################################......##################..',
  '..#######################################......################...',
  '..########################################.....###############....',
  '.##########################################......############.....',
  '.###########################################.....##########.......',
  '.############################################....#######..........',
  '#####.......##################################...######...........',
  '#####..........#########################################..........',
  '#####............##################...#################...........',
  '#####..............################.....###############...........',
  '#####................################....##############...........',
  '#####.................################...##############...........',
  '#####..................############.##....#############...........',
  '#####...................##############.....###########............',
  '######...................#############.....###########............',
  '######....................############......##########............',
  '######.....................#############...###########............',
  '.######.....................#########################.............',
  '.######......................########################.............',
  '.#######.....................#######################..............',
  '..######......................######################..............',
  '..#######......................####################...............',
  '..#######......................####################...............',
  '...#######......................##################................',
  '...########...........#..........################.................',
  '....########.........####........###############..................',
  '.....########........######.......##############..................',
  '.....#########........######.......############...................',
  '......#########.......########......###########...................',
  '.......##########......########......############.................',
  '........###########...##########......##############..............',
  '.........#########################.....#############..............',
  '..........##########################################..............',
  '............############################...########...............',
  '.............##########################...........................',
  '...............######################.............................',
  '.................##################...............................',
  '....................############..................................',
];
const WHALE_SMALL = [
  '.......................#..........',
  '.............#####.....##.........',
  '.....############......###.......#',
  '....#############......####....###',
  '...###############.....###########',
  '..##################...###########',
  '.####################...#########.',
  '.####################...########..',
  '######################...######...',
  '###..###################.####.....',
  '##.......####################.....',
  '##........#########..#######......',
  '###.........########.#######......',
  '###..........#######..######......',
  '###...........######..######......',
  '####..........#############.......',
  '.###...........############.......',
  '.####...........##########........',
  '.####...........##########........',
  '..####.....##....########.........',
  '...####....####...######..........',
  '....#####...####...######.........',
  '.....############...#######.......',
  '......#####################.......',
  '.......#############..............',
  '.........#########................',
];

const TINTS = {
  deepseek: [77, 124, 255], gemini: [168, 120, 255], chatgpt: [16, 190, 140], claude: [232, 130, 70], qwen: [140, 90, 230],
  mistral: [250, 170, 40], grok: [240, 240, 240], kimi: [70, 140, 255], api: [150, 155, 165], local: [150, 155, 165], mock: [150, 155, 165],
};
export const tintFor = (model) => TINTS[String(model ?? '').toLowerCase().replace(/-web$/, '')] ?? [150, 160, 255];

export const MIN_COLS = 60, MIN_ROWS = 20;
export const splashFits = (cols, rows) => cols >= MIN_COLS && rows >= MIN_ROWS;

const fg = (rgb, text, on) => (on ? `\x1b[38;2;${rgb.join(';')}m${text}\x1b[0m` : text);

/** A silhouette as text rows, two bitmap rows per terminal row (▀ ▄ █). */
function halfBlocks(bitmap, tint, colors) {
  const out = [];
  for (let y = 0; y < bitmap.length; y += 2) {
    let line = '';
    for (let x = 0; x < bitmap[y].length; x++) {
      const top = bitmap[y][x] === '#', bottom = (bitmap[y + 1]?.[x] ?? '.') === '#';
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    out.push(fg(tint, line.replace(/\s+$/, ''), colors));
  }
  return out;
}

const LETTERS = {
  E: ['#####', '#....', '####.', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#'],
};
/** "EON" in big block letters: each pixel is two columns wide, two bitmap rows share one text row. */
function wordmark() {
  const rows = Array.from({ length: 6 }, (_, y) => [...'EON'].map((c) => [...LETTERS[c][y]].map((v) => (v === '#' ? '##' : '..')).join('')).join('....'));
  return rows;
}
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** The whole screen as exactly `rows` lines, none wider than `cols`. */
export function renderSplash({ cols, rows, model = 'deepseek', colors = true }) {
  const tint = tintFor(model), light = lerp(tint, [255, 255, 255], 0.35), deep = lerp(tint, [0, 0, 0], 0.35);
  const isWhale = /^deepseek/i.test(String(model));
  // The whale needs about 36 rows with its text under it; on shorter terminals the small one is used.
  const whale = rows >= 38 && cols >= 76 ? WHALE_BIG : WHALE_SMALL;
  const px = (ch) => (ch === '#' ? fg(tint, '██', colors) : ch === 'o' ? (colors ? fg([255, 255, 255], '██', true) : '  ') : ch === 'a' ? fg(light, '██', colors) : '  ');
  // A vertical gradient: lighter at the top, deeper at the bottom, like light on water.
  let art;
  if (isWhale) {
    const flat = halfBlocks(whale, tint, false);
    art = flat.map((line, i) => fg(lerp(light, deep, i / Math.max(1, flat.length - 1)), line, colors));
  } else art = ROBOT.map((r) => [...r].map(px).join(''));
  const roomForMark = rows >= art.length + 6;
  const mark = roomForMark ? halfBlocks(wordmark(), tint, false).map((line, i, all) => fg(lerp(light, tint, i / Math.max(1, all.length - 1)), line, colors)) : [colors ? `\x1b[1m${fg(tint, 'E  O  N', true)}\x1b[0m` : 'E  O  N'];
  const center = (line) => ' '.repeat(Math.max(0, Math.floor((cols - visibleLength(line)) / 2))) + line;
  // Pictures are centred as one block (their lines differ in length).
  const block = (lines) => { const w = Math.max(...lines.map(visibleLength)), left = ' '.repeat(Math.max(0, Math.floor((cols - w) / 2))); return lines.map((l) => left + l); };
  const placed = [...block(art), '', ...(roomForMark ? block(mark) : mark.map(center))];
  const top = Math.max(0, Math.floor((rows - placed.length) / 2));
  const out = [...Array(top).fill(''), ...placed].slice(0, rows);
  while (out.length < rows) out.push('');
  return out;
}

/** Show the intro on the alternate screen until a key is pressed or the time is up. Never throws. */
export async function showSplash({ stdin = process.stdin, stdout = process.stdout, model, ms = 1000, colors = true } = {}) {
  const cols = stdout.columns ?? 0, rows = stdout.rows ?? 0;
  if (!stdout.isTTY || !stdin.isTTY || !splashFits(cols, rows)) return false;
  try {
    stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');
    const lines = renderSplash({ cols, rows, model, colors });
    stdin.setRawMode?.(true);
    stdin.resume();
    let key = false;
    const onKey = () => { key = true; };
    stdin.once('data', onKey);
    // The picture is drawn from the top down in a few quick steps, then held.
    const steps = 8, first = lines.findIndex((l) => l.trim()), last = lines.length - [...lines].reverse().findIndex((l) => l.trim());
    for (let k = 1; k <= steps && !key; k++) {
      stdout.write(`\x1b[H${lines.map((l, i) => (i < first + Math.ceil(((last - first) * k) / steps) ? l : '')).join('\r\n')}`);
      await new Promise((r) => setTimeout(r, 40));
    }
    stdout.write(`\x1b[H${lines.join('\r\n')}`);
    if (!key) await new Promise((resolve) => {
      const done = () => { clearTimeout(timer); stdin.off('data', done); resolve(); };
      const timer = setTimeout(done, ms);
      stdin.once('data', done);
    });
    stdin.off('data', onKey);
    stdin.setRawMode?.(false);
    stdin.pause();
  } finally {
    stdout.write('\x1b[?25h\x1b[?1049l');
  }
  return true;
}
