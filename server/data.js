'use strict';
// Static game data: maps, stations, items, careers. Tile units everywhere.
//
// The world is one big tile grid split into separate AREAS that never touch:
//   town (the village), farm (player gardens + river), housing (houses to buy / rent),
//   and the building interiors. You travel between maps through gates and doors.
const ATLAS = require('../public/assets/atlas.json');
const SPR = name => { const s = ATLAS.sprites[name]; return { w: s[2] / ATLAS.tile, h: s[3] / ATLAS.tile }; };

const TOWN = { id: 'town', kind: 'map', name: 'ตัวเมือง', x: 0, y: 0, w: 110, h: 90 };
const FARM = { id: 'farm', kind: 'map', name: 'ไร่ชานเมือง', x: 112, y: 0, w: 70, h: 50 };
const HOUSING = { id: 'housing', kind: 'map', name: 'หมู่บ้านจัดสรร', x: 184, y: 0, w: 70, h: 50 };
const RX0 = 256;                                         // interiors start here
const W = RX0 + 6 * 18 + 2, H = 90;

// ---------------------------------------------------------------- grid helpers
// tile codes: . grass  = road  , sidewalk  c cobble path  k plaza bricks  w water  p pier/bridge
//             s sand  m meadow  f soil  B building  T tree  o solid prop  # wall  i floor  D door mat  ' ' void
const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => ' '));
const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y][x] = c; };
const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c); };
const get = (x, y) => (grid[y] || [])[x];
const ellipse = (cx, cy, rx, ry, c) => { for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1) set(x, y, c); };
function shore(a, c = 's') {   // sand ring around water inside an area
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (get(x, y) === '.' || get(x, y) === 'm') {
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === 'w')) set(x, y, c);
  }
}
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20261112);
for (const a of [TOWN, FARM, HOUSING]) rect(a.x, a.y, a.w, a.h, '.');

const BUILDINGS = [], STATIONS = [], PROPS = [];
const prop = (s, x, y, solid = true) => { PROPS.push({ s, x, y }); if (solid) set(Math.floor(x), Math.floor(y - 0.5), 'o'); };
// a straight run of fence pieces from x0 to x1 along row y (bottom edge); solid fences block the grass tiles they stand on
function fenceRow(s, x0, x1, y, solid = true) {
  const w = SPR(s).w, n = Math.max(1, Math.round((x1 - x0) / w));
  // pieces overlap a little when the run is not a whole number of pieces, so it always ends exactly at x1
  const step = n > 1 ? (x1 - x0 - w) / (n - 1) : 0;
  for (let k = 0; k < n; k++) {
    const x = n > 1 ? x0 + k * step : (x0 + x1 - w) / 2;
    PROPS.push({ s, x: x + w / 2, y });
  }
  if (solid) for (let i = Math.floor(x0 + .15); i <= Math.floor(x1 - .15); i++) if ('.mT'.includes(get(i, Math.floor(y - .5)))) set(i, Math.floor(y - .5), 'o');
}
// a building whose door opens onto row `front` (the first walkable row in front of it)
function B(id, sprite, x, front, extra = {}) {
  const sp = SPR(sprite), w = Math.ceil(sp.w - 0.05), h = Math.max(2, Math.round(sp.h - 0.4));
  const b = { id, sprite, x, y: front - h, w, h, ...extra };
  BUILDINGS.push(b); return b;
}
// cobblestone path from a door straight down to a road
function pathDown(b, toY) { const cx = Math.floor(b.x + b.w / 2); for (let y = b.y + b.h; y < toY; y++) for (const x of [cx - 1, cx]) if ('.mT'.includes(get(x, y))) set(x, y, 'c'); }

