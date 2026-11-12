'use strict';
// Static game data: map, stations, items, careers. Tile units everywhere.

// Town layout is built around the sprite atlas (public/assets/atlas.json, 48 px per tile):
// buildings are front-facing sprites standing on solid footprints, doors face the street below.
const ATLAS = require('../public/assets/atlas.json');
const SPR = name => { const s = ATLAS.sprites[name]; return { w: s[2] / ATLAS.tile, h: s[3] / ATLAS.tile }; };
const TW = 64, H = 56, W = 142;           // town 64x56; interiors live at x >= 66

// ---------------------------------------------------------------- map
// tile codes: . grass  = road  , sidewalk  w water  p pier  B building  T tree  o solid prop
//             f soil   s sand  k plaza bricks  m meadow
const grid = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => x < TW ? '.' : ' '));
const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y][x] = c; };
const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c); };
const get = (x, y) => (grid[y] || [])[x];

// streets: three east-west roads (buildings face them from the north) + a north-south avenue
const ROWS = [9, 21, 33];                 // y of the sidewalk in front of each building row
for (const y of ROWS) { rect(1, y, TW - 2, 1, ','); rect(1, y + 1, TW - 2, 2, '='); rect(1, y + 3, TW - 2, 1, ','); }
rect(28, 1, 1, H - 2, ','); rect(31, 1, 1, H - 2, ','); rect(29, 1, 2, H - 2, '=');

// south: farm (west), park (centre), lake with a pier (east)
rect(2, 39, 25, 13, 'm');
rect(33, 38, 7, 16, 'k');
rect(41, 41, 22, 14, 'w');
for (let y = 38; y < H - 1; y++) for (let x = 39; x < TW - 1; x++) if (get(x, y) === '.' || get(x, y) === 'k') {
  if ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2]].some(([dx, dy]) => get(x + dx, y + dy) === 'w')) set(x, y, 's');
}
rect(38, 46, 12, 2, 'p');

// ---------------------------------------------------------------- buildings
const B = (id, sprite, x, row, extra = {}) => {
  const sp = SPR(sprite), w = Math.ceil(sp.w - 0.05), h = Math.max(2, Math.round(sp.h - 0.4));
  return { id, sprite, x, y: ROWS[row] - h, w, h, ...extra };
};
const BUILDINGS = [
  B('toolshop', 'b_shop', 2, 0, { label: 'ร้านอุปกรณ์', icon: '🛠️', st: 'toolshop' }),
  B('dealer', 'b_dealer', 9, 0, { label: 'โชว์รูมรถ', icon: '🚗', st: 'dealer' }),
  B('office', 'b_office', 19, 0, { label: 'บริษัท', icon: '🏢', st: 'office' }),
  B('market', 'b_mart', 33, 0, { label: 'ตลาดกลาง', icon: '🏪', st: 'market' }),
  B('police', 'b_police', 41, 0, { label: 'สถานีตำรวจ', icon: '👮', deco: true }),
  B('fire', 'b_fire', 49, 0, { label: 'สถานีดับเพลิง', icon: '🚒', deco: true }),
  B('warehouse', 'b_warehouse', 2, 1, { label: 'คลังสินค้า', icon: '📦', st: 'warehouse' }),
  B('studio', 'b_studio', 10, 1, { label: 'สตูดิโอ', icon: '🎥', st: 'studio' }),
  B('home', 'b_inn', 19, 1, { label: 'บ้านพัก', icon: '🏠', st: 'home' }),
  B('restaurant', 'b_cafe', 33, 1, { label: 'ร้านอาหาร', icon: '🍜', st: 'restaurant' }),
  B('kitchen', 'b_bakery', 40, 1, { label: 'ครัวใหญ่', icon: '🍳', st: 'kitchen' }),
  B('hospital', 'b_hospital', 47, 1, { label: 'โรงพยาบาล', icon: '🏥', st: 'hospital' }),
  B('flower', 'b_flower', 57, 1, { label: 'ร้านดอกไม้', icon: '💐', deco: true }),
  B('school', 'b_school', 2, 2, { label: 'โรงเรียน', icon: '🎓', st: 'school' }),
  B('cowork', 'b_cowork', 11, 2, { label: 'โค้ดดิ้งสเปซ', icon: '💻', st: 'cowork' }),
  B('bank', 'b_bank', 20, 2, { label: 'ธนาคาร', icon: '🏦', st: 'bank' }),
];
const HOUSE_SPRITES = ['h_cottage1', 'h_gable_red', 'h_cottage3', 'h_cottage2', 'h_gable_blue', 'h_cottage4'];
HOUSE_SPRITES.forEach((sp, i) => BUILDINGS.push(B('house' + i, sp, 33 + i * 5, 2, { label: 'บ้าน', icon: '🏠', st: 'house' + i, house: i })));
const barn = { id: 'barn', sprite: 'b_barn', x: 3, y: 47, w: 4, h: 3, label: 'โรงนา', icon: '🐄', deco: true };
BUILDINGS.push(barn);
BUILDINGS.forEach(b => rect(b.x, b.y, b.w, b.h, 'B'));

