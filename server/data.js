'use strict';
// Static game data: map, stations, items, careers. Tile units everywhere.

const W = 60, H = 44;

// ---------------------------------------------------------------- map
// tile codes: . grass  = road  , sidewalk  w water  p pier  B building
//             T tree   f soil  s sand
const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y][x] = c; };
const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c); };

// lake + sand shore
rect(34, 31, 26, 13, 'w');
for (let y = 28; y < H; y++) for (let x = 31; x < W; x++) {
  if (grid[y][x] === '.' && x >= 32 && y >= 29) set(x, y, 's');
}
// sidewalks, roads
rect(0, 19, W, 1, ','); rect(0, 22, W, 1, ',');
rect(28, 0, 1, H, ','); rect(31, 0, 1, H, ',');
rect(0, 20, W, 2, '='); rect(29, 0, 2, H, '=');
// pier over the water
rect(32, 36, 13, 2, 'p');
// south-west neighbourhood: houses + bank
rect(1, 32, 28, 1, ','); rect(1, 37, 19, 1, ','); rect(19, 32, 1, 11, ',');

const BUILDINGS = [
  { id: 'office',    x: 33, y: 10, w: 8, h: 8, color: '#5b7c99', label: 'บริษัท', icon: '🏢', st: 'office' },
  { id: 'market',    x: 44, y: 11, w: 9, h: 7, color: '#c0643a', label: 'ตลาดกลาง', icon: '🏪', st: 'market' },
  { id: 'warehouse', x: 20, y: 11, w: 8, h: 7, color: '#8a7a5c', label: 'คลังสินค้า', icon: '📦', st: 'warehouse' },
  { id: 'studio',    x: 3,  y: 13, w: 8, h: 5, color: '#8e5ba8', label: 'สตูดิโอ', icon: '🎥', st: 'studio' },
  { id: 'home',      x: 12, y: 13, w: 7, h: 5, color: '#b0675f', label: 'บ้านพัก', icon: '🏠', st: 'home' },
  { id: 'barn',      x: 21, y: 2,  w: 7, h: 6, color: '#a2563f', label: 'โรงนา', icon: '🐄', deco: true },
  { id: 'dealer',    x: 44, y: 2,  w: 13, h: 7, color: '#5f7d8f', label: 'โชว์รูมรถ', icon: '🚗', st: 'dealer' },
  { id: 'toolshop',  x: 33, y: 2,  w: 8, h: 6, color: '#7a6f9b', label: 'ร้านอุปกรณ์', icon: '🛠️', st: 'toolshop' },
  { id: 'restaurant',x: 33, y: 24, w: 8, h: 7, color: '#d08a3a', label: 'ร้านอาหาร', icon: '🍜', st: 'restaurant' },
  { id: 'kitchen',   x: 44, y: 24, w: 9, h: 7, color: '#c25b5b', label: 'ครัวใหญ่', icon: '🍳', st: 'kitchen' },
  { id: 'hospital',  x: 20, y: 24, w: 8, h: 7, color: '#e4e8ec', label: 'โรงพยาบาล', icon: '🏥', st: 'hospital' },
  { id: 'school',    x: 3,  y: 24, w: 8, h: 7, color: '#4f8f6f', label: 'โรงเรียน', icon: '🎓', st: 'school' },
  { id: 'cowork',    x: 12, y: 24, w: 7, h: 7, color: '#3f6f9f', label: 'โค้ดดิ้งสเปซ', icon: '💻', st: 'cowork' },
  { id: 'bank',      x: 21, y: 33, w: 7, h: 5, color: '#c9a23a', label: 'ธนาคาร', icon: '🏦', st: 'bank' },
];
// houses players can buy (row A faces sidewalk y=32, row B faces y=37)
const HOUSE_LOTS = [[2, 33], [7, 33], [12, 33], [2, 38], [7, 38], [12, 38]];
HOUSE_LOTS.forEach(([x, y], i) => BUILDINGS.push({ id: 'house' + i, x, y, w: 4, h: 3, color: '#9aa4ad', label: 'บ้าน', icon: '🏠', st: 'house' + i, house: i }));
BUILDINGS.forEach(b => rect(b.x, b.y, b.w, b.h, 'B'));