// ================================================================= TOWN
{
  const T = TOWN;
  rect(102, 0, 8, H, 'w'); rect(97, 0, 5, H, 's');               // sea + beach along the east
  ellipse(26, 68, 15, 9, 'w');                                     // the lake
  ellipse(80, 54, 7, 4.5, 'w');                                    // pond in the east park
  // roads (2 lanes) with sidewalks where buildings face them
  rect(2, 31, 40, 2, '='); rect(2, 30, 40, 1, ','); rect(2, 33, 40, 1, ',');          // west main road
  rect(58, 31, 38, 2, '='); rect(58, 30, 36, 1, ','); rect(58, 33, 36, 1, ',');       // east main road
  rect(94, 33, 2, 45, '=');                                                           // coast road south
  rect(50, 76, 46, 2, '=');                                                           // south road
  rect(49, 4, 2, 20, '=');                                                            // north road
  rect(14, 14, 74, 2, '='); rect(14, 13, 74, 1, ',');                                 // north street
  rect(49, 40, 2, 36, '=');                                                           // south avenue
  rect(4, 46, 45, 2, '='); rect(4, 45, 45, 1, ',');                                   // south-west lane
  rect(49, 76, 2, 2, '=');                                                            // corner: avenue -> south road
  rect(2, 14, 12, 2, '='); rect(2, 16, 2, 15, '=');                                   // north street west end joins the main road
  rect(88, 14, 8, 2, '='); rect(94, 16, 2, 15, '=');                                  // north street east end joins the coast road
  // town square
  rect(42, 24, 16, 16, 'k');
  // winding cobble paths through the parks (they make it feel like a village, not a grid)
  const wiggle = (x0, y0, dirs) => { let x = x0, y = y0; for (const [dx, dy, n] of dirs) for (let i = 0; i < n; i++) { if ('.m'.includes(get(x, y))) { set(x, y, 'c'); set(x + (dy ? 1 : 0), y + (dx ? 1 : 0), get(x + (dy ? 1 : 0), y + (dx ? 1 : 0)) === '.' ? 'c' : get(x + (dy ? 1 : 0), y + (dx ? 1 : 0))); } x += dx; y += dy; } };
  wiggle(58, 37, [[1, 0, 6], [0, 1, 5], [1, 0, 8], [0, 1, 4], [1, 0, 6], [0, 1, 6], [1, 0, 6]]);
  wiggle(26, 48, [[0, 1, 4], [1, 0, 3], [0, 1, 3]]);
  wiggle(88, 34, [[0, 1, 6], [-1, 0, 4], [0, 1, 6]]);
  wiggle(51, 16, [[1, 0, 4], [0, 1, 3], [1, 0, 6], [0, 1, 3]]);
  rect(20, 56, 2, 7, 'p'); rect(31, 56, 2, 7, 'p');                 // lake piers
  rect(96, 60, 10, 2, 'p');                                          // sea pier
  shore(T);
  rect(94, 60, 2, 2, '=');

  // west main road, north side (doors on row 30)
  B('toolshop', 'b_toolshop', 4, 30, { label: 'ร้านอุปกรณ์', icon: '🛠️', st: 'toolshop' });
  pathDown(B('dealer', 'b_showroom', 11, 28, { label: 'โชว์รูมรถ', icon: '🚧', st: 'dealer', renov: true }), 30);
  B('school', 'b_school2', 20, 30, { label: 'มหาวิทยาลัย', icon: '🎓', st: 'school' });
  pathDown(B('bank', 'b_bank2', 30, 27, { label: 'ธนาคาร', icon: '🏦', st: 'bank' }), 30);
  // east main road, north side
  B('market', 'b_market2', 60, 30, { label: 'ตลาดกลาง', icon: '🏪', st: 'market' });
  B('hospital', 'b_hospital2', 68, 30, { label: 'โรงพยาบาล', icon: '🏥', st: 'hospital' });
  pathDown(B('office', 'b_tower', 79, 28, { label: 'บริษัท ไทยเทค', icon: '🏢', st: 'office' }), 30);
  B('flower', 'b_flower2', 87, 30, { label: 'ร้านดอกไม้', icon: '💐', deco: true, renov: true });
  // north street
  B('police', 'b_police', 18, 13, { label: 'สถานีตำรวจ', icon: '👮', st: 'police' });
  pathDown(B('fire', 'b_fire', 26, 12, { label: 'สถานีดับเพลิง', icon: '🚒', deco: true }), 13);
  B('cinema', 'b_cinema', 35, 13, { label: 'โรงหนัง', icon: '🎬', deco: true, renov: true });
  B('barber', 'b_salon', 42, 13, { label: 'ร้านตัดผม', icon: '💈', deco: true });            // barber shop on the north street
  B('inn', 'b_library', 58, 13, { label: 'ห้องสมุดเมือง', icon: '📚', deco: true });
  // south-west lane (doors on row 45)
  B('warehouse', 'b_factory', 5, 45, { label: 'คลังสินค้าราคาส่ง', icon: '📦', st: 'warehouse' });
  pathDown(B('restaurant', 'b_cafe2', 13, 44, { label: 'ร้านอาหาร', icon: '🍜', st: 'restaurant' }), 45);
  B('kitchen', 'b_kitchen', 21, 45, { label: 'ครัวใหญ่ (เชฟ)', icon: '🍳', st: 'kitchen' });
  B('rider', 'b_rider2', 29, 45, { label: 'ศูนย์ไรเดอร์', icon: '🛵', st: 'rider' });
  B('fishhut', 'b_stilthouse', 31, 55, { label: 'สมาคมประมง', icon: '🎣', deco: true });
  B('fishstall', 'b_fishstall', 20, 55, { label: 'ร้านขายปลา', icon: '🐟', deco: true });      // the club's fish counter         // the fishing club's hut by the lake
  B('fruitstall', 'b_market', 72, 39, { label: '', icon: '🍎', deco: true });                // a fruit stall in the east park
  B('fashion', 'b_boutique', 38, 45, { label: 'ร้านแฟชั่น & ทำผม', icon: '💇', st: 'fashion' });

  // villagers' homes scattered around town (scenery) so it reads as a lived-in village
  const HS = ['h_cottage1', 'h_gable_red', 'h_cottage3', 'h_cottage2', 'h_gable_blue', 'h_cottage4'];
  [[54, 76], [61, 75], [68, 76], [76, 75], [83, 76], [3, 13], [8, 12], [55, 62], [86, 46], [60, 52], [12, 85], [20, 85], [30, 85], [70, 85], [80, 85]].forEach(([x, f], i) => {
    const b = B('vh' + i, HS[i % 6], x, f, { label: '', icon: '🏡', deco: true });
    pathDown(b, f + 1);
    prop(i % 2 ? 'flowerbox' : 'hedge', x + (i % 2 ? 4.5 : -0.8), f + .02, false);
  });
  rect(52, 85, 40, 2, 'c'); rect(8, 85, 30, 2, 'c'); rect(37, 78, 2, 9, 'c'); rect(38, 78, 12, 2, 'c'); rect(60, 78, 2, 7, 'c');
  // empty lots kept for careers added later
  for (const [x, y] of [[66, 12], [75, 12], [84, 12]]) { rect(x - 2, y - 3, 6, 3, 'm'); prop('signpost', x + .5, y + .2); }

  // town square: fountain, benches, flowers
  prop('fountain', 50, 33.6);
  rect(48, 32, 4, 2, 'o');
  for (const [x, y, s] of [[43.6, 32.6, 'bench'], [56.4, 32.6, 'bench2']]) { prop(s, x, y, false); STATIONS.push({ id: `seatb${x}`, type: 'seat', label: 'ม้านั่ง', icon: '🪑', x, y: y - .25, r: 1.1, area: 'town' }); }
  prop('flowerbed', 44, 25.4); prop('flowerbed2', 56, 25.4); prop('lamp3', 42.6, 30); prop('lamp3', 57.4, 30); prop('lamp3', 42.6, 36); prop('lamp3', 57.4, 36);
  prop('noticeboard', 47, 25.6); prop('icecream', 53, 25.6);
  STATIONS.push({ id: 'square', type: 'square', label: 'ศาลาประชาคม', icon: '📋', x: 47, y: 26.4, r: 1.4, area: 'town' });
  // begging spots (beggars sit here) and crowds (pickpockets work here)
  for (const [id, x, y, l] of [['beg1', 53.5, 38.6, 'จัตุรัสกลางเมือง'], ['beg2', 64.5, 33.5, 'หน้าตลาด'], ['beg3', 76.5, 33.5, 'หน้าโรงพยาบาล'], ['beg4', 27, 33.5, 'หน้ามหาวิทยาลัย']])
    STATIONS.push({ id, type: 'begspot', label: `จุดขอทาน (${l})`, icon: '🥣', x, y, r: 1.1, area: 'town' });
  for (const [id, x, y, l] of [['crowd1', 46, 30.5, 'จัตุรัส'], ['crowd2', 66.5, 30.5, 'หน้าตลาด'], ['crowd3', 11, 51.5, 'แผงลอย']])
    STATIONS.push({ id, type: 'crowd', label: `ฝูงชน (${l})`, icon: '👥', x, y, r: 1.4, area: 'town' });
  // a dark alley behind the cinema: where thieves find work
  prop('bin_grey', 41.4, 12.2);   // the barber shop stands where a barrel and a crate used to be
  // street furniture
  for (let x = 6; x < 40; x += 9) prop(x % 2 ? 'lamp' : 'lamp2', x + .5, 34);
  for (let x = 62; x < 92; x += 9) prop(x % 2 ? 'lamp' : 'lamp2', x + .5, 34);
  for (let x = 17; x < 86; x += 11) if (x < 47 || x > 52) prop('lamp2', x + .5, 17);
  prop('busstop', 39, 30.2); prop('vending', 41.2, 29.9);
  for (const [x, y] of [[48.4, 13.95], [51.6, 13.95], [51.6, 16.95], [96.4, 30.95], [92.6, 33.95], [51.6, 75.0], [48.6, 78.95]]) prop('trafficlight', x, y); prop('postbox', 10, 33.95); prop('hydrant', 65.5, 33.95);
  prop('phonebooth', 57.3, 23.9); prop('bin_blue', 36, 29.95); prop('bin_green', 75, 33.95);
  prop('car_red', 16.5, 34.9); prop('car_blue', 70.5, 34.95); prop('taxi', 92.5, 29.95);
  // parks, the lake and the beach
  prop('b_pavilion', 66, 44); prop('bench', 72, 47, false); prop('bench2', 86, 59.3, false); prop('pond', 64, 60.2);
  prop('parasol', 99, 30); prop('parasol2', 99, 40); prop('deckchair', 98.6, 46); prop('deckchair', 99.8, 46); prop('palm', 98.7, 22); prop('palm_small', 98.5, 52); prop('palm', 99, 70);
  prop('foodtruck', 89, 74.6); prop('tent', 60, 70); prop('campfire', 63, 70.5, false);
  prop('kiosk', 26.5, 54.6); prop('crate', 23.5, 55.5); prop('barrel', 29.5, 55.5);
  prop('stall_red', 9, 52); prop('stall_green', 13, 52); prop('cartstall', 41, 55);

  // where the gates and fishing spots are
  STATIONS.push({ id: 'fishclub', type: 'fishclub', label: 'สมาคมประมง · ร้านขายปลา', icon: '🎣', x: 26.5, y: 55.4, r: 1.6, area: 'town' });
  STATIONS.push({ id: 'pier_l1', type: 'pier', pool: 'lake', label: 'ท่าตกปลา (ทะเลสาบ)', icon: '🎣', x: 21, y: 62.2, r: 1.8, area: 'town' });
  STATIONS.push({ id: 'pier_l2', type: 'pier', pool: 'lake', label: 'ท่าตกปลา (ทะเลสาบ)', icon: '🎣', x: 32, y: 62.2, r: 1.8, area: 'town' });
  STATIONS.push({ id: 'pier_s1', type: 'pier', pool: 'sea', label: 'สะพานปลา (ทะเล)', icon: '🎣', x: 105, y: 61, r: 1.8, area: 'town' });
  STATIONS.push({ id: 'pier_s2', type: 'pier', pool: 'sea', label: 'ริมหาด (ทะเล)', icon: '🎣', x: 101.2, y: 38, r: 1.6, area: 'town' });
  STATIONS.push({ id: 'pier_p', type: 'pier', pool: 'lake', label: 'บ่อตกปลา', icon: '🎣', x: 80, y: 49.2, r: 1.6, area: 'town' });
  STATIONS.push({ id: 'gate_farm', type: 'gate', to: 'farm_in', label: 'ไปไร่ชานเมือง', icon: '🌾', x: 3, y: 32, r: 1.6, area: 'town' });
  STATIONS.push({ id: 'gate_housing', type: 'gate', to: 'housing_in', label: 'ไปหมู่บ้านจัดสรร', icon: '🏘️', x: 50, y: 5, r: 1.6, area: 'town' });
  prop('sign_walk', 4.6, 30.3); prop('signpost', 52.8, 7.4);
  // the town wall along the north edge, with the wooden town gate standing open over the road to the housing estate
  fenceRow('wall_stone', 1, 47.27, 5.95); fenceRow('wall_stone', 52.73, 97, 5.95);
  prop('gate_wood_l', 48.13, 5.95); prop('gate_wood_r', 51.87, 5.95);
}

// ================================================================= FARM (player gardens)
const LOTS = [];
const GARDEN = { lotPrice: 2500, startPlots: 2, maxPlots: 6, expand: [0, 0, 900, 1600, 2600, 4000] };
{
  const X = FARM.x;
  rect(X + 2, 24, 66, 2, 'c');                                       // farm track
  rect(X, 42, FARM.w, 5, 'w');                                       // river
  rect(X + 20, 39, 2, 5, 'p'); rect(X + 48, 39, 2, 5, 'p');          // fishing piers
  rect(X + 34, 40, 3, 9, 'p');                                       // bridge
  shore(FARM);
  B('coop', 'b_barn', X + 4, 24, { label: 'สหกรณ์การเกษตร', icon: '🧑‍🌾', deco: true, area: 'farm' });
  STATIONS.push({ id: 'coop', type: 'coop', label: 'สหกรณ์การเกษตร', icon: '🧑‍🌾', x: X + 6, y: 24.6, r: 1.6, area: 'farm' });
  prop('cartstall', X + 12, 23.4); STATIONS.push({ id: 'farmbuy', type: 'farmbuy', label: 'จุดรับซื้อผลผลิต', icon: '⚖️', x: X + 12, y: 24.5, r: 1.6, area: 'farm' });
  prop('well', X + 9, 21); prop('hay', X + 4, 29); prop('hay2', X + 6, 29.5); prop('cart', X + 10, 29.5); prop('scarecrow' in ATLAS.sprites ? 'scarecrow' : 'signpost', X + 13, 30);
  for (let i = 0; i < 10; i++) {
    const north = i < 5, lx = X + 17 + (i % 5) * 10, ly = north ? 13 : 27;
    const lot = { idx: i, x: lx, y: ly, plots: [] };
    rect(lx, ly, 9, 10, 'm');
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const px = lx + 1 + c * 3, py = ly + (north ? 3 : 1) + r * 3;
      rect(px, py, 2, 2, 'f');
      const n = lot.plots.length;
      lot.plots.push({ x: px + 1, y: py + 1 });
      STATIONS.push({ id: `g${i}_${n}`, type: 'gplot', lot: i, n, label: 'แปลงปลูก', icon: '🌱', x: px + 1, y: py + 1, r: 1.4, area: 'farm' });
    }
    const sx = lx + 4.5, sy = north ? ly + 10.2 : ly - .3;
    lot.sign = { x: sx, y: sy };
    STATIONS.push({ id: `lot${i}`, type: 'lot', lot: i, label: `สวนแปลงที่ ${i + 1}`, icon: '🪧', x: sx, y: north ? sy + .1 : sy + .5, r: 1.3, area: 'farm' });
    // fence along the far side
    fenceRow('fence_rope', lx + .3, lx + 8.8, north ? ly + .9 : ly + 10.4, false);
    LOTS.push(lot);
  }
  for (const [a, b] of [[1, 19.5], [22.5, 33.5], [37.5, 47.5], [50.5, 69]]) fenceRow('fence_bamboo', X + a, X + b, 40.95);   // riverbank, piers left open
  STATIONS.push({ id: 'pier_r1', type: 'pier', pool: 'river', label: 'ท่าตกปลา (แม่น้ำ)', icon: '🎣', x: X + 21, y: 43.3, r: 1.8, area: 'farm' });
  STATIONS.push({ id: 'pier_r2', type: 'pier', pool: 'river', label: 'ท่าตกปลา (แม่น้ำ)', icon: '🎣', x: X + 49, y: 43.3, r: 1.8, area: 'farm' });
  STATIONS.push({ id: 'gate_town_f', type: 'gate', to: 'town_from_farm', label: 'กลับเข้าเมือง', icon: '🏙️', x: X + 66.5, y: 25, r: 1.6, area: 'farm' });
  prop('signpost', X + 65, 23.3);
}