// ---------------------------------------------------------------- stations
const STATIONS = [];
// farm: 12 plots (2x2 soil) in two rows
let plotIdx = 0;
for (const py of [41, 44]) for (const px of [8, 11, 14, 17, 20, 23]) {
  rect(px, py, 2, 2, 'f');
  STATIONS.push({ id: 'plot' + plotIdx, type: 'plot', idx: plotIdx, label: 'แปลงเกษตร', icon: '🌱', x: px + 1, y: py + 1, r: 1.5 });
  plotIdx++;
}
const DOOR_LABELS = { office: 'บริษัท ไทยเทค', warehouse: 'คลังสินค้าราคาส่ง', studio: 'สตูดิโอสตรีม', kitchen: 'ครัวใหญ่ (เชฟ)' };
for (const b of BUILDINGS) {
  if (!b.st) continue;
  const x = b.x + b.w / 2, y = b.y + b.h + 0.6;          // just in front of the door, on the sidewalk
  if (b.house !== undefined) STATIONS.push({ id: b.st, type: 'house', idx: b.house, label: 'บ้าน', icon: '🏠', x, y, r: 1.6 });
  else STATIONS.push({ id: b.st, type: b.st, label: DOOR_LABELS[b.st] || b.label, icon: b.icon, x, y, r: 1.8 });
}
STATIONS.push({ id: 'pier1', type: 'pier', label: 'ท่าเรือตกปลา', icon: '🎣', x: 44, y: 47, r: 3 });
STATIONS.push({ id: 'pier2', type: 'pier', label: 'ท่าเรือตกปลา', icon: '🎣', x: 48.5, y: 47, r: 3 });

// ---------------------------------------------------------------- props (decoration sprites)
// x, y = bottom-centre in tiles; solid props block the tile under their base
const PROPS = [];
const prop = (s, x, y, solid = true) => { PROPS.push({ s, x, y }); if (solid) set(Math.floor(x), Math.floor(y - 0.5), 'o'); };
// street lamps and bins along every sidewalk
for (const y of ROWS) for (let x = 4; x < TW - 3; x += 9) if (x < 27 || x > 32) {
  if (get(x, y + 3) === ',') prop(x % 2 ? 'lamp' : 'lamp2', x + 0.5, y + 4);
}
prop('busstop', 26, 13); prop('bench', 36.5, 13.9, false); prop('trafficlight', 27.6, 9.95);
prop('trafficlight', 32.4, 24.95); prop('vending', 26.6, 21.9); prop('bin_blue', 7, 21.95); prop('postbox', 10, 33.95);
prop('hydrant', 46.5, 9.95); prop('phonebooth', 39.5, 9.95);
prop('stall_red', 35, 14.9); prop('stall_green', 39, 14.9); prop('stall_blue', 43, 14.9); prop('stall_orange', 47, 14.9);
prop('car_red', 16.5, 10.95); prop('car_blue', 7.5, 10.95); prop('taxi', 56.5, 22.95); prop('car_yellow', 57.5, 34.95);
prop('foodtruck', 36.5, 53.3);
// park
prop('fountain', 36.5, 42); prop('gazebo', 36.5, 50.5); prop('bench', 34, 45.5, false); prop('bench2', 39, 45.5, false);
prop('flowerbed', 34, 39.4); prop('flowerbed2', 39, 39.4); prop('lamp3', 33.5, 47.5); prop('lamp3', 33.5, 52.5);
prop('parasol', 44, 39.2); prop('picnic', 48, 39.1); prop('icecream', 53, 39.4);
// farm
prop('fence_wood', 3.5, 39); prop('fence_wood', 6.5, 39); for (let x = 9.5; x < 26; x += 3) prop('fence_wood', x, 39);
prop('well', 4, 44.2); prop('hay', 25.5, 50.5); prop('hay2', 23.5, 50.5); prop('cart', 19, 50.6); prop('planter_crops', 12, 50.4);
prop('scarecrow' in ATLAS.sprites ? 'scarecrow' : 'signpost', 26, 45);
// gardens and pets around the houses
for (let i = 0; i < 6; i++) prop(i % 2 ? 'flowerbed' : 'hedge', 35 + i * 5, 37.6, false);
prop('doghouse', 61.5, 37.9); prop('dog', 60, 38.5, false); prop('cat', 47.6, 33.8, false);
// school yard & misc
prop('flowerbox', 9.5, 21.95, false); prop('flowerbox2', 25.5, 33.95, false); prop('easel', 23.6, 9.95);
prop('noticeboard', 18, 33.95); prop('kiosk', 53.5, 14.9);