// farm plots (2x2 soil each)
const PLOT_COLS = [3, 7, 11, 15], PLOT_ROWS = [3, 6, 9];
const STATIONS = [];
let plotIdx = 0;
for (const py of PLOT_ROWS) for (const px of PLOT_COLS) {
  rect(px, py, 2, 2, 'f');
  STATIONS.push({ id: 'plot' + plotIdx, type: 'plot', idx: plotIdx, label: 'แปลงเกษตร', icon: '🌱', x: px + 1, y: py + 1, r: 1.7 });
  plotIdx++;
}
const door = (id, type, label, icon, x, y, r = 2.0) => {
  STATIONS.push({ id, type, label, icon, x, y, r });
  rect(Math.floor(x) - 1, Math.floor(y), 3, 1, ',');
};
door('office', 'office', 'บริษัท ไทยเทค', '🏢', 37, 19.5);
door('market', 'market', 'ตลาดกลาง', '🏪', 48.5, 19.5);
door('warehouse', 'warehouse', 'คลังสินค้าราคาส่ง', '📦', 24, 19.5);
door('studio', 'studio', 'สตูดิโอสตรีม', '🎥', 7, 19.5);
door('home', 'home', 'บ้านพัก', '🏠', 15.5, 19.5);
door('restaurant', 'restaurant', 'ร้านอาหาร', '🍜', 37, 23.5);
door('kitchen', 'kitchen', 'ครัวใหญ่ (เชฟ)', '🍳', 48.5, 23.5);
door('hospital', 'hospital', 'โรงพยาบาล', '🏥', 24, 23.5);
door('school', 'school', 'โรงเรียน', '🎓', 7, 23.5);
door('cowork', 'cowork', 'โค้ดดิ้งสเปซ', '💻', 15.5, 23.5);
door('toolshop', 'toolshop', 'ร้านอุปกรณ์', '🛠️', 37, 8.5);
door('dealer', 'dealer', 'โชว์รูมรถ', '🚗', 50.5, 9.5);
door('bank', 'bank', 'ธนาคาร', '🏦', 24.5, 32.5);
HOUSE_LOTS.forEach(([x, y], i) => { STATIONS.push({ id: 'house' + i, type: 'house', idx: i, label: 'บ้าน', icon: '🏠', x: x + 2, y: y - 0.5, r: 1.8 }); });
STATIONS.push({ id: 'pier1', type: 'pier', label: 'ท่าเรือตกปลา', icon: '🎣', x: 36, y: 37, r: 3.2 });
STATIONS.push({ id: 'pier2', type: 'pier', label: 'ท่าเรือตกปลา', icon: '🎣', x: 42.5, y: 37, r: 3.2 });

// trees: seeded scatter on free grass + border
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20240607);
for (let i = 0; i < 160; i++) {
  const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
  if (grid[y][x] !== '.') continue;
  let ok = true;
  for (let j = -2; j <= 2 && ok; j++) for (let k = -2; k <= 2; k++) {
    const c = (grid[y + j] || [])[x + k];
    if (c && c !== '.' && c !== 'T') { ok = false; break; }
  }
  if (ok && !STATIONS.some(s => Math.hypot(s.x - x - .5, s.y - y - .5) < 3)) set(x, y, 'T');
}
for (let x = 0; x < W; x++) { set(x, 0, 'T'); set(x, H - 1, 'T'); }
for (let y = 0; y < H; y++) { set(0, y, 'T'); set(W - 1, y, 'T'); }

const TILES = grid.map(r => r.join(''));
const SOLID = new Set(['w', 'B', 'T']);
const isSolidTile = (tx, ty) => tx < 0 || ty < 0 || tx >= W || ty >= H || SOLID.has(grid[ty][tx]);
const RADIUS = 0.3;
function blocked(x, y) {
  return isSolidTile(Math.floor(x - RADIUS), Math.floor(y - RADIUS)) ||
         isSolidTile(Math.floor(x + RADIUS), Math.floor(y - RADIUS)) ||
         isSolidTile(Math.floor(x - RADIUS), Math.floor(y + RADIUS)) ||
         isSolidTile(Math.floor(x + RADIUS), Math.floor(y + RADIUS));
}
const SPAWN = { x: 31.0, y: 19.5 };

// ---------------------------------------------------------------- items
// kind: crop | fish | meal | goods.  base = reference sell price at the market.
const ITEMS = {
  rice:   { name: 'ข้าว', icon: '🌾', kind: 'crop', base: 40 },
  corn:   { name: 'ข้าวโพด', icon: '🌽', kind: 'crop', base: 70 },
  chili:  { name: 'พริก', icon: '🌶️', kind: 'crop', base: 100 },
  durian: { name: 'ทุเรียน', icon: '🍈', kind: 'crop', base: 320 },

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
  doctor:     { name: 'แพทย์', icon: '🩺', license: 'medicine', desc: 'เข้าเวรที่โรงพยาบาล และเดินไปรักษาผู้เล่นอื่นเพื่อรับค่ารักษา' },
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

module.exports = {
  VEHICLES, TOOLS, TOOL_PRICES, HOUSE_PRICES, FURNITURE, BANK,
  W, H, TILES, BUILDINGS, STATIONS, SPAWN, blocked, ITEMS, CROPS, RECIPES, FISH,
  CAREERS, LICENSES, OFFICE_TITLES, EVENTS, RADIUS,
};