// ================================================================= HOUSING (houses to buy / rent)
const HOUSE_SPRITES = ['h_cottage1', 'h_gable_red', 'h_cottage3', 'h_cottage2', 'h_gable_blue', 'h_cottage4'];
const HOUSE_PRICES = [], HOUSE_RENT = [];
{
  const X = HOUSING.x;
  rect(X + 2, 21, 64, 2, '='); rect(X + 2, 20, 64, 1, ',');
  rect(X + 6, 38, 58, 2, '='); rect(X + 6, 37, 58, 1, ',');
  rect(X + 6, 23, 2, 15, '='); rect(X + 62, 23, 2, 15, '=');
  ellipse(X + 35, 45, 8, 3, 'w'); shore(HOUSING);
  rect(X + 26, 25, 18, 7, 'k');
  for (let i = 0; i < 12; i++) {
    const row = i < 6 ? 0 : 1, col = i % 6;
    const front = row ? 37 : 20, x = X + 10 + col * 9 + (row ? 1 : 0);
    const price = Math.round((28000 + (i % 6) * 7000 + row * 10000) / 1000) * 1000;
    HOUSE_PRICES.push(price); HOUSE_RENT.push(Math.round(price / 160 / 10) * 10);   // a day's rent ≈ a third of a day's starting wage
    B('house' + i, HOUSE_SPRITES[(i + row) % 6], x, front, { label: 'บ้าน', icon: '🏠', st: 'house' + i, house: i, area: 'housing' });
    prop(i % 2 ? 'hedge_flower' : 'hedge', x - 1, front - .1, false);
    if (i % 3 === 0) prop('postbox', x + 5.3, front + .05);
  }
  prop('fountain', X + 35, 30.4); rect(X + 33, 29, 4, 2, 'o');
  prop('bench', X + 29, 27, false); prop('bench2', X + 41, 27, false); prop('tree_pink', X + 27.5, 31.6); prop('tree_pink', X + 42.5, 31.6);
  prop('kiosk', X + 3.5, 30); STATIONS.push({ id: 'estate', type: 'estate', label: 'สำนักงานอสังหาฯ', icon: '🏡', x: X + 3.5, y: 30.7, r: 1.5, area: 'housing' });
  STATIONS.push({ id: 'gate_town_h', type: 'gate', to: 'town_from_housing', label: 'กลับเข้าเมือง', icon: '🏙️', x: X + 3, y: 22, r: 1.6, area: 'housing' });
  fenceRow('fence_white', X + 8, X + 62, 16.95); fenceRow('fence_white', X + 9, X + 62, 33.95);   // back gardens
  for (const y of [24.95, 32.95]) { fenceRow('fence_iron', X + 25, X + 33.3, y); fenceRow('fence_iron', X + 36.7, X + 45, y); prop('gate_iron', X + 33.8, y, false); prop('gate_iron', X + 36.2, y, false); }
  for (let y = 25; y <= 32; y++) { prop('fence_post', X + 25.4, y + .95); prop('fence_post', X + 44.6, y + .95); }
  for (const [x, y] of [[X + 15, 45], [X + 55, 45]]) STATIONS.push({ id: 'seat_h' + x, type: 'seat', label: 'ม้านั่งในสวน', icon: '🪑', x, y: y - .25, r: 1.1, area: 'housing' }), prop('bench', x, y, false);
}

// where gates drop you
const GATES = {
  farm_in: { x: FARM.x + 64.5, y: 25 }, town_from_farm: { x: 5.5, y: 32 },
  housing_in: { x: HOUSING.x + 5, y: 22 }, town_from_housing: { x: 50, y: 7 },
};

// ================================================================= trees (scatter on free grass)
// scattered outdoor decor (placed before the random trees so trees keep clear of it)
function scatter(A, kinds, n, flat) {
  for (let i = 0, tries = 0; i < n && tries < n * 40; tries++) {
    const x = A.x + 2 + Math.floor(rand() * (A.w - 4)), y = A.y + 3 + Math.floor(rand() * (A.h - 5));
    let ok = true;
    for (let j = -2; j <= 1 && ok; j++) for (let k = -1; k <= 1; k++) if (!'.m'.includes(get(x + k, y + j) || '#')) { ok = false; break; }
    if (ok && BUILDINGS.some(b => x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h + 1)) ok = false;
    if (!ok || STATIONS.some(s => Math.hypot(s.x - x - .5, s.y - y - .5) < 3) || PROPS.some(p => Math.hypot(p.x - x - .5, p.y - y - .5) < 3)) continue;
    prop(kinds[i % kinds.length], x + .5, y + .95, !flat); i++;
  }
}
scatter(TOWN, ['rock', 'stump', 'bench_stone', 'flowerbox', 'rock_big', 'barrel', 'crates'], 16);
scatter(TOWN, ['tuft', 'tuft', 'puddle'], 14, true);
scatter(FARM, ['wheelbarrow', 'hay', 'crate_apple', 'firewood', 'ladder', 'barrel', 'hose', 'faucet', 'crate', 'rock'], 14);
scatter(FARM, ['tuft'], 10, true);
scatter(HOUSING, ['gnome', 'gnome2', 'flowerbox', 'stump', 'bench_stone', 'rock', 'hose'], 14);
scatter(HOUSING, ['tuft'], 8, true);
// manholes on the main roads, a news box and bollards by the square
for (const [x, y] of [[50, 52], [50, 66], [30, 47], [70, 15], [25, 15], [50, 10]]) if (get(Math.floor(x), Math.floor(y - .5)) === '=') prop('manhole', x, y, false);
prop('newsbox', 57.3, 38.9); prop('bollard', 47.6, 39.95); prop('bollard', 52.4, 39.95);
const TREE_KINDS = ['tree', 'tree2', 'pine', 'tree_oak', 'tree_pink', 'tree3', 'bush', 'tree4', 'pine2', 'tree_cone', 'tree_twin', 'tree_pink2', 'bush2', 'tree_white'];
for (const a of [TOWN, FARM, HOUSING]) {
  for (let x = a.x; x < a.x + a.w; x++) { set(x, a.y, 'T'); set(x, a.y + a.h - 1, 'T'); }
  for (let y = a.y; y < a.y + a.h; y++) { if (get(a.x, y) !== 'w') set(a.x, y, 'T'); if (get(a.x + a.w - 1, y) !== 'w') set(a.x + a.w - 1, y, 'T'); }
  const n = a.w * a.h / 6;
  for (let i = 0; i < n; i++) {
    const x = a.x + 1 + Math.floor(rand() * (a.w - 2)), y = a.y + 2 + Math.floor(rand() * (a.h - 3));
    if (get(x, y) !== '.') continue;
    let ok = true;
    for (let j = -2; j <= 1 && ok; j++) for (let k = -1; k <= 1; k++) { const c = get(x + k, y + j); if (c && c !== '.' && c !== 'T') { ok = false; break; } }
    if (ok && BUILDINGS.some(b => x >= b.x - 1 && x < b.x + b.w + 1 && y >= b.y - 1 && y < b.y + b.h + 3)) ok = false;   // keep building fronts clear
    if (ok && !STATIONS.some(s => Math.hypot(s.x - x - .5, s.y - y - .5) < 3) && !PROPS.some(p => Math.hypot(p.x - x - .5, p.y - y - .5) < 2.5)) set(x, y, 'T');
  }
}
BUILDINGS.forEach(b => rect(b.x, b.y, b.w, b.h, 'B'));
const TREES = [];
for (let y = 0; y < H; y++) for (let x = 0; x < RX0; x++) if (grid[y][x] === 'T') TREES.push([x, y, TREE_KINDS[(x * 7 + y * 13) % TREE_KINDS.length]]);