// trees: rows along the edges + scatter on free grass
for (let x = 2; x < TW - 2; x += 3) { if (get(x, 2) === '.' && get(x, 1) === '.') { set(x, 1, 'T'); } }
const TREE_KINDS = ['tree', 'tree', 'pine', 'tree_orange', 'tree_pink', 'tree'];
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20240607);
for (let i = 0; i < 260; i++) {
  const x = 1 + Math.floor(rand() * (TW - 2)), y = 2 + Math.floor(rand() * (H - 3));
  if (get(x, y) !== '.') continue;
  let ok = true;
  for (let j = -3; j <= 1 && ok; j++) for (let k = -2; k <= 2; k++) { const c = get(x + k, y + j); if (c && c !== '.' && c !== 'T') { ok = false; break; } }
  if (ok && !STATIONS.some(s => Math.hypot(s.x - x - .5, s.y - y - .5) < 3) && !PROPS.some(p => Math.hypot(p.x - x - .5, p.y - y - .5) < 2.5)) set(x, y, 'T');
}
for (let x = 0; x < TW; x++) { set(x, 0, 'T'); set(x, H - 1, 'T'); }
for (let y = 0; y < H; y++) { set(0, y, 'T'); set(TW - 1, y, 'T'); }
// which sprite each tree tile uses (stable per position)
const TREES = [];
for (let y = 0; y < H; y++) for (let x = 0; x < TW; x++) if (grid[y][x] === 'T') {
  const near = (x < 2 || x > TW - 3 || y < 1 || y > H - 2);
  TREES.push([x, y, near && (x + y) % 3 === 0 ? 'pine' : TREE_KINDS[(x * 7 + y * 13) % TREE_KINDS.length]]);
}

// ---------------------------------------------------------------- interiors
// Every usable building gets a room (14x10) right of the town. Its counter moves
// inside; outside becomes a door that teleports you in. Tiles: # wall, i floor, D exit.
const ROOMS = [];
const RW = 14, RH = 10;
let slot = 0;
for (const b of BUILDINGS) {
  if (!b.st) continue;
  const s = STATIONS.find(x => x.id === b.st);
  const rx = TW + 2 + (slot % 5) * 15, ry = 1 + Math.floor(slot / 5) * 11; slot++;
  rect(rx, ry, RW, RH, '#'); rect(rx + 1, ry + 1, RW - 2, RH - 2, 'i'); rect(rx + 6, ry + RH - 1, 2, 1, 'D');
  const room = {
    id: 'r_' + b.id, bld: b.id, kind: b.house !== undefined ? 'house' : b.id, house: b.house, label: b.label, icon: b.icon, color: b.color,
    x: rx, y: ry, w: RW, h: RH, spawn: { x: rx + 7, y: ry + RH - 2.3 }, exit: { x: rx + 7, y: ry + RH - 0.5 },
    outside: { x: s.x, y: b.y + b.h + 1.7 }, doorPt: { x: s.x, y: b.y + b.h + 0.32 },
  };
  ROOMS.push(room); b.room = room.id;
  STATIONS.push({ id: 'exit_' + b.id, type: 'exit', room: room.id, label: 'ออกนอกอาคาร', icon: '🚪', x: rx + 7, y: ry + RH - 1.6, r: 1.2 });
  if (b.house !== undefined) {          // house: outside sign stays (buy/furnish/enter), a bed inside
    s.door = room.id;
    STATIONS.push({ id: 'hbed' + b.house, type: 'hbed', idx: b.house, room: room.id, label: 'เตียงนอน', icon: '🛏️', x: rx + 3, y: ry + 2.6, r: 1.6 });
    continue;
  }
  STATIONS.push({ id: 'door_' + b.id, type: 'door', to: room.id, label: b.label, icon: b.icon, x: s.x, y: s.y, r: 1.8 });
  s.room = room.id;
  if (b.id === 'hospital') {
    s.x = rx + 3.5; s.y = ry + 2.6;
    [[9, 2.6], [11.5, 2.6], [9, 6], [11.5, 6]].forEach(([dx, dy], i) =>
      STATIONS.push({ id: 'bed' + i, type: 'bed', idx: i, room: room.id, label: 'เตียงคนไข้', icon: '🛏️', x: rx + dx, y: ry + dy, r: 1.4 }));
  } else { s.x = rx + 7; s.y = ry + 2.6; s.r = 2.2; }
}
const roomAt = (x, y) => ROOMS.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;

const TILES = grid.map(r => r.join(''));
const SOLID = new Set(['w', 'B', 'T', '#', ' ', 'o']);
const isSolidTile = (tx, ty) => tx < 0 || ty < 0 || tx >= W || ty >= H || SOLID.has(grid[ty][tx]);
const RADIUS = 0.3;
function blocked(x, y) {
  return isSolidTile(Math.floor(x - RADIUS), Math.floor(y - RADIUS)) ||
         isSolidTile(Math.floor(x + RADIUS), Math.floor(y - RADIUS)) ||
         isSolidTile(Math.floor(x - RADIUS), Math.floor(y + RADIUS)) ||
         isSolidTile(Math.floor(x + RADIUS), Math.floor(y + RADIUS));
}
const SPAWN = { x: 30.0, y: 16.5 };

// ---------------------------------------------------------------- items
// kind: crop | fish | meal | goods.  base = reference sell price at the market.
const ITEMS = {
  rice:   { name: 'ข้าว', icon: '🌾', kind: 'crop', base: 40 },
  corn:   { name: 'ข้าวโพด', icon: '🌽', kind: 'crop', base: 70, eat: { hunger: 8 } },
  chili:  { name: 'พริก', icon: '🌶️', kind: 'crop', base: 100 },
  durian: { name: 'ทุเรียน', icon: '🍈', kind: 'crop', base: 320, eat: { hunger: 20, energy: 5 } },

  sfish:  { name: 'ปลาเล็ก', icon: '🐟', kind: 'fish', base: 45 },
  tilapia:{ name: 'ปลานิล', icon: '🐠', kind: 'fish', base: 120 },
  seabass:{ name: 'ปลากะพง', icon: '🐡', kind: 'fish', base: 300 },
  tuna:   { name: 'ทูน่า', icon: '🐋', kind: 'fish', base: 800 },
  shark:  { name: 'ฉลาม', icon: '🦈', kind: 'fish', base: 2400 },
  chest:  { name: 'หีบสมบัติ', icon: '💎', kind: 'fish', base: 8000 },

  fried_rice:   { name: 'ข้าวผัด', icon: '🍚', kind: 'meal', base: 240, eat: { hunger: 35, energy: 5 } },
  corn_soup:    { name: 'ซุปข้าวโพด', icon: '🥣', kind: 'meal', base: 540, eat: { hunger: 30, energy: 8 } },
  grilled_fish: { name: 'ปลาเผา', icon: '🍤', kind: 'meal', base: 440, eat: { hunger: 45, energy: 10 } },
  tomyum:       { name: 'ต้มยำ', icon: '🍲', kind: 'meal', base: 870, eat: { hunger: 50, energy: 15 } },
  durian_sweet: { name: 'ทุเรียนเชื่อม', icon: '🍨', kind: 'meal', base: 1080, eat: { hunger: 30, energy: 25, health: 5 } },

  snack:  { name: 'ขนม', icon: '🍪', kind: 'goods', base: 40, eat: { hunger: 10 }, wholesale: 30, stock: 80, refill: 8 },
  drink:  { name: 'เครื่องดื่มชูกำลัง', icon: '🥤', kind: 'goods', base: 250, eat: { energy: 25 }, wholesale: 190, stock: 12, refill: 25 },
  medkit: { name: 'ชุดปฐมพยาบาล', icon: '🩹', kind: 'goods', base: 400, eat: { health: 35 }, wholesale: 310, stock: 10, refill: 40 },
};