// ================================================================= interiors
// Every enterable building has a room. Furniture is real: solid pieces block movement
// (on the server too). Layout entries: [sprite, x, y(bottom), solid?] relative to the room.
const ROOM_SIZE = { office: [16, 12], hospital: [16, 11], house: [12, 9] };
const SOFT = /rug|window|pictures|clock|welcome|bed|chair|beanbag|curtains|picture/;
const LAYOUT = {
  office: [['f_window', 4, 1.1], ['f_window', 12, 1.1], ['f_reception', 8, 2.4], ['f_filing_grey', 1.6, 2.6], ['f_cabinet2', 14.4, 2.7], ['f_plant', 1.6, 10.7], ['f_water', 14.4, 10.7], ['f_clock', 10.6, .95], ['f_corkboard', 5.5, 1.15, false], ['i_calendar', 2.8, 1.05, false], ['f_extinguisher', 12.6, 2.4]],
  market: [['f_shelf_a', 1.8, 2.8], ['f_shelf_b', 3.3, 2.8], ['f_shelf_c', 11.4, 2.8], ['f_cashdesk', 7, 2.4], ['stall_green', 3.4, 6.6], ['stall_red', 10.6, 6.6], ['i_crate_apple', 12.6, 8.6], ['i_crate_carrot', 1.6, 8.6], ['i_rice_sack', 6, 8.7], ['i_open', 9.5, 1.05, false]],
  warehouse: [['crate', 1.8, 3.2], ['crate', 3, 3.2], ['barrel', 4.2, 3.2], ['f_cabinet', 7, 2.3], ['hay2', 11.5, 3.4], ['hay', 11.6, 6.6], ['sack', 2.2, 6.6], ['barrel2', 3.3, 6.6], ['crate', 12.2, 8.6]],
  fashion: [['f_mirror', 2.4, 2.8], ['f_cabinet2', 12, 2.7], ['f_cashdesk', 7, 2.4], ['f_clothes_rack', 3, 6.4], ['f_clothes_rack', 11, 6.4], ['f_rug_round', 7, 6.6], ['f_shoe_rack', 1.8, 8.7], ['f_vase', 12.4, 8.7], ['i_poster', 5, 1.05, false]],
  rider: [['f_window', 10.5, 1.1], ['f_cashdesk', 7, 2.4], ['f_display', 2.6, 2.7], ['f_bench_back', 10.6, 5.6], ['f_coffee', 12.6, 2.6], ['f_rug_round', 7, 6.4], ['f_plant', 1.6, 8.7], ['i_backpack', 12.4, 8.6], ['i_bike', 4, 8.6, false]],
  dealer: [['f_desk', 7, 2.3], ['car_red', 3, 4.8], ['car_blue', 11, 4.8], ['car_green', 3, 8.3], ['f_plant', 1.5, 2.6], ['f_plant2', 12.5, 2.6]],
  toolshop: [['f_shelf_pots', 2.6, 2.6], ['f_shelf_c', 11.6, 2.8], ['f_cashdesk', 7, 2.4], ['cart', 3, 7.2], ['crate', 11.4, 6.6], ['barrel', 12.4, 6.6], ['i_watering', 1.6, 8.7, false], ['i_pot', 12.4, 8.7]],
  restaurant: [['f_counter_micro', 7, 2.3], ['menuboard', 12.4, 2.7], ['f_plant', 1.6, 2.7], ['f_table_chairs', 3, 5.4], ['f_table_chairs2', 11, 5.6], ['f_table_chairs2', 3, 8.8], ['f_round_table', 11, 8.4], ['i_cake', 9.4, 2.4, false], ['f_wine_rack', 4.6, 2.6]],
  kitchen: [['f_counter_micro', 2.7, 2.6], ['f_stove_pot', 4.9, 2.4], ['f_counter2', 7.4, 2.5], ['f_counter_oven', 9.9, 2.6], ['f_fridge', 12, 2.7], ['f_shelf_pots', 2.6, 6.4], ['f_bench', 10.5, 6.6], ['i_rice_sack', 1.4, 8.6], ['i_fish_ice', 12.4, 8.6, false], ['f_extinguisher', 13.6, 6.4]],
  hospital: [['f_reception2', 3.5, 2.5], ['f_shelf_jars', 1.8, 6.4], ['f_plant', 1.5, 9.7], ['f_window', 6.4, 1.1], ['f_firstaid', 9.2, 1.1, false], ['f_wheelchair', 14.5, 9.7], ['f_iv', 14.6, 6.6], ['f_water', 1.5, 8.2]],
  school: [['f_books', 1.8, 2.6], ['f_bookshelf_wide', 3.6, 2.6], ['f_bookshelf', 11.8, 2.6], ['f_desk', 7, 2.3], ['f_clock', 9.4, .95], ['i_calendar', 4.8, 1.05, false]],
  police: [['f_police_desk', 7, 2.4], ['f_filing_grey', 1.6, 2.6], ['f_locker', 3, 2.7], ['f_corkboard', 10, 1.15, false], ['f_bunk', 11.5, 7.4], ['f_bunk2', 9.5, 7.4], ['f_plant', 1.6, 8.7], ['f_extinguisher', 13.2, 2.5], ['f_water', 4.4, 2.6]],
  bank: [['f_reception', 7, 2.4], ['f_filing_grey', 1.6, 2.6], ['f_filing_grey', 12.4, 2.6], ['f_rug_blue', 7, 6.6], ['f_plant', 1.6, 8.7], ['f_cactus', 12.4, 8.7], ['f_pictures', 4, 1.05], ['f_pictures', 10, 1.05], ['i_cashbox', 9.4, 2.4, false]],
  house: [['f_bed_blue', 2.6, 3.4], ['f_window', 6, 1.1], ['f_welcome', 6, 8.2], ['f_window_flower', 9.5, 1.15, false]],
};
// office: 8 work desks with a chair in front of each
for (const cx of [2.5, 5.5, 10.5, 13.5]) for (const by of [5.2, 8.3]) LAYOUT.office.push(['f_laptop_desk', cx, by], ['f_office_chair', cx, by + 1.25]);
// university classroom: 4 desks, two students each
const SCHOOL_DESKS = [[3.6, 4.6], [10.4, 4.6], [3.6, 7.0], [10.4, 7.0]];
for (const [cx, by] of SCHOOL_DESKS) LAYOUT.school.push(['f_desk', cx, by], ['f_chair', cx - .45, by + 1.25], ['f_chair', cx + .45, by + 1.25]);
const ROOMS = [];
let slot = 0;
for (const b of BUILDINGS) {
  if (!b.st) continue;
  const kind = b.house !== undefined ? 'house' : b.id;
  const [RW, RH] = ROOM_SIZE[kind] || [14, 10];
  const rx = RX0 + (slot % 6) * 18, ry = 1 + Math.floor(slot / 6) * 14; slot++;
  rect(rx, ry, RW, RH, '#'); rect(rx + 1, ry + 1, RW - 2, RH - 2, 'i');
  const mx = Math.floor(RW / 2);
  rect(rx + mx - 1, ry + RH - 1, 2, 1, 'D');
  const front = { x: b.x + b.w / 2, y: b.y + b.h };
  const room = {
    id: 'r_' + b.id, kind: 'room', bld: b.id, rk: kind, house: b.house, label: b.label, icon: b.icon, area: b.area || 'town',
    x: rx, y: ry, w: RW, h: RH, spawn: { x: rx + mx, y: ry + RH - 2.3 }, exit: { x: rx + mx, y: ry + RH - 0.5 },
    outside: { x: front.x, y: front.y + 1.2 }, doorPt: { x: front.x, y: front.y + 0.32 }, hours: null,
  };
  ROOMS.push(room); b.room = room.id;
  const items = LAYOUT[kind] || [];
  room.furniture = items.map(([s, x, y, solid]) => [s, rx + x, ry + y]);
  for (const [s, x, y, solid] of items) {
    if (solid === false || SOFT.test(s) || y < 1.3 || !ATLAS.sprites[s]) continue;
    const w = SPR(s).w, row = ry + Math.floor(y - 0.45);
    for (let i = Math.floor(rx + x - w / 2 + 0.3); i <= Math.floor(rx + x + w / 2 - 0.3); i++) if (get(i, row) === 'i') set(i, row, 'o');
  }
  STATIONS.push({ id: 'exit_' + b.id, type: 'exit', room: room.id, label: 'ออกนอกอาคาร', icon: '🚪', x: rx + mx, y: ry + RH - 0.55, r: 1.2 });
  STATIONS.push({ id: 'door_' + b.id, type: 'door', to: room.id, label: b.label, icon: b.icon, x: front.x, y: front.y + 0.6, r: 1.5, area: b.area || 'town', bld: b.id, house: b.house, renov: b.renov || undefined });
  if (kind === 'house') {
    STATIONS.push({ id: 'hbed' + b.house, type: 'hbed', idx: b.house, room: room.id, label: 'เตียงนอน', icon: '🛏️', x: rx + 2.6, y: ry + 3.7, r: 1.4 });
    continue;
  }
  const s = { id: b.st, type: b.st, label: b.label, icon: b.icon, room: room.id, x: rx + mx, y: ry + 2.6, r: 1.8 };
  if (kind === 'office') { s.x = rx + 8; s.label = 'ฝ่ายบุคคล (สมัครงาน)'; }
  if (kind === 'hospital') {
    s.x = rx + 3.5;
    [[8.5, 3.6], [11, 3.6], [13.5, 3.6], [8.5, 7.4], [11, 7.4], [13.5, 7.4]].forEach(([dx, dy], i) => {
      room.furniture.push(['f_bed_hosp', rx + dx, ry + dy - .2]);
      STATIONS.push({ id: 'bed' + i, type: 'bed', idx: i, room: room.id, label: 'เตียงคนไข้', icon: '🛏️', x: rx + dx, y: ry + dy, r: 1.2 });
    });
  }
  STATIONS.push(s);
  if (kind === 'school') {
    let n = 0;
    for (const [cx, by] of SCHOOL_DESKS) for (const dx of [-.45, .45]) STATIONS.push({ id: 'sdesk' + n, type: 'sdesk', idx: n++, room: room.id, label: 'โต๊ะเรียน', icon: '📖', x: rx + cx + dx, y: ry + by + .95, r: .7 });
  }
  if (kind === 'office') {
    let n = 0;
    for (const cx of [2.5, 5.5, 10.5, 13.5]) for (const by of [5.2, 8.3]) STATIONS.push({ id: 'chair' + n, type: 'chair', idx: n++, room: room.id, label: 'โต๊ะทำงาน', icon: '💺', x: rx + cx, y: ry + by + .95, r: .9 });
  }
}
const AREAS = [TOWN, FARM, HOUSING, ...ROOMS];
const areaAt = (x, y) => AREAS.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
const roomAt = (x, y) => { const a = areaAt(x, y); return a && a.kind === 'room' ? a : null; };
for (const s of STATIONS) if (!s.area) s.area = areaAt(s.x, s.y)?.id;
const TILES = grid.map(r => r.join(''));
const SOLID = 'wBT# o';
const isSolidTile = (tx, ty) => tx < 0 || ty < 0 || tx >= W || ty >= H || SOLID.includes(grid[ty][tx]);
const RADIUS = 0.3;
function blocked(x, y, r = RADIUS) {
  return isSolidTile(Math.floor(x - r), Math.floor(y - r)) || isSolidTile(Math.floor(x + r), Math.floor(y - r)) ||
         isSolidTile(Math.floor(x - r), Math.floor(y + r)) || isSolidTile(Math.floor(x + r), Math.floor(y + r));
}
const SPAWN = { x: 50, y: 36.6 };

// ================================================================= time
// One in-game day lasts 24 real minutes. Nights pass twice as fast as days:
// 05:00-20:00 (15 game hours) take 19.5 real minutes, 20:00-05:00 (9 game hours) take 4.5 real minutes.
const DAY_MS = 24 * 60 * 1000;
const TIME_OFF = +process.env.TIME_OFFSET_MS || 0;           // testing aid: shift the in-game clock
const CLOCK = { dawn: 7, dusk: 19, dayMin: 21 };              // night 19:00–07:00 passes in 3 real minutes            // the client gets the same numbers
const hourOfPhase = m => {                                    // m = real minutes into the day (0-24)
  const nightH = 24 - (CLOCK.dusk - CLOCK.dawn), nightMin = 24 - CLOCK.dayMin;
  return m < CLOCK.dayMin ? CLOCK.dawn + m * (CLOCK.dusk - CLOCK.dawn) / CLOCK.dayMin : (CLOCK.dusk + (m - CLOCK.dayMin) * nightH / nightMin) % 24;
};
const hourAt = t => hourOfPhase((((t + TIME_OFF) % DAY_MS) + DAY_MS) % DAY_MS / 60000);
// the date turns over at midnight (21.5 real minutes into the cycle)
const MIDNIGHT_MS = (CLOCK.dayMin + (24 - CLOCK.dusk) * (24 - CLOCK.dayMin) / (24 - (CLOCK.dusk - CLOCK.dawn))) * 60000;
const dayAt = t => Math.floor((t + TIME_OFF + DAY_MS - MIDNIGHT_MS) / DAY_MS);
// game hours that pass per real second at hour h
const gameRate = h => (h >= CLOCK.dawn && h < CLOCK.dusk) ? (CLOCK.dusk - CLOCK.dawn) / (CLOCK.dayMin * 60) : (24 - (CLOCK.dusk - CLOCK.dawn)) / ((24 - CLOCK.dayMin) * 60);
// opening hours [open, close) in game hours
const HOURS = { fashion: [9, 21], police: [0, 24], square: [6, 22], office: [6, 21], market: [0, 24], warehouse: [5, 20], restaurant: [7, 23], kitchen: [5, 23], hospital: [0, 24], school: [7, 18],
  bank: [8, 17], dealer: [8, 20], toolshop: [8, 20], rider: [6, 23], coop: [5, 20], farmbuy: [5, 20], estate: [8, 20], fishclub: [5, 21] };
const isOpen = (kind, h) => { const o = HOURS[kind]; return !o || (h >= o[0] && h < o[1]); };
const SHIFT = { start: 8, end: 17, grace: 8.25, lunch: null };
// doctors are paid for every game hour they spend inside the hospital during their shift
const DOCTOR = { start: 8, end: 20, wage: [60, 70, 82, 96, 112, 130, 152] };   // above office: needs a degree + licence
// calendar: 12 months of 5 game days (a month = 2 real hours, a year = 1 real day). Water & electricity are billed monthly.
const MONTH_DAYS = 5;
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const monthIdx = t => Math.floor(dayAt(t) / MONTH_DAYS);
const YEAR0 = Math.floor(Math.floor(Date.UTC(2026, 10, 1) / DAY_MS) / (MONTH_DAYS * 12)) * MONTH_DAYS * 12;   // year 2569 starts here
const dateAt = t => { const d = dayAt(t) - YEAR0; return { day: d % MONTH_DAYS + 1, month: Math.floor(d / MONTH_DAYS) % 12, year: 2569 + Math.floor(d / MONTH_DAYS / 12) }; };
// a home's monthly bill: a fixed part + what you used (nights slept, furniture that runs on power)
const UTIL = { water: 150, waterPerSleep: 25, elec: 220, elecPerComfort: 35, elecPerSleep: 20, lateFee: 0.15 };
for (const r of ROOMS) r.hours = HOURS[r.rk] || null;
for (const b of BUILDINGS) b.hours = HOURS[b.house !== undefined ? 'house' : b.id] || null;

// ================================================================= items
// kind: crop | fish | meal | goods.  base = what players typically pay; NPCs buy far below it.
const ITEMS = {
  rice:   { name: 'ข้าว', icon: '🌾', kind: 'crop', base: 25 },
  corn:   { name: 'ข้าวโพด', icon: '🌽', kind: 'crop', base: 45, eat: { hunger: 8 } },
  chili:  { name: 'พริก', icon: '🌶️', kind: 'crop', base: 65 },
  durian: { name: 'ทุเรียน', icon: '🍈', kind: 'crop', base: 220, eat: { hunger: 20, energy: 5 } },

  sfish:    { name: 'ปลาเล็ก', icon: '🐟', kind: 'fish', base: 25 },
  catfish:  { name: 'ปลาดุก', icon: '🐟', kind: 'fish', base: 45 },
  tilapia:  { name: 'ปลานิล', icon: '🐠', kind: 'fish', base: 60 },
  snakehead:{ name: 'ปลาช่อน', icon: '🐠', kind: 'fish', base: 95 },
  squid:    { name: 'ปลาหมึก', icon: '🦑', kind: 'fish', base: 80 },
  seabass:  { name: 'ปลากะพง', icon: '🐡', kind: 'fish', base: 110 },
  tuna:     { name: 'ทูน่า', icon: '🐋', kind: 'fish', base: 300 },
  shark:    { name: 'ฉลาม', icon: '🦈', kind: 'fish', base: 1200 },
  chest:    { name: 'หีบสมบัติ', icon: '💎', kind: 'fish', base: 3000 },

  fried_rice:   { name: 'ข้าวผัด', icon: '🍚', kind: 'meal', base: 150, eat: { hunger: 35, energy: 5 } },
  corn_soup:    { name: 'ซุปข้าวโพด', icon: '🥣', kind: 'meal', base: 300, eat: { hunger: 30, energy: 8 } },
  grilled_fish: { name: 'ปลาเผา', icon: '🍤', kind: 'meal', base: 260, eat: { hunger: 45, energy: 10 } },
  tomyum:       { name: 'ต้มยำ', icon: '🍲', kind: 'meal', base: 500, eat: { hunger: 50, energy: 15 } },
  durian_sweet: { name: 'ทุเรียนเชื่อม', icon: '🍨', kind: 'meal', base: 650, eat: { hunger: 30, energy: 25, health: 5 } },
  // restaurant menu (sold at the restaurant and through the delivery app)
  kaprao:  { name: 'ข้าวกะเพรา', icon: '🍛', kind: 'meal', base: 100, eat: { hunger: 32 }, menu: 1 },
  noodle:  { name: 'ก๋วยเตี๋ยว', icon: '🍜', kind: 'meal', base: 80, eat: { hunger: 26 }, menu: 1 },
  somtam:  { name: 'ส้มตำ', icon: '🥗', kind: 'meal', base: 90, eat: { hunger: 22, energy: 6 }, menu: 1 },
  shabu:   { name: 'ชุดชาบู', icon: '🍲', kind: 'meal', base: 320, eat: { hunger: 70, energy: 10 }, menu: 1 },

  snack:  { name: 'ขนม', icon: '🍪', kind: 'goods', base: 30, eat: { hunger: 10 }, wholesale: 18, stock: 80, refill: 8 },
  drink:  { name: 'เครื่องดื่มชูกำลัง', icon: '🥤', kind: 'goods', base: 150, eat: { energy: 25 }, wholesale: 105, stock: 12, refill: 25 },
  med_fever:  { name: 'ยาลดไข้', icon: '💊', kind: 'goods', pharmacy: true, base: 300, cures: ['cold'], eat: { health: 5 } },
  med_flu:    { name: 'ยาต้านไวรัส', icon: '🧪', kind: 'goods', pharmacy: true, base: 900, cures: ['flu'], eat: { health: 5 } },
  med_ors:    { name: 'ผงเกลือแร่ + ยาฆ่าเชื้อ', icon: '🧂', kind: 'goods', pharmacy: true, base: 250, cures: ['poison'], eat: { health: 5 } },
  med_sleep:  { name: 'ยานอนหลับ', icon: '😴', kind: 'goods', pharmacy: true, base: 200, cures: ['insomnia'], eat: { health: 2 } },
  med_vit:    { name: 'วิตามินรวม + น้ำเกลือแร่', icon: '💉', kind: 'goods', pharmacy: true, base: 350, cures: ['exhaust', 'malnut'], eat: { energy: 10, health: 5 } },
  painkiller: { name: 'ยาแก้ปวด/ยาบำรุง', icon: '💊', kind: 'goods', pharmacy: true, base: 150, eat: { health: 20 } },
  medkit: { name: 'ชุดปฐมพยาบาล', icon: '🩹', kind: 'goods', pharmacy: true, cures: ['injury'], base: 250, eat: { health: 30 }, wholesale: 180, stock: 10, refill: 40 },
};
const CATEGORIES = { crop: '🌾 พืชผล', fish: '🐟 ปลา', meal: '🍱 อาหาร', goods: '📦 สินค้า' };

const CROPS = {
  rice:   { seed: 15,  grow: 240, min: 3, max: 5 },
  corn:   { seed: 30,  grow: 360, min: 4, max: 5 },
  chili:  { seed: 50,  grow: 480, min: 4, max: 5 },
  durian: { seed: 200, grow: 900, min: 3, max: 4 },
};
const RECIPES = [
  { id: 'fried_rice',   in: { rice: 2 } },
  { id: 'corn_soup',    in: { corn: 2, rice: 1 } },
  { id: 'grilled_fish', in: { catfish: 1, chili: 1 } },
  { id: 'tomyum',       in: { tilapia: 1, chili: 1, corn: 1 } },
  { id: 'durian_sweet', in: { durian: 1, rice: 1 } },
];
// fishing pools: [id, weight]. null = junk
const FISH = {
  river: [[null, 25], ['sfish', 40], ['catfish', 26], ['tilapia', 12], ['snakehead', 4]],
  lake:  [[null, 22], ['sfish', 30], ['tilapia', 28], ['snakehead', 12], ['seabass', 6], ['chest', 0.1]],
  sea:   [[null, 28], ['sfish', 25], ['squid', 18], ['seabass', 12], ['tuna', 3], ['shark', 0.5], ['chest', 0.15]],
};
const BIG_FISH = ['seabass', 'tuna', 'shark', 'chest', 'snakehead', 'squid'];
const FISHING = { rod: 150, xpPerLv: 8, maxLv: 10, zone: [0.2, 0.26, 0.32, 0.4] };   // zone = width of the timing window per rod tier