const CROPS = {
  rice:   { seed: 20,  grow: 40,  min: 4, max: 6 },
  corn:   { seed: 45,  grow: 80,  min: 4, max: 5 },
  chili:  { seed: 70,  grow: 120, min: 4, max: 5 },
  durian: { seed: 350, grow: 240, min: 3, max: 4 },
};

const RECIPES = [
  { id: 'fried_rice',   in: { rice: 2 } },
  { id: 'corn_soup',    in: { corn: 2, rice: 1 } },
  { id: 'grilled_fish', in: { sfish: 1, chili: 1 } },
  { id: 'tomyum',       in: { tilapia: 1, chili: 1, corn: 1 } },
  { id: 'durian_sweet', in: { durian: 1, rice: 1 } },
];

// id, normal weight, with-event weight
const FISH = [
  { id: null,      w: 20 },
  { id: 'sfish',    w: 38 },
  { id: 'tilapia',  w: 24 },
  { id: 'seabass',  w: 11 },
  { id: 'tuna',     w: 4.5 },
  { id: 'shark',    w: 1.2 },
  { id: 'chest',    w: 0.3 },
];

const CAREERS = {
  office:     { name: 'พนักงานออฟฟิศ', icon: '👔', license: null, desc: 'ทำงานที่บริษัท เงินเดือนมั่นคง เลื่อนตำแหน่งได้' },
  farmer:     { name: 'เกษตรกร', icon: '🌾', license: null, desc: 'ปลูกพืชที่แปลงกลางเมือง รอโต แล้วเก็บเกี่ยว (ระวังคนอื่นมาเก็บตัดหน้า!)' },
  fisher:     { name: 'ชาวประมง', icon: '🎣', license: null, desc: 'ตกปลาที่ท่าเรือ จับจังหวะให้ทัน ลุ้นปลาใหญ่และหีบสมบัติ' },
  merchant:   { name: 'พ่อค้า', icon: '🛒', license: null, desc: 'ซื้อของราคาส่งจากคลัง ขายต่อให้ผู้เล่นในราคาที่ตั้งเอง' },
  streamer:   { name: 'สตรีมเมอร์', icon: '🎥', license: null, desc: 'ไลฟ์ที่สตูดิโอ สะสมแฟนคลับ มีรายได้แฝง และรับโดเนท' },
  programmer: { name: 'โปรแกรมเมอร์', icon: '💻', license: 'coding', desc: 'รับงานโค้ดที่โค้ดดิ้งสเปซ ตอบถูกได้ค่าจ้างก้อนโต' },
  chef:       { name: 'เชฟ', icon: '🍳', license: 'cooking', desc: 'ซื้อวัตถุดิบจากชาวไร่ชาวประมง ปรุงอาหารขายแพงกว่าหลายเท่า' },
  doctor:     { name: 'แพทย์', icon: '🩺', license: 'medicine', desc: 'รักษาคนไข้ที่นอนรอบนเตียงในโรงพยาบาล ต้องดูอาการแล้ววินิจฉัยโรคให้ถูก หรือเข้าเวรรับค่าตอบแทน' },
};

const LICENSES = {
  coding:   { name: 'ใบรับรองโปรแกรมเมอร์', icon: '📜', price: 3000 },
  cooking:  { name: 'ใบรับรองเชฟ', icon: '📜', price: 1800 },
  medicine: { name: 'ใบประกอบวิชาชีพแพทย์', icon: '📜', price: 12000 },
};

const OFFICE_TITLES = ['พนักงานฝึกหัด', 'พนักงาน', 'พนักงานอาวุโส', 'หัวหน้าทีม', 'ผู้จัดการ', 'ผู้อำนวยการ', 'CEO'];