// ================================================================= careers
// Nobody picks a career at the start: you walk into the right building and apply.
const CAREERS = {
  none:     { name: 'ว่างงาน', icon: '🙂', where: null, desc: 'ยังไม่มีงานทำ ไปสมัครงานตามอาคารต่างๆ' },
  office:   { name: 'พนักงานบริษัท', icon: '👔', where: 'office', need: ['degree'], desc: 'เข้างาน 08:00–17:00 นั่งที่โต๊ะทำงาน ได้เงินตามชั่วโมงที่นั่งทำงาน มาสายโดนหักเงินและอาจถูกเลิกจ้าง' },
  farmer:   { name: 'เกษตรกร', icon: '🌾', where: 'coop', need: [], desc: 'ซื้อสวนของตัวเองที่ไร่ชานเมือง ปลูกพืช ขายที่จุดรับซื้อในไร่หรือตลาดกลาง ขยายแปลงได้' },
  merchant: { name: 'พ่อค้า', icon: '🛒', where: 'warehouse', need: [], desc: 'ซื้อของราคาส่งจากคลัง ไปวางขายที่ตลาดกลางในราคาที่ตั้งเอง' },
  chef:     { name: 'เชฟ', icon: '🍳', where: 'kitchen', need: ['cooking'], desc: 'ซื้อวัตถุดิบจากชาวไร่ชาวประมง ปรุงอาหารขายได้แพงกว่าหลายเท่า' },
  doctor:   { name: 'แพทย์', icon: '🩺', where: 'hospital', need: ['degree', 'medicine'], desc: 'อยู่ในโรงพยาบาลช่วงเวลางาน 08:00–20:00 ได้เงินเดือนตามชั่วโมง + ค่ารักษาคนไข้บนเตียง (ต้องวินิจฉัยจากอาการให้ถูก)' },
  police:   { name: 'ตำรวจ', icon: '👮', where: 'police', need: ['hs', 'policeExam'], desc: 'ลาดตระเวนได้เบี้ยเลี้ยง รับแจ้งเหตุ 191 เห็นตำแหน่งโจรบนแผนที่ตำรวจ จับกุมได้ค่าหัว' },
  beggar:   { name: 'ขอทาน', icon: '🥣', where: 'square', need: [], desc: 'นั่งขอทานได้ทุกที่ (ปุ่ม 🥣) ได้เศษเงินจากคนผ่านไปมา ที่คนพลุกพล่านได้บ่อยกว่า ผู้เล่นที่บริจาคให้จะมีความสุขเพิ่ม' },
  rider:    { name: 'ไรเดอร์ส่งอาหาร', icon: '🛵', where: 'rider', need: ['driving'], desc: 'รับออเดอร์จากแอพ ไปรับอาหารที่ร้านอาหาร แล้วไปส่งให้ลูกค้า ได้ค่าส่ง + ทิป (ใบขับขี่ต้องต่ออายุทุกปี)' },
};
// the degree comes from classes at the university; other licences are bought
const LICENSES = {
  hs:       { name: 'วุฒิ ม.6', icon: '📘', price: 1500, classes: 4, where: 'school' },
  degree:   { name: 'ปริญญาตรี', icon: '🎓', price: 4500, classes: 6, need: 'hs', where: 'school' },
  policeExam: { name: 'ผลสอบนายสิบตำรวจ', icon: '👮', price: 1000, need: 'hs', where: 'school', test: true },
  cooking:  { name: 'ใบรับรองเชฟ', icon: '📜', price: 1800, where: 'school' },
  medicine: { name: 'ใบประกอบวิชาชีพเวชกรรม', icon: '⚕️', price: 15000, need: 'degree', where: 'school' },
  driving:  { name: 'ใบขับขี่', icon: '🪪', price: 1200, where: 'school', test: true, renew: 600 },
};
const DRIVING_TEST = [
  { q: 'สัญญาณไฟสีเหลือง หมายถึงอะไร', a: ['เร่งความเร็วผ่านไป', 'เตรียมหยุดรถ', 'จอดรถได้ทันที'], ok: 1 },
  { q: 'ขี่มอเตอร์ไซค์ต้องสวมอะไรทุกครั้ง', a: ['หมวกกันน็อก', 'แว่นกันแดด', 'ถุงมือ'], ok: 0 },
  { q: 'เห็นคนกำลังข้ามทางม้าลาย ควรทำอย่างไร', a: ['บีบแตรไล่', 'ขับอ้อมไป', 'หยุดรถให้คนข้าม'], ok: 2 },
  { q: 'ป้ายสีแดงแปดเหลี่ยมเขียนว่า หยุด หมายถึง', a: ['หยุดรถก่อนแล้วค่อยไป', 'ลดความเร็ว', 'ห้ามจอด'], ok: 0 },
  { q: 'ดื่มแอลกอฮอล์แล้วควรทำอย่างไร', a: ['ขับช้าๆ', 'ไม่ขับรถ', 'เปิดไฟฉุกเฉินแล้วขับ'], ok: 1 },
];
const POLICE_TEST = [
  { q: 'เจอคนถูกล้วงกระเป๋า ตำรวจควรทำอะไรก่อน', a: ['ไล่จับโจรทันที', 'ถามรายละเอียดและตำแหน่งที่เห็นล่าสุด', 'กลับสถานี'], ok: 1 },
  { q: 'หมายเลขแจ้งเหตุด่วนเหตุร้ายคือ', a: ['191', '1669', '199'], ok: 0 },
  { q: 'จับกุมผู้ต้องสงสัยได้เมื่อใด', a: ['เมื่อหน้าตาน่าสงสัย', 'เมื่อมีพยานหรือหลักฐานการกระทำผิด', 'ทุกเมื่อที่อยากจับ'], ok: 1 },
  { q: 'ตำรวจควรวางตัวกับประชาชนอย่างไร', a: ['สุภาพและช่วยเหลือ', 'ข่มขู่ให้กลัว', 'ไม่สนใจ'], ok: 0 },
  { q: 'ของกลางที่ยึดคืนได้จากโจร ควรทำอย่างไร', a: ['เก็บไว้เอง', 'แบ่งกับเพื่อน', 'คืนให้ผู้เสียหาย'], ok: 2 },
];
// changing careers too often makes you wait longer (minutes); index = changes in the last 24 h
const JOB_COOLDOWN_MIN = [0, 5];
const OFFICE_TITLES = ['พนักงานฝึกหัด', 'พนักงาน', 'พนักงานอาวุโส', 'หัวหน้าทีม', 'ผู้จัดการ', 'ผู้อำนวยการ', 'CEO'];
const OFFICE_WAGE = [55, 65, 78, 92, 110, 130, 155];            // per game hour seated
const RIDER = { baseFee: 25, perTile: 0.65, npcEvery: 55, tipMax: 30 };
// running: faster, costs energy per tile; you stop running when energy gets low
const RUN = { mul: 1.6, energyPerTile: 0.3, minEnergy: 5 };
const POLICE = { patrolWage: 24, bounty: 250, jailSec: 150, fineBase: 300, wantedMin: 6, outfitMin: 3, npcSpeed: 2.7 };   // outfitMin: thief outfit stays on after a pickpocket; npcSpeed: the NPC patrol (players walk at 3)
const HAPPY = { decay: 0.012, low: 20, crave: 22, donateMax: 25 };

const EVENTS = [
  { id: 'festival', text: '🎉 เทศกาลเมือง! ราคาอาหารและสินค้าในตลาดสูงขึ้น 20%' },
  { id: 'drought',  text: '☀️ ภัยแล้ง! พืชโตช้าลง แต่ราคาพืชผลพุ่ง 30%' },
  { id: 'rain',     text: '🌧️ ฝนตกชุก! พืชโตเร็วขึ้นเท่าตัว (ตากฝนนานๆ อาจเป็นไข้หวัด)' },
  { id: 'bloom',    text: '🐟 ปลาชุกชุม! ตกปลาได้ปลาใหญ่บ่อยขึ้น' },
  { id: 'flu',      text: '🦠 ไข้หวัดใหญ่ระบาด! ติดง่าย เลือดลดเร็ว รีบไปหาหมอ' },
  { id: 'hungry',   text: '🛵 ชาวเมืองสั่งอาหารเยอะ! ออเดอร์ไรเดอร์เพิ่มขึ้น ค่าส่ง +30%' },
];

// ================================================================= things to spend money on
const VEHICLES = {
  skate:  { name: 'สเก็ตบอร์ด', icon: '🛹', price: 2000,  speed: 1.15 },
  bike:   { name: 'จักรยาน', icon: '🚲', price: 6500,  speed: 1.3 },
  scooter:{ name: 'มอเตอร์ไซค์', icon: '🛵', price: 22000, speed: 1.5, license: 'driving' },
  car:    { name: 'รถยนต์', icon: '🚗', price: 75000, speed: 1.75, license: 'driving' },
};
const TOOL_PRICES = [4000, 15000, 50000];
const TOOLS = {
  office:   { name: 'ชุดสูทหรู', icon: '👔', fx: ['ค่าแรง +10%', 'ค่าแรง +20%', 'ค่าแรง +30%'] },
  farmer:   { name: 'จอบ & ปุ๋ย', icon: '🧪', fx: ['ผลผลิต +1, โตเร็วขึ้น 15%', 'ผลผลิต +2, โตเร็วขึ้น 30%', 'ผลผลิต +3, โตเร็วขึ้น 45%'] },
  fisher:   { name: 'อัปเกรดเบ็ดตกปลา', icon: '🎣', fx: ['ขยะน้อยลง, ปลาใหญ่บ่อยขึ้น', 'ขยะน้อยมาก, ปลาใหญ่บ่อยขึ้นมาก', 'แทบไม่เจอขยะ, ปลาใหญ่บ่อยสุด'] },
  merchant: { name: 'รถเข็นสินค้า', icon: '🛒', fx: ['ราคาส่งถูกลง 6%', 'ราคาส่งถูกลง 12%', 'ราคาส่งถูกลง 18%'] },
  chef:     { name: 'ชุดมีดเชฟ', icon: '🔪', fx: ['โอกาสได้อาหารเพิ่ม 20%', 'โอกาสได้อาหารเพิ่ม 40%', 'โอกาสได้อาหารเพิ่ม 60%'] },
  doctor:   { name: 'เครื่องมือแพทย์', icon: '🩺', fx: ['ค่ารักษา +15%', 'ค่ารักษา +30%', 'ค่ารักษา +50%'] },
  police:   { name: 'วิทยุสื่อสาร', icon: '📻', fx: ['เบี้ยเลี้ยง +15%', 'เบี้ยเลี้ยง +30%', 'เบี้ยเลี้ยง +50%'] },
  thief:    { name: 'ถุงมือล้วงกระเป๋า', icon: '🧤', fx: ['ล้วงสำเร็จง่ายขึ้น', 'ล้วงสำเร็จง่ายขึ้นมาก', 'ล้วงแทบไม่พลาด'] },
  beggar:   { name: 'ป้ายกระดาษซึ้งๆ', icon: '🪧', fx: ['คนให้เงินบ่อยขึ้น 15%', 'คนให้เงินบ่อยขึ้น 30%', 'คนให้เงินบ่อยขึ้น 50%'] },
  rider:    { name: 'กล่องเก็บความร้อน', icon: '📦', fx: ['ค่าส่ง +10%', 'ค่าส่ง +20%', 'ค่าส่ง +35%'] },
};
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
const BANK = { rate: 0.003, cap: 100000, loanMax: 8000, loanFee: 0.12, repayShare: 0.25 };

// ================================================================= health
const DISEASES = {
  cold:    { name: 'ไข้หวัด', icon: '🤒', cure: 'fever', drain: 0.05, income: 0.8, sym: ['ตัวร้อน มีไข้', 'ไอ จาม น้ำมูกไหล', 'หนาวสั่น'], cause: 'ตากฝนนานๆ อยู่ใกล้คนป่วย หรือช่วงไข้หวัดระบาด', self: 'หายเองไม่ได้ ต้องให้หมอรักษา' },
  flu:     { name: 'ไข้หวัดใหญ่', icon: '🦠', cure: 'antiviral', drain: 0.12, income: 0.7, hunger: 1.3, sym: ['ไข้สูง ปวดเมื่อยทั้งตัว', 'ไอแห้ง เจ็บคอ', 'อ่อนเพลียมาก'], cause: 'ช่วงไข้หวัดใหญ่ระบาด ติดต่อกันได้', self: 'อันตราย! เลือดลดเร็ว ต้องให้หมอรักษา' },
  exhaust: { name: 'อ่อนเพลียสะสม', icon: '😵', cure: 'iv', regen: 0.5, income: 0.85, drain: 0.02, sym: ['เหนื่อยง่าย หน้ามืด', 'กล้ามเนื้ออ่อนแรง', 'ใจสั่น'], cause: 'ทำงานตอนพลังงานต่ำ', self: 'นอนพักให้หายง่วงจะหาย หรือให้หมอรักษา' },
  insomnia:{ name: 'อดนอน', icon: '🥱', cure: 'sleep', income: 0.75, sym: ['ง่วงตลอดเวลา ตาลอย', 'สมาธิสั้น ทำงานพลาด', 'ปวดหัวตื้อๆ'], cause: 'ไม่ได้นอนนานเกิน 2 วันในเกม', self: 'นอนที่บ้าน หรือนั่งพักหลับตาจนหายง่วง' },
  poison:  { name: 'อาหารเป็นพิษ', icon: '🤢', cure: 'salt', drain: 0.08, hunger: 2, sym: ['ปวดท้อง คลื่นไส้', 'ท้องเสีย', 'อาเจียน'], cause: 'กินอาหารข้างทางหรือของดิบ', self: 'หายเองไม่ได้ ต้องให้หมอรักษา' },
  injury:  { name: 'บาดเจ็บ', icon: '🤕', cure: 'bandage', speed: 0.7, drain: 0.02, sym: ['ปวดบวม มีแผล', 'เดินกะเผลก', 'ช้ำตามตัว'], cause: 'อุบัติเหตุระหว่างทำงาน', self: 'ใช้ชุดปฐมพยาบาล หรือให้หมอรักษา' },
  malnut:  { name: 'ขาดสารอาหาร', icon: '😩', cure: 'iv', drain: 0.07, income: 0.8, sym: ['ผอมซีด ไม่มีแรง', 'หิวตลอดเวลา', 'เวียนหัว'], cause: 'ปล่อยให้หิวจนหมดหลอดนานๆ', self: 'กินจนอิ่มเกิน 80 จะหาย' },
};
const TREATMENTS = {
  fever:     { name: 'ยาลดไข้ + ให้พักผ่อน', icon: '💊' },
  antiviral: { name: 'ยาต้านไวรัส + แยกกักตัว', icon: '🧪' },
  iv:        { name: 'ให้น้ำเกลือ + วิตามิน', icon: '💉' },
  sleep:     { name: 'ยานอนหลับ + นอนพักฟื้น', icon: '😴' },
  salt:      { name: 'ผงเกลือแร่ + ยาฆ่าเชื้อ', icon: '🧂' },
  bandage:   { name: 'ทำแผล + เข้าเฝือก', icon: '🩹' },
};
const NPC_NAMES = ['ป้าสมศรี', 'ลุงมี', 'น้องเมย์', 'พี่ต้น', 'ยายจันทร์', 'ตาเหลือง', 'น้าแดง', 'พี่ฝน', 'น้องบอส', 'ป้าแจ๋ว', 'ลุงชัย', 'พี่นก'];

// ================================================================= achievements -> titles shown over your head
// ================================================================= looks (pixel character in public/assets/pchar.*, recoloured per player)
// everyone starts with the same brown hair; hair dye, shirts and shorts are bought at the fashion shop
const LOOKS = {
  hair:  { brown: { name: 'ผมสีน้ำตาล (เริ่มต้น)', price: 0, color: '#6e4528' }, black: { name: 'ย้อมผมดำ', price: 800, color: '#2e2622' },
           blonde: { name: 'ย้อมผมบลอนด์', price: 1200, color: '#e6bd55' }, ginger: { name: 'ย้อมผมส้มแดง', price: 1200, color: '#c0552d' },
           pink: { name: 'ย้อมผมชมพู', price: 1800, color: '#ec82b8' }, blue: { name: 'ย้อมผมน้ำเงิน', price: 1800, color: '#4f6fd6' }, silver: { name: 'ย้อมผมสีเงิน', price: 2200, color: '#d9dbe6' } },
  shirt: { white: { name: 'เสื้อยืดขาว', price: 300, color: '#ffffff' }, blue: { name: 'เสื้อยืดฟ้า', price: 300, color: '#5aa0e0' }, green: { name: 'เสื้อยืดเขียว', price: 300, color: '#7cc06a' },
           red: { name: 'เสื้อยืดแดง', price: 300, color: '#e0645a' }, yellow: { name: 'เสื้อยืดเหลือง', price: 400, color: '#f2c84b' }, pink: { name: 'เสื้อยืดชมพู', price: 400, color: '#f29ac0' },
           purple: { name: 'เสื้อยืดม่วง', price: 600, color: '#9a7ae0' }, black: { name: 'เสื้อยืดดำ', price: 600, color: '#45454f' } },
  pants: { gray: { name: 'กางเกงเทา (เริ่มต้น)', price: 0, color: '#bdbdbd' }, jeans: { name: 'กางเกงยีนส์', price: 400, color: '#5574b0' }, brown: { name: 'กางเกงน้ำตาล', price: 400, color: '#93613f' },
           black: { name: 'กางเกงดำ', price: 500, color: '#3d3d47' }, green: { name: 'กางเกงเขียวขี้ม้า', price: 500, color: '#6f8e4c' } },
};
const SHIRTS = ['white', 'blue', 'green', 'red'];       // starter choices
const NPC_LINES = ['วันนี้อากาศดีจังเลย', 'ตลาดวันนี้คนเยอะมาก', 'หิวจัง ไปกินก๋วยเตี๋ยวดีกว่า', 'ระวังโจรล้วงกระเป๋านะ', 'ได้ยินว่าที่ทะเลมีฉลามด้วย',
  'ค่าไฟเดือนนี้แพงจัง', 'ไปนั่งเล่นที่จัตุรัสกัน', 'หมอที่โรงพยาบาลเก่งมาก', 'อยากได้บ้านในหมู่บ้านจัดสรรจัง', 'ข้าวโพดปีนี้หวานมาก', 'สวัสดีจ้า', 'วันนี้ทำงานเหนื่อยมาก'];