const EVENTS = [
  { id: 'festival', text: '🎉 เทศกาลเมือง! ราคาอาหารและสินค้าในตลาดสูงขึ้น 30%' },
  { id: 'drought',  text: '☀️ ภัยแล้ง! พืชโตช้าลง แต่ราคาพืชผลพุ่ง 40%' },
  { id: 'rain',     text: '🌧️ ฝนตกชุก! พืชโตเร็วขึ้นเท่าตัว' },
  { id: 'bloom',    text: '🐟 ปลาชุกชุม! ตกปลาได้ปลาใหญ่บ่อยขึ้น' },
  { id: 'boom',     text: '📈 เศรษฐกิจบูม! เงินเดือนออฟฟิศและค่าเวรหมอ +25%' },
  { id: 'viral',    text: '🔥 โซเชียลคึกคัก! สตรีมมีโอกาสไวรัลสูงขึ้น' },
  { id: 'flu',      text: '🤧 ไข้หวัดระบาด! ทุกคนหิวและป่วยง่ายขึ้น หมอได้ค่าเวร +40%' },
];

// ---------------------------------------------------------------- things to spend money on
const VEHICLES = {
  skate:  { name: 'สเก็ตบอร์ด', icon: '🛹', price: 2500,  speed: 1.2 },
  bike:   { name: 'จักรยาน', icon: '🚲', price: 8000,  speed: 1.4 },
  scooter:{ name: 'มอเตอร์ไซค์', icon: '🛵', price: 25000, speed: 1.7 },
  car:    { name: 'รถยนต์', icon: '🚗', price: 70000, speed: 2.0 },
};
const TOOL_PRICES = [4000, 15000, 45000];
const TOOLS = {
  office:     { name: 'ชุดสูทหรู', icon: '👔', fx: ['เงินเดือน +10%', 'เงินเดือน +22%', 'เงินเดือน +35%'] },
  farmer:     { name: 'จอบ & ปุ๋ย', icon: '🧪', fx: ['ผลผลิต +1, โตเร็วขึ้น 15%', 'ผลผลิต +2, โตเร็วขึ้น 30%', 'ผลผลิต +3, โตเร็วขึ้น 45%'] },
  fisher:     { name: 'เบ็ดตกปลา', icon: '🎣', fx: ['ขยะน้อยลง, ปลาใหญ่บ่อยขึ้น', 'ขยะน้อยมาก, ปลาใหญ่บ่อยขึ้นมาก', 'แทบไม่เจอขยะ, ปลาใหญ่บ่อยสุด'] },
  merchant:   { name: 'รถเข็นสินค้า', icon: '🛒', fx: ['ราคาส่งถูกลง 6%', 'ราคาส่งถูกลง 12%', 'ราคาส่งถูกลง 18%'] },
  streamer:   { name: 'ไมค์ & กล้อง', icon: '🎙️', fx: ['รายได้และแฟน +15%', 'รายได้และแฟน +30%', 'รายได้และแฟน +50%'] },
  programmer: { name: 'คอมสเปคแรง', icon: '⌨️', fx: ['ค่าจ้าง +15%', 'ค่าจ้าง +30%', 'ค่าจ้าง +50%'] },
  chef:       { name: 'ชุดมีดเชฟ', icon: '🔪', fx: ['โอกาสได้อาหารเพิ่ม 20%', 'โอกาสได้อาหารเพิ่ม 40%', 'โอกาสได้อาหารเพิ่ม 60%'] },
  doctor:     { name: 'เครื่องมือแพทย์', icon: '🩺', fx: ['ค่าเวร +15%, รักษาได้มากขึ้น', 'ค่าเวร +30%, รักษาได้มากขึ้น', 'ค่าเวร +50%, รักษาได้มากที่สุด'] },
};
const HOUSE_PRICES = [55000, 50000, 45000, 40000, 35000, 30000];
const FURNITURE = {
  plant:  { name: 'ต้นไม้', icon: '🪴', price: 1500,  comfort: 1 },
  sofa:   { name: 'โซฟา', icon: '🛋️', price: 3000,  comfort: 1 },
  tv:     { name: 'ทีวีจอใหญ่', icon: '📺', price: 6000,  comfort: 2 },
  bed:    { name: 'เตียงนุ่ม', icon: '🛏️', price: 8000,  comfort: 2 },
  aqua:   { name: 'ตู้ปลา', icon: '🐠', price: 12000, comfort: 3 },
  art:    { name: 'ภาพวาด', icon: '🖼️', price: 18000, comfort: 3 },
  piano:  { name: 'เปียโน', icon: '🎹', price: 25000, comfort: 4 },
  jacuzzi:{ name: 'อ่างจากุซซี่', icon: '🛁', price: 40000, comfort: 5 },
};
const BANK = { rate: 0.03, cap: 300000, loanMax: 30000, loanFee: 0.10, repayShare: 0.25 };