// outfits you can wear instead of your job's clothes (rewards)
const OUTFITS = { fisher: { name: 'ชุดนักตกปลา', how: 'ตกปลาจนถึงเลเวลสูงสุด' } };
const ACHIEVEMENTS = [
  { id: 'off1', r: 1, c: 'office', stat: 'shifts', n: 3, title: 'มนุษย์เงินเดือน', desc: 'เข้างานครบ 3 วัน' },
  { id: 'off2', r: 2, c: 'office', stat: 'ontime', n: 10, title: 'ตรงต่อเวลา', desc: 'เข้างานตรงเวลา 10 วัน' },
  { id: 'off3', r: 3, c: 'office', stat: 'promo', n: 4, title: 'ผู้จัดการไฟแรง', desc: 'ได้เลื่อนตำแหน่ง 4 ครั้ง' },
  { id: 'far1', r: 1, c: 'farmer', stat: 'harvest', n: 15, title: 'มือใหม่หัดปลูก', desc: 'เก็บเกี่ยว 15 ครั้ง' },
  { id: 'far2', r: 3, c: 'farmer', stat: 'plots', n: 6, title: 'เจ้าของไร่', desc: 'ขยายสวนจนครบ 6 แปลง' },
  { id: 'far3', r: 3, c: 'farmer', stat: 'durian', n: 10, title: 'ราชาทุเรียน', desc: 'เก็บทุเรียน 10 ครั้ง' },
  { id: 'fis1', r: 1, c: null, stat: 'fish', n: 25, title: 'นักตกปลา', desc: 'ตกปลาได้ 25 ตัว' },
  { id: 'fis2', r: 4, c: null, stat: 'shark', n: 1, title: 'นักล่าฉลาม', desc: 'ตกฉลามได้' },
  { id: 'fis3', r: 5, c: null, stat: 'chest', n: 1, title: 'ผู้โชคดี', desc: 'ตกได้หีบสมบัติ' },
  { id: 'mer1', r: 1, c: 'merchant', stat: 'wholesale', n: 50, title: 'พ่อค้าหน้าใหม่', desc: 'ซื้อสินค้าจากคลัง 50 ชิ้น' },
  { id: 'mer2', r: 3, c: 'merchant', stat: 'psold', n: 100, title: 'เจ้าสัว', desc: 'ขายของให้ผู้เล่นอื่น 100 ชิ้น' },
  { id: 'che1', r: 2, c: 'chef', stat: 'cooked', n: 20, title: 'แม่ครัวหัวป่าก์', desc: 'ปรุงอาหาร 20 จาน' },
  { id: 'che2', r: 4, c: 'chef', stat: 'cooked', n: 100, title: 'เชฟกระทะเหล็ก', desc: 'ปรุงอาหาร 100 จาน' },
  { id: 'doc1', r: 2, c: 'doctor', stat: 'treated', n: 5, title: 'หมอใจดี', desc: 'รักษาคนไข้หาย 5 คน' },
  { id: 'doc2', r: 4, c: 'doctor', stat: 'treated', n: 50, title: 'หัตถ์เทวดา', desc: 'รักษาคนไข้หาย 50 คน' },
  { id: 'doc3', r: 3, c: 'doctor', stat: 'revived', n: 3, title: 'ผู้กู้ชีพ', desc: 'ช่วยชีวิตผู้เล่นที่หมดสติ 3 ครั้ง' },
  { id: 'rid1', r: 1, c: 'rider', stat: 'delivered', n: 10, title: 'ไรเดอร์สายฟ้า', desc: 'ส่งอาหารสำเร็จ 10 ออเดอร์' },
  { id: 'rid2', r: 3, c: 'rider', stat: 'delivered', n: 60, title: 'ขาซิ่งประจำเมือง', desc: 'ส่งอาหารสำเร็จ 60 ออเดอร์' },
  { id: 'pol1', r: 2, c: 'police', stat: 'arrests', n: 3, title: 'มือปราบ', desc: 'จับโจรได้ 3 ครั้ง' },
  { id: 'pol2', r: 4, c: 'police', stat: 'arrests', n: 20, title: 'ผู้พิทักษ์เมือง', desc: 'จับโจรได้ 20 ครั้ง' },
  { id: 'thi1', r: 2, c: null, stat: 'stolen', n: 10, title: 'มือไว', desc: 'ล้วงกระเป๋าสำเร็จ 10 ครั้ง' },
  { id: 'thi2', r: 4, c: null, stat: 'stolen', n: 50, title: 'จอมโจรเงา', desc: 'ล้วงกระเป๋าสำเร็จ 50 ครั้ง' },
  { id: 'beg1', r: 1, c: 'beggar', stat: 'alms', n: 20, title: 'ผู้ยากไร้', desc: 'ได้รับเงินบริจาค 20 ครั้ง' },
  { id: 'gen5', r: 1, c: null, stat: 'donated', n: 5, title: 'ใจบุญ', desc: 'บริจาคให้ขอทาน 5 ครั้ง' },
  { id: 'gen6', r: 2, c: null, stat: 'cravings', n: 10, title: 'นักชิม', desc: 'กินของที่อยากกินได้ทันเวลา 10 ครั้ง' },
  { id: 'gen1', r: 1, c: null, stat: 'trades', n: 5, title: 'นักเจรจา', desc: 'แลกเปลี่ยนกับผู้เล่นอื่น 5 ครั้ง' },
  { id: 'gen2', r: 3, c: null, stat: 'worth', n: 100000, title: 'เศรษฐีใหม่', desc: 'มีทรัพย์สินรวม ฿100,000' },
  { id: 'gen3', r: 1, c: null, stat: 'calls', n: 5, title: 'สายโทรศัพท์', desc: 'โทรคุยกับเพื่อน 5 ครั้ง' },
  { id: 'gen4', r: 3, c: null, stat: 'degree', n: 1, title: 'บัณฑิต', desc: 'เรียนจบปริญญาตรี' },
  { id: 'fis4', r: 4, c: null, stat: 'fish', n: 300, title: 'เจ้าแห่งท้องน้ำ', desc: 'ตกปลาได้ 300 ตัว' },
  { id: 'fis6', r: 5, c: null, stat: 'shark', n: 10, title: 'ราชาฉลาม', desc: 'ตกฉลามได้ 10 ตัว' },
  { id: 'far4', r: 4, c: 'farmer', stat: 'harvest', n: 200, title: 'เทพเกษตร', desc: 'เก็บเกี่ยว 200 ครั้ง' },
  { id: 'che3', r: 5, c: 'chef', stat: 'cooked', n: 500, title: 'ยอดเชฟแห่งเมือง', desc: 'ปรุงอาหาร 500 จาน' },
  { id: 'doc4', r: 5, c: 'doctor', stat: 'treated', n: 200, title: 'แพทย์ในตำนาน', desc: 'รักษาคนไข้หาย 200 คน' },
  { id: 'rid3', r: 5, c: 'rider', stat: 'delivered', n: 300, title: 'ตำนานไรเดอร์', desc: 'ส่งอาหารสำเร็จ 300 ออเดอร์' },
  { id: 'pol3', r: 5, c: 'police', stat: 'arrests', n: 100, title: 'ผู้บัญชาการ', desc: 'จับโจรได้ 100 ครั้ง' },
  { id: 'thi3', r: 5, c: null, stat: 'stolen', n: 200, title: 'ราชันย์โจร', desc: 'ล้วงกระเป๋าสำเร็จ 200 ครั้ง' },
  { id: 'beg2', r: 3, c: 'beggar', stat: 'alms', n: 200, title: 'ขอทานพันล้าน', desc: 'ได้รับเงินบริจาค 200 ครั้ง' },
  { id: 'gen7', r: 5, c: null, stat: 'worth', n: 1000000, title: 'มหาเศรษฐี', desc: 'มีทรัพย์สินรวม ฿1,000,000' },
  { id: 'gen8', r: 3, c: null, stat: 'trades', n: 50, title: 'นักค้าขายตัวยง', desc: 'แลกเปลี่ยนกับผู้เล่นอื่น 50 ครั้ง' },
  { id: 'gen9', r: 4, c: null, stat: 'donated', n: 50, title: 'นักบุญแห่งเมือง', desc: 'บริจาคให้ขอทาน 50 ครั้ง' },
  { id: 'gen10', r: 2, c: null, stat: 'calls', n: 50, title: 'คนช่างคุย', desc: 'โทรคุยกับเพื่อน 50 ครั้ง' },
  { id: 'gen11', r: 3, c: null, stat: 'cravings', n: 50, title: 'นักชิมระดับมิชลิน', desc: 'กินของที่อยากกินได้ทันเวลา 50 ครั้ง' },
  { id: 'gen12', r: 2, c: null, stat: 'mails', n: 10, title: 'นักเขียนจดหมาย', desc: 'ส่งจดหมายถึงผู้เล่นอื่น 10 ฉบับ' },
];
// title rarity: common → legendary (colour on the name tag)
const RARITY = [null, { name: 'ธรรมดา', col: '#e8e8e8' }, { name: 'ไม่ธรรมดา', col: '#7be07b' }, { name: 'หายาก', col: '#62b8ff' }, { name: 'มหากาพย์', col: '#d08cff' }, { name: 'ตำนาน', col: '#ffb43c' }];

// ================================================================= job staff: an NPC at every place that hires (and the rod seller)
// Each gets its own talk spot next to the place's counter, so talking to staff and using the place are separate.
{
  const near = (s, x, y) => STATIONS.some(o => o !== s && o.area === s.area && Math.hypot(o.x - x, o.y - y) < 1.7);
  const spots = [[2.6, 0], [-2.6, 0], [2.6, 1.2], [-2.6, 1.2], [3.2, -1], [-3.2, -1], [0, 2.2], [3.4, 2], [-3.4, 2], [1.6, 2.4], [-1.6, 2.4]];
  const want = [...Object.entries(CAREERS).filter(([, c]) => c.where).map(([k, c]) => [k, c.where]), ['fishing', 'fishclub']];
  for (const [key, where] of want) {
    const s = STATIONS.find(x => x.id === where); if (!s) continue;
    const ok = spots.map(([dx, dy]) => [s.x + dx, s.y + dy]).find(([x, y]) => areaAt(x, y)?.id === s.area && !blocked(x, y, 0.36) && !near(s, x, y)) || [s.x + 1.5, s.y];
    STATIONS.push({ id: 'staff_' + key, type: 'staff', career: key, at: where, label: 'เจ้าหน้าที่', icon: '💬', x: ok[0], y: ok[1], r: 1.3, area: s.area });
  }
}

module.exports = {
  RUN, CLOCK, gameRate, DOCTOR, FISHING, OUTFITS,
  LOOKS, SHIRTS, NPC_LINES, MONTH_DAYS, MONTHS, monthIdx, dateAt, UTIL, POLICE_TEST, POLICE, HAPPY,
  W, H, TILES, AREAS, ROOMS, BUILDINGS, STATIONS, PROPS, TREES, LOTS, GARDEN, GATES, SPAWN, RADIUS, SOLID,
  areaAt, roomAt, blocked, DAY_MS, TIME_OFF, hourAt, dayAt, HOURS, isOpen, SHIFT,
  RARITY, ITEMS, CATEGORIES, CROPS, RECIPES, FISH, BIG_FISH, CAREERS, LICENSES, DRIVING_TEST, JOB_COOLDOWN_MIN, OFFICE_TITLES, OFFICE_WAGE, RIDER, EVENTS,
  VEHICLES, TOOLS, TOOL_PRICES, HOUSE_PRICES, HOUSE_RENT, FURNITURE, BANK, DISEASES, TREATMENTS, NPC_NAMES, ACHIEVEMENTS,
};