// ---------------------------------------------------------------- health
// cure = the treatment a doctor must pick; symptoms are what the doctor sees
const DISEASES = {
  cold:    { name: 'ไข้หวัด', icon: '🤒', cure: 'fever', drain: 0.03, income: 0.8, sym: ['ตัวร้อน มีไข้', 'ไอ จาม น้ำมูกไหล', 'หนาวสั่น'], cause: 'ตากฝนนานๆ หรือช่วงไข้หวัดระบาด', self: 'หายเองไม่ได้ ต้องให้หมอรักษา' },
  exhaust: { name: 'อ่อนเพลียสะสม', icon: '😵', cure: 'iv', regen: 0.5, income: 0.85, sym: ['เหนื่อยง่าย หน้ามืด', 'กล้ามเนื้ออ่อนแรง', 'ใจสั่น'], cause: 'ทำงานตอนพลังงานต่ำ หรือทำโอทีหนัก', self: 'นอนเต็มอิ่ม (ห้องพัก/บ้าน) จะหาย' },
  insomnia:{ name: 'อดนอน', icon: '🥱', cure: 'sleep', income: 0.75, sym: ['ง่วงตลอดเวลา ตาลอย', 'สมาธิสั้น ทำงานพลาด', 'ปวดหัวตื้อๆ'], cause: 'ไม่ได้นอนนานเกิน 25 นาที', self: 'นอนเต็มอิ่ม (ห้องพัก/บ้าน) จะหาย' },
  poison:  { name: 'อาหารเป็นพิษ', icon: '🤢', cure: 'salt', drain: 0.05, hunger: 2, sym: ['ปวดท้อง คลื่นไส้', 'ท้องเสีย', 'อาเจียน'], cause: 'กินอาหารข้างทางหรือของดิบ', self: 'หายเองไม่ได้ ต้องให้หมอรักษา' },
  injury:  { name: 'บาดเจ็บ', icon: '🤕', cure: 'bandage', speed: 0.7, sym: ['ปวดบวม มีแผล', 'เดินกะเผลก', 'ช้ำตามตัว'], cause: 'อุบัติเหตุระหว่างทำงานหนัก', self: 'ใช้ชุดปฐมพยาบาล หรือให้หมอรักษา' },
  malnut:  { name: 'ขาดสารอาหาร', icon: '😩', cure: 'iv', drain: 0.04, income: 0.8, sym: ['ผอมซีด ไม่มีแรง', 'หิวตลอดเวลา', 'เวียนหัว'], cause: 'ปล่อยให้หิวจนหมดหลอดนานๆ', self: 'กินจนอิ่มเกิน 80 จะหาย' },
};
const TREATMENTS = {
  fever:   { name: 'ยาลดไข้ + ให้พักผ่อน', icon: '💊' },
  iv:      { name: 'ให้น้ำเกลือ + วิตามิน', icon: '💉' },
  sleep:   { name: 'ยานอนหลับ + นอนพักฟื้น', icon: '😴' },
  salt:    { name: 'ผงเกลือแร่ + ยาฆ่าเชื้อ', icon: '🧂' },
  bandage: { name: 'ทำแผล + เข้าเฝือก', icon: '🩹' },
};

module.exports = {
  PROPS, TREES, TW, ROOMS, roomAt, DISEASES, TREATMENTS,
  VEHICLES, TOOLS, TOOL_PRICES, HOUSE_PRICES, FURNITURE, BANK,
  W, H, TILES, BUILDINGS, STATIONS, SPAWN, blocked, ITEMS, CROPS, RECIPES, FISH,
  CAREERS, LICENSES, OFFICE_TITLES, EVENTS, RADIUS,
};
