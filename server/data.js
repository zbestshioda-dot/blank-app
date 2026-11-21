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
const PARK = { id: 'park', kind: 'map', name: 'สวนสนุก', x: 112, y: 52, w: 40, h: 28 };   // compact: every ride a short walk from the gate   // added later, in the free space under the farm (nothing older moves)
const FIELD = { id: 'field', kind: 'map', name: 'สนามฟุตบอล', x: 112, y: 0, w: 30, h: 23 };   // ⚽ the public football ground, where the old farm used to be
const TEMPLE = { id: 'temple', kind: 'map', name: 'วัดเมืองชีวิต', x: 184, y: 52, w: 44, h: 32 };   // the temple grounds, under the housing estate
const RX0 = 256;                                         // interiors start here
const YX0 = RX0 + 10 * 18 + 4;                           // home yards (one per house) start here: 4 per row
const W = YX0 + 4 * 34, H = 90;                          // 6 columns of interiors + 4 columns of upstairs floors (house expansions) + the yards

// ---------------------------------------------------------------- grid helpers
// tile codes: . grass  = road  , sidewalk  c cobble path  k plaza bricks  w water  p pier/bridge
//             s sand  m meadow  f soil  B building  T tree  o solid prop  g solid prop on grass (drawn as grass)  # wall  i floor  D door mat  ' ' void
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
let CS;   // adds a convenience-store branch (defined with the town)
const prop = (s, x, y, solid = true) => { PROPS.push({ s, x, y }); if (solid) set(Math.floor(x), Math.floor(y - 0.5), solid === 'grass' ? 'g' : 'o'); };
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
  rect(49, 78, 2, 11, '=');                                                           // the main road runs on south, out to the amusement park
  rect(14, 14, 74, 2, '='); rect(14, 13, 74, 1, ',');                                 // north street
  rect(49, 40, 2, 36, '=');                                                           // south avenue
  rect(4, 46, 45, 2, '='); rect(4, 45, 45, 1, ',');                                   // south-west lane
  rect(49, 76, 2, 2, '=');                                                            // corner: avenue -> south road
  rect(14, 16, 74, 1, ','); rect(4, 48, 45, 1, ',');                                   // sidewalks on the far side of the north street and the south-west lane
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

  // ---- districts: shopping street by the square (west main road), civic street (north), services lane (south-west),
  // health & business (east main road), the waterfront by the lake. Declaration order is kept: rooms are laid out in this order.
  B('toolshop', 'b_toolshop', 28, 45, { label: 'ร้านอุปกรณ์', icon: '🛠️', st: 'toolshop' });
  B('dealer', 'b_showroom', 35, 45, { label: 'โชว์รูมรถ', icon: '🚗', st: 'dealer' });
  B('school', 'b_school2', 34, 13, { label: 'มหาวิทยาลัย', icon: '🎓', st: 'school' });
  B('bank', 'b_bank2', 43, 13, { label: 'ธนาคาร', icon: '🏦', st: 'bank' });
  // east main road, north side
  B('market', 'b_market2', 60, 30, { label: 'ตลาดกลาง', icon: '🏪', st: 'market', outdoor: true });   // an open stall: trade right at the counter, no interior
  B('hospital', 'b_hospital2', 68, 30, { label: 'โรงพยาบาล', icon: '🏥', st: 'hospital' });
  pathDown(B('office', 'b_tower', 79, 28, { label: 'บริษัท ไทยเทค', icon: '🏢', st: 'office' }), 30);
  B('flower', 'b_flower2', 13, 30, { label: 'ร้านต้นไม้', icon: '🌳', st: 'plantshop', rk: 'plantshop', layout: 'plantshop', late: 3 });   // walk-in plant nursery (its room is laid out last, so no older room moves)
  // north street: the civic street
  B('police', 'b_police2', 18, 13, { label: 'สถานีตำรวจ', icon: '👮', st: 'police' });
  B('fire', 'b_fire2', 26, 13, { label: 'สถานีดับเพลิง', icon: '🚒', deco: true, renov: true });
  B('furnshop', 'b_furnshop', 27, 30, { label: 'ร้านเฟอร์นิเจอร์', icon: '🛋️', st: 'furnshop', late: 2 });   // walk-in showroom (its room is laid out after the convenience stores)
  B('barber', 'b_salon', 35, 30, { label: 'ร้านทำผม', icon: '💈', st: 'barber', late: 2 });   // walk-in salon
  B('inn', 'b_library', 58, 13, { label: 'ห้องสมุดเมือง', icon: '📚', deco: true, renov: true });
  // south-west lane: services and trade (doors on row 45)
  B('warehouse', 'b_factory', 5, 45, { label: 'โรงประมูล (คลังสินค้า)', icon: '🔨', st: 'warehouse' });
  B('restaurant', 'b_cafe2', 20, 30, { label: 'ร้านอาหาร', icon: '🍜', st: 'restaurant' });
  B('kitchen', 'b_kitchen', 13, 45, { label: 'ครัวใหญ่', icon: '🍳', st: 'kitchen' });
  B('rider', 'b_rider2', 20, 45, { label: 'ศูนย์ไรเดอร์', icon: '🛵', st: 'rider' });
  B('fishhut', 'b_stilthouse', 31, 55, { label: 'สมาคมประมง', icon: '🎣', deco: true });
  B('fishstall', 'b_fishstall', 24, 55, { label: 'ร้านขายปลา', icon: '🐟', deco: true });      // the club's fish counter         // the fishing club's hut by the lake
  B('fruitstall', 'b_market', 72, 39, { label: '', icon: '🍎', deco: true });                // a fruit stall in the east park
  B('fashion', 'b_boutique', 6, 30, { label: 'ร้านแฟชั่น', icon: '👕', st: 'fashion' });

  // villagers' homes scattered around town (scenery) so it reads as a lived-in village
  const HS = ['h_cottage1', 'h_gable_red', 'h_cottage3', 'h_cottage2', 'h_gable_blue', 'h_cottage4'];
  [[54, 76], [61, 75], [68, 76], [76, 75], [83, 76], [3, 13], [8, 12], [12, 85], [20, 85], [30, 85], [70, 85], [80, 85]].forEach(([x, f], i) => {
    if (i === 5 || i === 6) return;                     // the two homes in the north-west corner made way for pet shop branch 2
    const b = B('vh' + i, HS[i % 6], x, f, { label: '', icon: '🏡', deco: true });
    pathDown(b, f + 1);
    prop(i % 2 ? 'flowerbox' : 'hedge', x + (i % 2 ? 4.5 : -0.8), f + .02, false);
  });
  rect(52, 85, 40, 2, 'c'); rect(8, 85, 30, 2, 'c'); rect(37, 78, 2, 9, 'c'); rect(38, 78, 12, 2, 'c'); rect(60, 78, 2, 7, 'c');
  // empty lots kept for careers added later
  // 24-hour convenience stores: four branches, each with its own look and its own interior (rooms laid out after all older rooms: late)
  CS = (id, spr, x, front, name, extra = {}) => B(id, spr, x, front, { label: `ร้านสะดวกซื้อ 24 ชม. · ${name}`, icon: '🏪', st: id, stype: 'cstore', rk: 'cstore', layout: id, late: true, ...extra });
  CS('cstore', 'b_cs1', 72, 13, 'สาขาถนนเหนือ');
  CS('cstore2', 'b_cs2', 81, 13, 'สาขาหัวมุม');
  CS('cstore3', 'b_cs3', 42, 45, 'สาขาซอยใต้');
  B('gas', 'b_gas', 65, 13, { label: 'ปั๊มน้ำมัน', icon: '⛽', deco: true });   // scenery (no vehicles in the game)

  // town square (the first thing a new player sees): a paved cross of walkways meeting at the fountain, four fenced
  // garden lawns in the corners (white picket fence on the outside, flowering hedges facing the plaza), shade trees,
  // lamps at the plaza corners, benches facing the fountain
  prop('o_fountain', 50, 33.6);
  rect(48, 32, 4, 2, 'o');
  for (const [x0, y0, h] of [[42, 24, 5], [53, 24, 5], [42, 36, 4], [53, 36, 4]]) rect(x0, y0, 5, h, '.');   // the four lawns
  fenceRow('fence_white', 42, 47, 24.95); fenceRow('fence_white', 53, 58, 24.95);           // picket fence along the outer edges
  fenceRow('fence_white', 42, 47, 39.95); fenceRow('fence_white', 53, 58, 39.95);
  fenceRow('hedge_flower', 42, 47, 28.95); fenceRow('hedge_flower', 53, 58, 28.95);          // flowering hedges facing the plaza
  fenceRow('hedge_flower', 42, 47, 36.95); fenceRow('hedge_flower', 53, 58, 36.95);
  for (const x of [46.4, 53.6]) { prop('o_hedgecube', x, 26.95); prop('o_hedgecube', x, 27.95); prop('o_hedgecube', x, 38.95); }   // hedge posts down the walkway side
  for (const x of [42.5, 57.5]) { prop('bush', x, 26.4); prop('bush2', x, 27.95); prop('bush2', x, 38.95); }                         // bushes along the street side
  prop('tree_pink', 44.5, 27.6); prop('tree_oak', 55.5, 27.6);                                 // shade trees in the north lawns
  prop('o_roses', 43.6, 25.95, false); prop('o_tulips', 45.4, 25.95, false); prop('o_tulips', 54.6, 25.95, false); prop('o_roses', 56.4, 25.95, false);
  prop('o_flowerbed', 44.6, 38.6); prop('o_flowerbed', 55.4, 38.6);                           // flower beds in the south lawns
  prop('o_topiary', 46.4, 37.95, false); prop('o_topiary', 53.6, 37.95, false);
  // the plaza: lamps at its four corners, benches facing the fountain, planters at the walkway mouths
  for (const [x, y] of [[47.3, 29.95], [52.7, 29.95], [47.3, 35.95], [52.7, 35.95]]) prop('o_lamp', x, y);
  // benches sit against the lawn hedges on both sides, off the walkways (the first keeps its old id: quests and the map point at it)
  for (const [id, x, y, s] of [['seatb43.6', 44.6, 29.95, 'o_bench'], ['seatbNE', 55.4, 29.95, 'o_bench'], ['seatbSW', 44.6, 35.95, 'o_stonebench'], ['seatbSE', 55.4, 35.95, 'o_stonebench']]) {
    prop(s, x, y, false); STATIONS.push({ id, type: 'seat', label: 'ม้านั่ง', icon: '🪑', x, y: y - .25, r: 1.1, area: 'town' });
  }
  prop('o_lplanter', 47.4, 31.4, false); prop('o_lplanter', 52.6, 31.4, false);   // walk-through: players kept getting stuck on them
  prop('o_drinkfount', 57.4, 30.95); prop('o_bin_green', 42.6, 34.95);
  prop('o_noticeboard', 47.9, 25.6);
  STATIONS.push({ id: 'square', type: 'square', label: 'ศาลาประชาคม', icon: '📋', x: 47.9, y: 26.4, r: 1.4, area: 'town' });
  prop('o_bin', 41.4, 12.2);   // the barber shop stands where a barrel and a crate used to be
  // street furniture
  for (let x = 6; x < 40; x += 9) prop('o_lamp', x + .5, 34.95, 'grass');   // street lamps stand on the verge behind the sidewalk, clear of the road and the footpath
  // street trees on the grass verge behind the sidewalk, between the lamps
  const verge = (y, x0, x1) => { for (let x = x0; x < x1; x += 9) if (get(x, y) === '.' && get(x, y - 1) !== '=' && !BUILDINGS.some(b => x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h + 1)) prop(['tree2', 'tree3', 'tree4', 'tree'][(x >> 3) % 4], x + .5, y + .95); };
  verge(35, 9, 40); verge(35, 65, 92); verge(18, 20, 46); verge(18, 56, 86); verge(50, 10, 46);
  for (let x = 62; x < 92; x += 9) prop('o_lamp', x === 89 ? 90.6 : x + .5, 34.95, 'grass');
  for (const x of [16, 25, 34, 61, 70, 79, 88]) prop('o_lampball', x, 17.95, 'grass');   // between the verge trees so their crowns don't hide them
  prop('o_shelter2', 38.5, 35.2); prop('o_bikerack', 35.6, 35.9, false); prop('vending', 41.2, 29.9);
  for (const [x, y] of [[48.4, 13.95], [51.6, 13.95], [51.6, 16.95], [96.4, 30.95], [92.6, 33.95], [51.6, 75.0], [48.6, 78.95]]) prop('trafficlight', x, y); prop('postbox', 10, 33.95); prop('o_hydrant', 65.5, 33.95); prop('o_hydrant', 28, 33.95);
  prop('o_phonebooth', 57.3, 23.9); prop('o_bin_blue', 33.8, 29.95); prop('o_bin_green', 75, 33.95); prop('o_bin', 12.2, 33.95);
  // (no parked cars: real traffic drives the roads now)
  // parks, the lake and the beach
  prop('flowerbed', 61.5, 41.2, false); prop('flowerbed2', 70.5, 45.2, false); prop('flowerbox', 59.6, 47.5); prop('bench2', 80.5, 41.2, false); prop('flowerbed', 87.6, 47.2, false);
  prop('b_pavilion', 66, 44);
  // the east park: a rose arch over the path in, a fountain lawn, statues, lanterns by the pond, a playground and café tables by the fruit stall
  prop('o_rosearch', 65, 39.95, false); prop('o_rosearch', 85, 43.95, false);
  prop('o_fountain2', 59, 53.9); rect(58, 52, 3, 2, 'o'); prop('o_topiary', 56.4, 54); prop('o_topiary', 61.6, 54); prop('o_bench', 59, 56.9, false);
  prop('o_birdstatue', 70, 48.9); prop('o_catstatue', 76.4, 45.4); prop('o_lantern', 72.4, 50.9); prop('o_lantern', 87.6, 50.9); prop('o_lantern', 75, 59.9);
  prop('o_slide', 76, 63.9); rect(75, 63, 3, 1, 'o'); prop('o_hedgering', 79.6, 63.9); prop('o_topiary', 79.6, 63.2, false); prop('o_stonebench', 72.4, 63.9, false); prop('o_lampball', 74, 62.4); prop('o_potflower', 70.8, 63.8);
  prop('o_parasol', 69, 41.3); prop('o_parasol2', 79, 41.3); prop('o_pergola', 89, 44.95, false); prop('o_woodtable', 89, 44.5);
  prop('o_planter', 54, 40.9, false); prop('bench', 72, 47, false); prop('bench2', 86, 59.3, false); prop('pond', 64, 60.2);
  // the beach: umbrellas with loungers, palms, rocks at the waterline, a lifebuoy stand by the pier
  for (const [y, k] of [[20, 0], [27, 1], [35, 0], [44, 1], [55, 0], [67, 1], [74, 0], [83, 1]]) { prop(k ? 'parasol2' : 'parasol', 99.2, y); prop('deckchair', 98.3, y + 1.6); }
  for (const y of [16, 31, 49, 64, 79, 87]) prop(y % 2 ? 'palm_small' : 'palm', 98.2, y);
  for (const y of [24, 41, 58, 71, 85]) prop('rock', 100.8, y);
  prop('i_ball', 100.2, 37.6, false); prop('i_lantern', 96.6, 61.2, false); prop('bench2', 98.6, 59.2, false);
  prop('parasol', 99, 30); prop('parasol2', 99, 40); prop('deckchair', 98.6, 46); prop('deckchair', 99.8, 46); prop('palm', 98.7, 22); prop('palm_small', 98.5, 52); prop('palm', 99, 70);
  prop('foodtruck', 89, 74.6); prop('tent', 60, 70); prop('campfire', 63, 70.5, false);
  prop('o_flowercart', 18.5, 29.95, false);
  prop('crate', 20.6, 55.5); prop('barrel', 29.5, 55.5);   // the kiosk was removed: the fish stall stands in its place
  prop('cartstall', 41, 55);

  // where the gates and fishing spots are
  STATIONS.push({ id: 'wish', type: 'wish', label: 'โยนเหรียญ ฿10', icon: '⛲', x: 50, y: 34.7, r: 1.4, area: 'town' });
  // five little signs in corners nobody walks to
  [[67, 25.3], [1.6, 38.5], [1.6, 87.6], [92.5, 1.6], [98, 88]].forEach(([x, y], n) => { prop('signpost', x, y - .15, false); STATIONS.push({ id: 'secret' + n, type: 'secret', n, label: 'ป้ายเล็กๆ', icon: '🪧', x, y: y + .1, r: .9, area: 'town' }); });
  STATIONS.push({ id: 'fishclub', type: 'fishclub', label: 'สมาคมประมง · ร้านขายปลา', icon: '🎣', x: 26.5, y: 55.4, r: 1.6, area: 'town' });
  STATIONS.push({ id: 'pier_l1', type: 'fishspot', pool: 'lake', label: 'ท่าตกปลา (ทะเลสาบ)', icon: '🎣', x: 21, y: 62.2, r: 1.8, area: 'town' });
  STATIONS.push({ id: 'pier_l2', type: 'fishspot', pool: 'lake', label: 'ท่าตกปลา (ทะเลสาบ)', icon: '🎣', x: 32, y: 62.2, r: 1.8, area: 'town' });
  STATIONS.push({ id: 'pier_s1', type: 'fishspot', pool: 'sea', label: 'สะพานปลา (ทะเล)', icon: '🎣', x: 105, y: 61, r: 1.8, area: 'town' });
  STATIONS.push({ id: 'pier_s2', type: 'fishspot', pool: 'sea', label: 'ริมหาด (ทะเล)', icon: '🎣', x: 101.2, y: 38, r: 1.6, area: 'town' });
  STATIONS.push({ id: 'pier_p', type: 'fishspot', pool: 'lake', label: 'บ่อตกปลา', icon: '🎣', x: 80, y: 49.2, r: 1.6, area: 'town' });
  STATIONS.push({ id: 'guide', type: 'guide', label: 'จุดแนะนำเมือง', icon: '💁', x: 54.5, y: 35.2, r: 1.4, area: 'town' });   // the town guide by the fountain (talking is all on the client)
  STATIONS.push({ id: 'gate_farm', type: 'gate', to: 'farm_in', label: 'ไปไร่ชานเมือง', icon: '🌾', x: 3, y: 32, r: 1.6, area: 'town', renov: true });   // the farm is closed for renovation
  STATIONS.push({ id: 'gate_housing', type: 'gate', to: 'housing_in', label: 'ไปหมู่บ้านจัดสรร', icon: '🏘️', x: 50, y: 5, r: 1.6, area: 'town' });
  prop('sign_walk', 4.6, 30.3); prop('signpost', 52.8, 7.4);
  STATIONS.push({ id: 'note_housing', type: 'note', label: 'ป้ายบอกทาง', icon: '🪧', x: 52.8, y: 7.55, r: .9, area: 'town', text: '⬆️ ทางนี้ไปหมู่บ้านจัดสรร 🏘️ ยินดีต้อนรับจ้า' });   // looks like the secret signs, so it reads too
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
  STATIONS.push({ id: 'pier_r1', type: 'fishspot', pool: 'river', label: 'ท่าตกปลา (แม่น้ำ)', icon: '🎣', x: X + 21, y: 43.3, r: 1.8, area: 'farm' });
  STATIONS.push({ id: 'pier_r2', type: 'fishspot', pool: 'river', label: 'ท่าตกปลา (แม่น้ำ)', icon: '🎣', x: X + 49, y: 43.3, r: 1.8, area: 'farm' });
  STATIONS.push({ id: 'gate_town_f', type: 'gate', to: 'town_from_farm', label: 'กลับเข้าเมือง', icon: '🏙️', x: X + 66.5, y: 25, r: 1.6, area: 'farm' });
  prop('signpost', X + 65, 23.3);
}

// ================================================================= HOUSING (houses to buy / rent)
const HOUSE_SPRITES = ['h_cottage1', 'h_gable_red', 'h_cottage3', 'h_cottage2', 'h_gable_blue', 'h_cottage4'];
const HOUSE_PRICES = [], HOUSE_RENT = [];
// homes belong to players, not to the plots: buy one from the estate agent and it stands on a free plot of the village
// while you are online (the village is made of the homes of whoever is around). Tiers decide the starting floors / yard.
const HOME_TIERS = [
  { name: 'บ้านเล็ก', icon: '🏠', price: 20000, floors: 0, zones: 0, desc: 'บ้านชั้นเดียว สวนหน้าบ้าน แปลงผัก 2 แปลง · ต่อเติมทีหลังได้' },
  { name: 'บ้านกลาง', icon: '🏡', price: 65000, floors: 1, zones: 1, desc: 'บ้าน 2 ชั้น + ขยายสวนให้แล้ว 1 โซน' },
  { name: 'บ้านใหญ่', icon: '🏘️', price: 160000, floors: 2, zones: 2, desc: 'บ้าน 3 ชั้นเต็ม + ขยายสวนให้แล้ว 2 โซน' },
];
// house interiors: floor and wallpaper styles bought at the furniture shop, chosen per storey in the home menu (the first of each is free)
const HOME_FLOORS = {
  fl_wood: { name: 'พื้นไม้สัก', price: 0 }, fl_beige: { name: 'กระเบื้องครีม', price: 2500 }, fl_white: { name: 'กระเบื้องขาว', price: 2500 }, fl_tatami: { name: 'เสื่อทาทามิ', price: 3500 },
  fl_mint: { name: 'กระเบื้องมิ้นท์', price: 3500 }, fl_checker: { name: 'ลายหมากรุก', price: 4500 }, fl_bluecheck: { name: 'ตารางฟ้า', price: 4500 }, fl_carpet_blue: { name: 'พรมน้ำเงิน', price: 6000 },
  fl_stone: { name: 'หินธรรมชาติ', price: 7000 }, fl_concrete: { name: 'ปูนขัดมันลอฟท์', price: 7000 }, fl_marble: { name: 'หินอ่อนหรู', price: 15000 } };
const HOME_WALLS = {
  cream: { name: 'ครีมอบอุ่น', c: '#ecd2b2', price: 0 }, white: { name: 'ขาวมินิมอล', c: '#f1efe9', price: 1500 }, pink: { name: 'ชมพูพาสเทล', c: '#f6d6e4', price: 2500 },
  sky: { name: 'ฟ้าสดใส', c: '#c9def0', price: 2500 }, mint: { name: 'เขียวมิ้นท์', c: '#cfe8d8', price: 2500 }, lemon: { name: 'เหลืองมะนาว', c: '#f6ecb0', price: 2500 },
  lilac: { name: 'ม่วงลาเวนเดอร์', c: '#ddd0ee', price: 3000 }, sage: { name: 'เขียวเสจ', c: '#b9c9a4', price: 3000 }, plank: { name: 'ไม้ระแนง', c: '#a87a52', price: 5000, pat: 'plank' },
  brick: { name: 'อิฐแดงลอฟท์', c: '#b5654a', price: 5000, pat: 'brick' }, navy: { name: 'กรมท่าหรู', c: '#3c4a6b', price: 6000 }, gold: { name: 'ทองหรูหรา', c: '#e2c37a', price: 15000, pat: 'damask' } };
const HOME_STYLES = [['h_cottage1', 'กระท่อมไม้'], ['h_gable_red', 'หลังคาจั่วแดง'], ['h_cottage3', 'บ้านสวนอิฐ'], ['h_cottage2', 'บ้านหลังคาเขียว'], ['h_gable_blue', 'หลังคาจั่วฟ้า'], ['h_cottage4', 'บ้านพาสเทล']];
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
  prop('o_fountain', X + 35, 30.4); rect(X + 33, 29, 4, 2, 'o');
  prop('o_bench', X + 29, 27, false); prop('o_bench', X + 41, 27, false); prop('o_tulips', X + 31.6, 26.9); prop('o_tulips', X + 38.4, 26.9); prop('o_lampball', X + 27, 26.9); prop('o_lampball', X + 43, 26.9); prop('tree_pink', X + 27.5, 31.6); prop('tree_pink', X + 42.5, 31.6);
  CS('cstore4', 'b_cs4', X + 2, 20, 'สาขาหมู่บ้าน', { area: 'housing' });
  prop('kiosk', X + 3.5, 30); STATIONS.push({ id: 'estate', type: 'estate', label: 'สำนักงานอสังหาฯ', icon: '🏡', x: X + 3.5, y: 30.7, r: 1.5, area: 'housing' });
  STATIONS.push({ id: 'gate_town_h', type: 'gate', to: 'town_from_housing', label: 'กลับเข้าเมือง', icon: '🏙️', x: X + 3, y: 22, r: 1.6, area: 'housing' });
  fenceRow('fence_white', X + 8, X + 62, 16.95); fenceRow('fence_white', X + 9, X + 62, 33.95);   // back gardens
  for (const y of [24.95, 32.95]) { fenceRow('fence_iron', X + 25, X + 33.3, y); fenceRow('fence_iron', X + 36.7, X + 45, y); prop('gate_iron', X + 33.8, y, false); prop('gate_iron', X + 36.2, y, false); }
  for (let y = 25; y <= 32; y++) { prop('fence_post', X + 25.4, y + .95); prop('fence_post', X + 44.6, y + .95); }
  for (const [x, y] of [[X + 15, 45], [X + 55, 45]]) STATIONS.push({ id: 'seat_h' + x, type: 'seat', label: 'ม้านั่งในสวน', icon: '🪑', x, y: y - .25, r: 1.1, area: 'housing' }), prop('o_bench', x, y, false);
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
scatter(TOWN, ['tuft'], 10, true);                     // the town stays tidy: no junk lying around in the grass
scatter(FARM, ['wheelbarrow', 'hay', 'crate_apple', 'firewood', 'ladder', 'barrel', 'hose', 'o_tap', 'crate', 'rock'], 14);
scatter(FARM, ['tuft'], 10, true);
scatter(HOUSING, ['gnome', 'o_potflower', 'flowerbox', 'o_birdstatue', 'o_roses', 'o_cactus', 'o_catstatue', 'gnome2', 'o_bowlpot', 'o_fountain3', 'o_topiary', 'hose'], 16);
scatter(HOUSING, ['tuft'], 8, true);
// manholes on the main roads, a news box and bollards by the square
for (const [x, y] of [[50, 52], [50, 66], [30, 47], [70, 15], [25, 15], [50, 10]]) if (get(Math.floor(x), Math.floor(y - .5)) === '=') prop('manhole', x, y, false);
prop('o_newsbox', 57.6, 35.9); prop('o_bollard', 47.6, 39.95); prop('o_bollard', 52.4, 39.95);
// A-frame signs by the doors of open shops, produce on the market stall, a lantern at the fishing club
for (const id of ['restaurant', 'fashion', 'toolshop', 'rider', 'kitchen']) { const b = BUILDINGS.find(x => x.id === id); if (b) prop('i_shopsign', b.x + b.w - .2, b.y + b.h + .05, false); }
// neon OPEN signs hung beside the doors (lit only while the shop is open), and a cake on show outside the restaurant
for (const id of ['restaurant', 'fashion', 'toolshop', 'rider', 'kitchen', 'bank']) { const b = BUILDINGS.find(x => x.id === id); if (b) PROPS.push({ s: 'i_open', x: b.x + .7, y: b.y + b.h + .02, z: 1.3, open: id }); }
{ const r = BUILDINGS.find(x => x.id === 'restaurant'); if (r) prop('i_cake', r.x + .5, r.y + r.h + .05, false); }
{ const m = BUILDINGS.find(x => x.id === 'market'); if (m) { prop('i_crate_apple', m.x - .4, m.y + m.h); prop('i_crate_carrot', m.x + m.w + .4, m.y + m.h); prop('i_pricestand', m.x + m.w + 1.6, m.y + m.h); } }
{ const f = BUILDINGS.find(x => x.id === 'fishhut'); if (f) prop('i_lantern', f.x - .3, f.y + f.h + .05, false); }
prop('i_bin_yellow', 58.6, 38.9);
const TREE_KINDS = ['tree', 'tree2', 'pine', 'tree_oak', 'tree_pink', 'tree3', 'bush', 'tree4', 'pine2', 'tree_cone', 'tree_twin', 'tree_pink2', 'bush2', 'tree_white'];
for (const a of [TOWN, FARM, HOUSING]) {
  for (let x = a.x; x < a.x + a.w; x++) { set(x, a.y, 'T'); set(x, a.y + a.h - 1, 'T'); }
  for (let y = a.y; y < a.y + a.h; y++) { if (get(a.x, y) !== 'w') set(a.x, y, 'T'); if (get(a.x + a.w - 1, y) !== 'w') set(a.x + a.w - 1, y, 'T'); }
  // trees grow in groves (parks and edges), not sprinkled everywhere, and keep two tiles clear of any road or path
  const groves = a === HOUSING ? [[192, 28, 4.5], [200, 30, 4], [250, 28, 4.5], [243, 30, 4], [196, 44, 5], [246, 44, 5], [212, 8, 6], [234, 8, 6]] : a === FARM ? [[118, 8, 5], [150, 6, 5], [176, 8, 4], [120, 32, 4]] : a === TOWN ? [[78, 44, 5], [88, 40, 4], [70, 56, 5], [86, 66, 6], [14, 20, 5], [32, 20, 5], [70, 20, 6], [12, 38, 4], [32, 38, 5], [60, 66, 5], [8, 60, 5], [44, 60, 5]] : [];
  for (let g = 0; g < (a === TOWN ? 22 : 6); g++) groves.push([a.x + 2 + rand() * (a.w - 4), a.y + 3 + rand() * (a.h - 5), 3.5 + rand() * 3.5]);
  const nearWay = (x, y) => { for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) if ('=,ckp'.includes(get(x + k, y + j) || '.')) return true; return false; };
  const n = a.w * a.h / 5;
  for (let i = 0; i < n; i++) {
    const x = a.x + 1 + Math.floor(rand() * (a.w - 2)), y = a.y + 2 + Math.floor(rand() * (a.h - 3));
    if (get(x, y) !== '.') continue;
    if (!groves.some(([gx, gy, r]) => Math.hypot(gx - x, gy - y) < r) || nearWay(x, y)) continue;
    let ok = true;
    for (let j = -2; j <= 1 && ok; j++) for (let k = -1; k <= 1; k++) { const c = get(x + k, y + j); if (c && c !== '.' && c !== 'T') { ok = false; break; } }
    if (ok && BUILDINGS.some(b => x >= b.x - 1 && x < b.x + b.w + 1 && y >= b.y - 1 && y < b.y + b.h + 3)) ok = false;   // keep building fronts clear
    if (ok && !STATIONS.some(s => Math.hypot(s.x - x - .5, s.y - y - .5) < 3) && !PROPS.some(p => Math.hypot(p.x - x - .5, p.y - y - .5) < 2.5)) set(x, y, 'T');
  }
}
BUILDINGS.forEach(b => rect(b.x, b.y, b.w, b.h, 'B'));
const TREES = [];
for (let y = 0; y < H; y++) for (let x = 0; x < RX0; x++) if (grid[y][x] === 'T') TREES.push([x, y, TREE_KINDS[(x * 7 + y * 13) % TREE_KINDS.length]]);

// ================================================================= town dressing: fenced back gardens behind the shops and garden
// patches on the open grass, so no stretch of town is a bare lawn. Laid out after the trees with its own random numbers
// (the trees and everything older stay exactly where they were).
{
  const R = rng(20261114), pickR = a => a[Math.floor(R() * a.length)];
  const T = TOWN, dropTree = (x, y) => { if (get(x, y) === 'T') { set(x, y, '.'); const i = TREES.findIndex(t => t[0] === x && t[1] === y); if (i >= 0) TREES.splice(i, 1); } };
  const way = c => '=,ckpswD'.includes(c);
  const nearWay = (x, y, r) => { for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) if (way(get(x + k, y + j) || '.')) return true; return false; };
  const propNear = (x, y, r) => PROPS.some(p => Math.hypot(p.x - x, p.y - y) < r) || STATIONS.some(s => s.area === 'town' && Math.hypot(s.x - x, s.y - y) < r + .5);
  // 0) new shops, all closed for renovation for now: two pet shops and two gyms (added here so nothing older moves)
  for (const [id, spr, x, front, label, icon, st] of [['pet1', 'b_pet1', 51, 13, 'ร้านสัตว์เลี้ยง', '🐾', 'petshop1'], ['gym1', 'b_gym1', 89, 13, 'ฟิตเนส โรงยิม', '🏋️'],
    ['pet2', 'b_pet2', 5, 13, 'ร้านสัตว์เลี้ยง สาขา 2', '🐶', 'petshop2'], ['gym2', 'b_gym2', 60, 45, 'โรงยิมมวย', '🥊']]) {
    const b = B(id, spr, x, front, st ? { label, icon, st, stype: 'petshop', rk: 'petshop', layout: id === 'pet2' ? 'petshop2' : 'petshop', late: 2 } : { label, icon, deco: true, renov: true });   // pet shops are open (street counters); gyms stay closed
    for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) { dropTree(i, j); if (get(i, j) === '.') set(i, j, 'B'); }
    for (let k = PROPS.length - 1; k >= 0; k--) { const q = PROPS[k]; if (q.x >= b.x && q.x < b.x + b.w && q.y - .5 >= b.y && q.y - .5 < b.y + b.h + 1) PROPS.splice(k, 1); }
    // a paved doorstep from the door down to the street
    const cx = Math.floor(b.x + b.w / 2); for (let y = b.y + b.h; y < front + 1; y++) for (const xx of [cx - 1, cx]) if ('.m'.includes(get(xx, y))) set(xx, y, 'c');
  }
  // 0b) 🔮 the fortune teller's tent: a street counter (no room), reads tarot for coins
  {
    const b = B('fortune', 'b_fortune', 43, 58, { label: 'เต็นท์แม่หมอพยากรณ์', icon: '🔮', st: 'fortune', stype: 'fortune', noSlot: true });
    for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) { dropTree(i, j); if (get(i, j) === '.') set(i, j, 'B'); }
    for (let j = b.y + b.h; j < b.y + b.h + 5; j++) for (let i = b.x - 2; i < b.x + b.w + 2; i++) dropTree(i, j);   // keep the doorway clear of trees
    for (let k = PROPS.length - 1; k >= 0; k--) { const q = PROPS[k]; if (q.x >= b.x - 2 && q.x < b.x + b.w + 2 && q.y - .5 >= b.y && q.y - .5 < b.y + b.h + 5 && !/fence|hedge/.test(q.s || '')) PROPS.splice(k, 1); }
  }
  // 1) back gardens: every shop or service whose back faces open grass gets a 3-row garden behind it: a white picket
  //    fence along the far edge, a hedge against the back wall, bushes in the corners and a flower bed in the middle
  for (const b of BUILDINGS) {
    if (b.area && b.area !== 'town' || b.house !== undefined || /^vh/.test(b.id) || b.x < T.x || b.x >= T.x + T.w) continue;
    const x0 = b.x, x1 = b.x + b.w, y0 = b.y - 3;
    let ok = y0 > 2;
    for (let y = y0 - 1; y < b.y && ok; y++) for (let x = x0; x < x1 && ok; x++) if (!'.T'.includes(get(x, y))) ok = false;
    if (!ok || propNear(b.x + b.w / 2, b.y - 1.5, 1.6)) continue;
    for (let y = y0; y < b.y; y++) for (let x = x0; x < x1; x++) dropTree(x, y);
    fenceRow('fence_white', x0, x1, y0 + .95);
    fenceRow(b.w >= 6 ? 'hedge_flower' : 'hedge', x0 + .6, x1 - .6, b.y - .02);
    prop(pickR(['bush', 'bush2', 'o_topiary']), x0 + .55, b.y - 1.1, false); prop(pickR(['bush2', 'bush', 'o_hedgecube']), x1 - .55, b.y - 1.1, false);
    if (b.w >= 5) prop(pickR(['flowerbed', 'flowerbed2', 'o_flowerbed']), b.x + b.w / 2, b.y - 1.05, false);
    if (b.w >= 7) { prop('o_potflower', x0 + 1.6, b.y - .9, false); prop('o_potflower', x1 - 1.6, b.y - .9, false); }
  }
  // 2) garden patches on the open grass (not on roads, paths, building fronts or next to anything else)
  const KITS = [
    [['bush', 0, 0], ['bush2', 1.1, .3], ['o_roses', -.9, .35, 1], ['tuft', .5, .9, 1]],
    [['o_tulips', 0, 0, 1], ['o_tulips', .7, .15, 1], ['o_roses', 1.5, 0, 1], ['bush2', -1, .1]],
    [['rock', 0, 0, 1], ['bush2', .9, -.1], ['tuft', -.6, .4, 1], ['o_potflower', 1.6, .3, 1]],
    [['bench2', 0, 0, 1], ['bush', -1.5, -.1], ['bush2', 1.5, -.1], ['o_lampball', 2.4, -.2]],
    [['o_topiary', 0, 0], ['o_topiary', 1.4, 0], ['flowerbox', .7, .6, 1]],
    [['stump', 0, 0, 1], ['tuft', .8, .2, 1], ['bush2', -1, -.2], ['o_roses', 1.6, -.1, 1]],
    [['flowerbed2', 0, 0, 1], ['bush', -1.8, 0], ['bush', 1.8, 0]],
  ];
  let n = 0;
  for (let gy = T.y + 4; gy < T.y + T.h - 3; gy += 4) for (let gx = T.x + 3; gx < T.x + T.w - 4; gx += 5) {
    const x = gx + Math.floor(R() * 3), y = gy + Math.floor(R() * 2), kit = pickR(KITS);
    if (R() < .35) continue;
    let ok = true;
    for (let j = -2; j <= 1 && ok; j++) for (let k = -3; k <= 3 && ok; k++) if (get(x + k, y + j) !== '.') ok = false;
    if (!ok || nearWay(x, y, 2) || propNear(x + .5, y + .5, 3)) continue;
    if (BUILDINGS.some(b => x >= b.x - 3 && x <= b.x + b.w + 2 && y >= b.y - 1 && y <= b.y + b.h + 3)) continue;
    for (const [s, dx, dy, flat] of kit) prop(s, x + .5 + dx, y + .95 + dy, !flat);
    n++;
  }
}

// ================================================================= interiors
// Every enterable building has a room. Furniture is real: solid pieces block movement
// (on the server too). Layout entries: [sprite, x, y(bottom), solid?] relative to the room.
const ROOM_SIZE = { office: [16, 12], hospital: [16, 11], house: [14, 10] };
const SOFT = /rug|window|pictures|clock|welcome|bed|chair|beanbag|curtains|picture/;
const LAYOUT = {
  office: [['f_window', 4, 1.1], ['f_window', 12, 1.1], ['f_reception', 8, 2.4], ['f_filing_grey', 1.6, 2.6], ['x_vending', 14.2, 2.7], ['x_drinkfridge', 12.6, 2.6], ['x_plant', 1.6, 10.7], ['f_water', 14.4, 10.7], ['x_wclock', 10.2, 1.0, false], ['f_corkboard', 5.5, 1.15, false], ['x_aircon', 8, 1.0, false], ['f_extinguisher', 3.2, 2.4], ['x_coatrack', 12.6, 10.8], ['x_magrack', 3.6, 10.8], ['x_fern', 9.6, 10.8]],
  warehouse: [['x_storage', 2.4, 2.7], ['x_mshelf2', 4.6, 2.7], ['f_cabinet', 7, 2.3], ['x_storage', 9.6, 2.7], ['x_water', 11.9, 2.6], ['x_crate', 2.0, 5.6], ['crate', 3.4, 5.6], ['x_fruit', 11.4, 5.6], ['x_eggs', 2.2, 8.7], ['x_cart2', 4.4, 8.7], ['barrel', 9.6, 8.6], ['x_drum', 10.6, 8.7], ['i_rice_sack', 11.6, 8.6, false], ['x_tires2', 12.5, 8.7]],
  fashion: [['x_shoes', 2.4, 2.7], ['x_bags', 4.6, 2.7], ['x_cashdesk', 7, 2.5], ['x_mirror', 9.4, 2.6], ['x_curtain', 11.6, 2.7], ['x_clothes', 3, 5.8], ['x_clothes', 11, 5.8], ['f_rug_round', 7, 6.6], ['x_mannequin2', 5.0, 6.6], ['x_mannequin3', 9.0, 6.6], ['x_hats', 1.6, 8.8], ['x_jewelcase', 3.6, 8.7], ['x_hats2', 12.4, 8.8], ['x_fabric', 10.6, 8.8], ['i_poster', 5, 1.05, false], ['x_wclock', 9.4, 0.95, false], ['x_pos', 7.6, 1.75, false]],
  rider: [['f_window', 10.5, 1.1], ['x_pcdesk2', 7, 2.5], ['x_lockers', 2.4, 2.6], ['x_water', 4.5, 2.6], ['f_coffee', 10.4, 2.6], ['x_vending', 12.2, 2.8], ['x_helmets', 4.4, 1.0, false], ['x_moto', 3.2, 6.2], ['f_rug_round', 7, 6.4], ['x_tirerack2', 11.6, 6.0], ['f_bench_back', 9.4, 8.95, false], ['f_plant', 1.6, 8.7], ['i_bike', 4, 8.6, false], ['x_airpump', 12.4, 8.8], ['x_wclock', 7, 0.95, false]],
  dealer: [['x_cardesk', 7, 2.4], ['w_sports_s', 3.2, 5.6], ['w_suv_s', 10.8, 5.6], ['w_cruiser_s', 2.6, 8.7], ['w_sport_s', 11.4, 8.7], ['x_plant', 1.5, 2.7], ['x_keys', 9.6, 1.1, false], ['x_tirerack2', 12.0, 2.7], ['x_tools', 11.4, 8.7], ['x_aboard2', 9.0, 8.8, false], ['x_wclock', 4.6, 1.0, false]],
  toolshop: [['x_toolbox', 2.2, 2.6], ['x_mshelf', 4.3, 2.7], ['x_cashdesk', 7, 2.5], ['x_workbench', 9.6, 2.6], ['f_shelf_c', 11.9, 2.8], ['x_storage', 2.4, 6.4], ['x_seeds', 4.8, 6.0, false], ['x_barrow', 10.8, 6.4], ['x_bucket2', 1.8, 8.7], ['x_jack', 4.0, 8.6], ['x_ghose', 10.4, 8.7], ['x_ladder2', 12.5, 8.7], ['i_lantern', 5, 1.15, false], ['i_clock', 9.4, 1.0, false]],
  restaurant: [['x_plant', 1.6, 2.8], ['x_coffeebar', 3.9, 2.5], ['x_counter', 7, 2.4], ['x_cakecase', 9.9, 2.5], ['x_drinkfridge', 12.1, 2.7], ['x_wclock', 5.4, 0.95, false], ['i_hanging', 12.6, 1.25, false], ['x_cafeset', 3.4, 5.7], ['x_cafeset', 10.6, 5.7], ['x_cafeset', 3.4, 8.6], ['x_cafeset', 10.6, 8.6], ['x_menu', 5.4, 9.15, false], ['x_bell', 7.9, 1.75, false]],
  kitchen: [['f_stove', 6.0, 6.3], ['x_hood', 4.6, 1.45, false], ['x_oven', 2.4, 2.6], ['x_souppot', 4.6, 2.6], ['x_prep', 7.2, 2.5], ['x_sink', 10.3, 2.5], ['x_breadrack', 2.0, 6.4], ['f_bench', 10.5, 6.6], ['x_tray', 10.5, 5.75, false], ['x_freezer', 2.6, 8.7], ['i_rice_sack', 4.4, 8.6], ['x_ice', 10.0, 8.8], ['f_fridge', 12.3, 8.7], ['x_ext', 12.6, 5.0], ['i_clock', 7.4, 1.0, false], ['x_dishrack', 12.0, 1.95, false]],
  hospital: [['f_reception2', 3.5, 2.5], ['x_medcab', 1.6, 2.7], ['f_window', 6.4, 1.1], ['f_firstaid', 9.2, 1.1, false], ['x_medfridge', 5.6, 2.8], ['x_waitseats', 2.6, 6.2], ['x_waitseats', 2.6, 8.4], ['x_plant', 5.2, 10.7], ['x_wheelchair2', 14.0, 10.6], ['x_iv', 15.0, 6.6], ['x_monitor', 9.75, 3.0], ['x_monitor', 12.25, 3.0], ['x_stretcher', 5.4, 6.8, false], ['x_xray', 15.0, 3.2], ['x_clock', 4.0, 1.0, false], ['i_bin_blue', 1.6, 10.6, false], ['x_magrack', 1.6, 4.6]],
  school: [['x_board', 7, 1.75, false], ['x_tdesk', 7, 2.6], ['f_books', 1.8, 2.6], ['f_bookshelf_wide', 3.8, 2.6], ['x_globe', 10.0, 2.6], ['x_cubby', 12.0, 2.7], ['x_locker', 1.6, 5.4], ['x_locker', 1.6, 7.6], ['x_clock', 11.0, 1.0, false], ['i_calendar', 4.8, 1.05, false], ['x_plant', 12.6, 8.8], ['i_backpack', 7, 8.6, false]],
  police: [['x_pdesk', 7, 2.4], ['x_lockers', 2.2, 2.6], ['f_filing_grey', 4.2, 2.6], ['x_radio', 9.4, 2.7], ['f_corkboard', 10.4, 1.15, false], ['x_cuffs', 5.4, 1.15, false], ['x_alarm', 12.4, 1.2, false], ['x_pcdesk2', 3.0, 5.6], ['f_bunk', 11.5, 7.4], ['f_bunk2', 9.5, 7.4], ['x_metaldoor', 12.2, 4.6], ['x_cones', 2.2, 8.8], ['x_barricade', 4.4, 8.8], ['f_plant', 12.6, 8.7], ['x_wclock', 7, 0.95, false]],
  bank: [['x_safe', 1.8, 2.7], ['x_bankcounter', 4.5, 2.4], ['x_bankcounter', 7, 2.4], ['x_bankcounter', 9.5, 2.4], ['x_vault', 12.0, 2.6], ['x_clock', 7, 0.95, false], ['f_rug_blue', 7, 6.6], ['x_waitseats', 2.6, 6.2], ['x_waitseats', 11.4, 6.2], ['x_atm', 1.6, 8.8], ['x_atm', 2.8, 8.8], ['x_plant', 12.4, 8.8], ['x_magrack', 10.6, 8.8], ['f_pictures', 4, 1.05], ['f_pictures', 10, 1.05]],
  // the four convenience-store branches (the counter is always top centre, where the till station stands)
  cstore: [['c_cashier', 7, 2.5], ['c_hotdog', 3.6, 2.6], ['c_coffee', 9.6, 2.3], ['c_fridge', 12.3, 2.9], ['c_icebox', 1.9, 2.6], ['c_chips', 2.6, 5.7], ['c_noodles', 11.4, 5.7],
    ['c_bread', 2.9, 8.4], ['c_cans', 11.1, 8.4], ['c_atm', 4.8, 8.8], ['c_umbrella', 9.3, 9.0], ['c_rug1', 7, 9.45, false], ['c_clock', 7, 1.0, false], ['c_cctv', 1.3, 1.2, false]],
  cstore2: [['c_cashier', 7, 2.5], ['c_fridge', 1.6, 2.9], ['c_fridge', 3.6, 2.9], ['c_deli', 10.6, 2.7], ['c_toiletry', 2.8, 5.8], ['c_freezer', 11.2, 5.8],
    ['c_cans', 2.9, 8.4], ['c_fruit', 5.0, 8.6], ['c_cart', 10.2, 8.9], ['c_water', 12.6, 8.7], ['c_rug2', 7, 9.45, false], ['c_clock', 7, 1.0, false], ['c_cctv', 12.8, 1.2, false]],
  cstore3: [['c_cashier', 7, 2.5], ['c_lottery', 3.5, 2.7], ['c_safe', 1.5, 2.6], ['c_giftcards', 9.1, 2.4], ['c_shelfred', 11.4, 2.7], ['c_chips', 2.6, 5.8], ['c_bread', 11.4, 5.8],
    ['c_noodles', 2.6, 8.4], ['c_hotdog2', 11.0, 8.6], ['c_icecream', 12.8, 8.7], ['c_stool', 4.8, 8.9], ['c_rug1', 7, 9.45, false], ['c_clock', 4.6, 1.0, false], ['c_fan', 12.6, 1.3, false]],
  cstore4: [['c_cashier', 7, 2.5], ['c_cups', 9.4, 2.4], ['c_coffee', 10.5, 2.3], ['c_fridge', 12.4, 2.9], ['c_atm', 1.4, 2.8], ['c_bags', 2.8, 2.8], ['c_chips', 2.6, 5.8], ['c_boxes', 11.6, 6.0],
    ['c_toiletry', 2.8, 8.4], ['c_freezer', 11.2, 8.4], ['c_mop', 5.0, 8.9], ['c_bin', 8.9, 9.0], ['c_rug2', 7, 9.45, false], ['c_clock', 7, 1.0, false], ['c_notice', 4.6, 1.6, false]],
  // pet shop: aquarium and shelves along the back, baskets and a rug on the floor (the live pets are drawn by the client); sales desk top centre
  petshop: [['x_cashdesk', 7, 2.5], ['f_window', 3.6, 1.1], ['f_window', 10.4, 1.1], ['x_wclock', 7, 0.95, false], ['f_aquarium', 1.7, 2.7], ['x_aquarium', 12.3, 2.7],
    ['f_rug_round', 7, 7.2, false], ['x_shelf_s', 1.6, 8.8], ['x_shelf_s', 12.4, 8.8], ['f_plant', 4.6, 9.0], ['f_plant2', 9.4, 9.0],
    ['i_pricestand', 5.2, 5.2, false], ['i_pricestand', 8.8, 5.2, false]],
  // pet shop branch 2: its own look (blue rug, aquariums swapped, cat statue and ferns)
  petshop2: [['x_cashdesk', 7, 2.5], ['f_window', 3.6, 1.1], ['f_window', 10.4, 1.1], ['x_wclock', 7, 0.95, false], ['x_aquarium', 1.7, 2.7], ['f_aquarium', 12.3, 2.7],
    ['x_fern', 4.2, 2.7], ['x_plant', 9.8, 2.7], ['f_rug_blue', 7, 7.2, false], ['x_mshelf', 1.6, 8.8], ['x_shelf_s', 12.4, 8.8], ['o_catstatue', 4.6, 9.0], ['x_fern', 9.4, 9.0],
    ['i_pricestand', 5.2, 5.2, false], ['i_pricestand', 8.8, 5.2, false]],
  // plant nursery: cooler and flower stand behind the desk, shelves of pots down both walls, two display beds in the middle, trees and palms in the corners
  plantshop: [['x_cashdesk', 7, 2.5], ['f_window', 3.6, 1.1], ['f_window', 10.4, 1.1], ['x_wclock', 7, 0.95, false],
    ['x_flowerfridge', 1.9, 2.8], ['x_flowers', 12.2, 2.8], ['x_fern', 4.6, 2.8], ['x_plant', 9.4, 2.8],
    ['f_shelf_pots', 1.5, 5.3], ['x_vases', 1.7, 7.3], ['f_shelf_pots', 12.5, 5.3], ['x_ferns', 12.3, 7.3],
    ['flowerbed', 4.9, 6.8, false], ['flowerbed2', 9.1, 6.8, false], ['f_cactus', 6.5, 5.1], ['o_cactus', 7.5, 5.1, false],
    ['x_tree', 2.0, 9.1], ['o_potpalm', 12.2, 9.2], ['x_hosereel', 4.4, 9.1], ['x_bucket2', 9.6, 9.2], ['i_pricestand', 5.9, 9.0, false], ['i_pricestand', 8.1, 9.0, false], ['f_welcome', 7, 9.55, false]],
  // furniture showroom: sofa corner, bedroom set, dining set and lamps on display; the sales desk is top centre
  furnshop: [['x_cashdesk', 7, 2.5], ['f_window', 3.4, 1.1], ['f_window', 10.6, 1.1], ['x_wclock', 7, 0.95, false], ['f_bookshelf_wide', 1.9, 2.7], ['x_sideboard', 12.2, 2.6],
    ['f_rug_red', 3.4, 6.3], ['f_sofa_red', 3.4, 5.6], ['f_armchair', 5.4, 6.2], ['f_floorlamp', 1.4, 6.0], ['f_bed_pink', 11.4, 5.9], ['f_drawer', 12.9, 5.6], ['x_flamp', 9.6, 5.8],
    ['f_table_chairs', 3.4, 8.9], ['x_lsofa', 10.8, 8.9], ['f_plant', 1.3, 8.8], ['f_plant2', 12.9, 8.8], ['i_pricestand', 5.6, 8.9, false], ['i_pricestand', 8.8, 8.9, false]],
  // hair salon: three styling chairs with mirrors along the left, wash basin and dryer on the right, waiting sofa by the door
  barber: [['x_cashdesk', 7, 2.5], ['x_wclock', 7, 0.95, false], ['f_mirror', 1.4, 2.6], ['f_mirror', 3.0, 2.6], ['f_mirror', 4.6, 2.6], ['x_shelf_s', 10.2, 2.7], ['f_shelf_jars', 12.2, 2.4],
    ['x_barstool', 1.4, 4.4], ['x_barstool', 3.0, 4.4], ['x_barstool', 4.6, 4.4], ['x_sink', 11.4, 5.6], ['x_dryer', 12.6, 7.6], ['x_fan', 9.6, 7.8], ['x_bonsai', 1.4, 8.8],
    ['x_sofa2', 4.6, 8.9], ['f_plant', 12.8, 8.8], ['i_poster', 5, 1.05, false], ['i_poster', 9.6, 1.05, false], ['x_magrack', 9.4, 8.9]],
  // a small home: bedroom (top left), living room (middle), bathroom (top right), kitchen (bottom left); bought furniture fills its own spots (client FURN_POS)
  // a new home comes empty: only the bed (plus windows and the doormat) — everything else is bought and placed by the owner
  house: [['f_window', 6.9, 1.1], ['f_window_flower', 11.2, 1.15, false], ['f_welcome', 7, 9.25]],
};
// office: 8 work desks with a chair in front of each
for (const cx of [2.5, 5.5, 10.5, 13.5]) for (const by of [5.2, 8.3]) LAYOUT.office.push(['f_laptop_desk', cx, by], ['f_office_chair', cx, by + 1.25]);
// university classroom: 4 desks, two students each
const SCHOOL_DESKS = [[3.6, 4.6], [10.4, 4.6], [3.6, 7.0], [10.4, 7.0]];
for (const [cx, by] of SCHOOL_DESKS) LAYOUT.school.push(['f_desk', cx, by], ['f_chair', cx - .45, by + 1.25], ['f_chair', cx + .45, by + 1.25]);
const ROOMS = [];
let slot = 0;
// house expansions: every house owns rooms for floors 2 and 3 (unlocked by buying them), reached by stairs
const HOUSE_FLOORS = 3, STAIR_UP = [12.6, 8.2], STAIR_DOWN = [12.6, 8.2], STAIR_UP2 = [1.4, 8.2];
const FLOOR_PRICE = [0, 0, 60000, 150000];   // [floor] -> price to build it
for (const b of [0, 1, 2, 3].flatMap(L => BUILDINGS.filter(b => +(b.late || 0) === L))) {   // late buildings take room slots after all the older ones, so existing rooms keep their place   // late buildings take room slots after all the older ones, so existing rooms keep their place
  if (!b.st) continue;
  if (b.noSlot) {                       // a street counter added later: takes no room slot, so every other room keeps its place
    STATIONS.push({ id: b.st, type: b.stype || b.st, label: b.label, icon: b.icon, x: b.x + b.w / 2, y: b.y + b.h + .45, r: 1.9, area: b.area || 'town' });
    continue;
  }
  const kind = b.rk || (b.house !== undefined ? 'house' : b.id);
  const [RW, RH] = ROOM_SIZE[kind] || [14, 10];
  const rx = RX0 + (slot % 6) * 18, ry = 1 + Math.floor(slot / 6) * 14; slot++;
  if (b.outdoor) {                     // served from the street: the counter is in front of the building (its room slot stays unused so other rooms keep their place)
    STATIONS.push({ id: b.st, type: b.st, label: b.label, icon: b.icon, x: b.x + b.w / 2, y: b.y + b.h + .45, r: 1.9, area: b.area || 'town' });
    continue;
  }
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
  const items = LAYOUT[b.layout || kind] || [];
  room.furniture = items.map(([s, x, y, solid]) => [s, rx + x, ry + y]);
  for (const [s, x, y, solid] of items) {
    if (solid === false || SOFT.test(s) || y < 1.3 || !ATLAS.sprites[s]) continue;
    const w = SPR(s).w, row = ry + Math.floor(y - 0.45);
    for (let i = Math.floor(rx + x - w / 2 + 0.3); i <= Math.floor(rx + x + w / 2 - 0.3); i++) if (get(i, row) === 'i') set(i, row, 'o');
  }
  STATIONS.push({ id: 'exit_' + b.id, type: 'exit', room: room.id, label: 'ออกนอกอาคาร', icon: '🚪', x: rx + mx, y: ry + RH - 0.55, r: 1.2 });
  STATIONS.push({ id: 'door_' + b.id, type: 'door', to: room.id, label: b.label, icon: b.icon, x: front.x, y: front.y + 0.6, r: 1.5, area: b.area || 'town', bld: b.id, house: b.house, renov: b.renov || undefined });
  if (kind === 'house') {
    STATIONS.push({ id: 'hbed' + b.house, type: 'hbed', idx: b.house, room: room.id, label: 'เตียงนอน', icon: '🛏️', x: rx + 3.4, y: ry + 3.7, r: 1.4 });
    STATIONS.push({ id: `hstair${b.house}_1`, type: 'hstair', idx: b.house, fl: 1, room: room.id, label: 'บันไดขึ้นชั้น 2', icon: '🪜', x: rx + STAIR_UP[0], y: ry + STAIR_UP[1] + .4, r: 1.1 });
    room.furniture.push(['~stairs', rx + STAIR_UP[0], ry + STAIR_UP[1]]);
    continue;
  }
  const s = { id: b.st, type: b.stype || b.st, label: b.label, icon: b.icon, room: room.id, x: rx + mx, y: ry + 2.6, r: 1.8 };
  if (kind === 'office') { s.x = rx + 8; s.label = 'ฝ่ายบุคคล (สมัครงาน)'; }
  // the rider hub's waiting bench seats two side by side
  if (kind === 'rider') for (const [i, dx] of [[1, -.45], [2, .45]]) STATIONS.push({ id: 'seat_rider' + i, type: 'seat', label: 'ม้านั่งรอออเดอร์', icon: '🪑', room: room.id, x: rx + 9.4 + dx, y: ry + 8.7, r: .55 });
  if (kind === 'kitchen') {             // cooking: work stations around the kitchen (anyone can cook; the counter at the top takes orders)
    for (const [id, type, label, icon, dx, dy] of [['k_pantry', 'kpantry', 'ตู้วัตถุดิบ', '🧺', 12.3, 7.3], ['k_grill', 'kgrill', 'เตาย่าง', '🔥', 2.4, 3.6], ['k_pot', 'kpot', 'หม้อต้ม', '🍲', 4.6, 3.6],
      ['k_board', 'kboard', 'เขียงสับ', '🔪', 10.3, 3.6], ['k_pan', 'kpan', 'กระทะผัด', '🍳', 6.0, 7.2], ['k_plate', 'kplate', 'โต๊ะจัดจาน', '🍽️', 10.5, 7.6]])
      STATIONS.push({ id, type, label, icon, room: room.id, x: rx + dx, y: ry + dy, r: 1.1 });
  }
  if (kind === 'hospital') {
    s.x = rx + 3.5;
    [[8.5, 3.6], [11, 3.6], [13.5, 3.6], [8.5, 7.4], [11, 7.4], [13.5, 7.4]].forEach(([dx, dy], i) => {
      room.furniture.push(['f_bed_hosp', rx + dx, ry + dy - .2]);
      STATIONS.push({ id: 'bed' + i, type: 'bed', idx: i, room: room.id, label: 'เตียงคนไข้', icon: '🛏️', x: rx + dx, y: ry + dy, r: 1.2 });
    });
    // ICU: emergency cases for doctors (CPR or surgery mini-games)
    room.furniture.push(['f_bed_hosp', rx + 12.5, ry + 9.3], ['x_monitor', rx + 10.9, ry + 9.5]);
    STATIONS.push({ id: 'icu', type: 'icu', room: room.id, label: 'ICU · เคสฉุกเฉิน', icon: '🚨', x: rx + 12.5, y: ry + 9.6, r: 1.3 });
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
{
  let fslot = 0;
  for (const g of ROOMS.filter(r => r.rk === 'house')) for (let fl = 2; fl <= HOUSE_FLOORS; fl++) {
    const RW = 14, RH = 10, rx = RX0 + 6 * 18 + (fslot % 4) * 18, ry = 1 + Math.floor(fslot / 4) * 14; fslot++;
    rect(rx, ry, RW, RH, '#'); rect(rx + 1, ry + 1, RW - 2, RH - 2, 'i');
    const room = { ...g, id: `${g.id}_f${fl}`, floor: fl, x: rx, y: ry, w: RW, h: RH,
      spawn: { x: rx + STAIR_DOWN[0] - 1.4, y: ry + STAIR_DOWN[1] + .3 }, exit: { x: -99, y: -99 },
      furniture: [['f_window', rx + 4, ry + 1.1], ['f_window', rx + 10, ry + 1.1], ['~stairs_d', rx + STAIR_DOWN[0], ry + STAIR_DOWN[1]]] };
    ROOMS.push(room);
    STATIONS.push({ id: `hstair${g.house}_${fl}d`, type: 'hstair', idx: g.house, fl, down: 1, room: room.id, label: `บันไดลงชั้น ${fl - 1}`, icon: '🪜', x: rx + STAIR_DOWN[0], y: ry + STAIR_DOWN[1] + .4, r: 1.1 });
    if (fl < HOUSE_FLOORS) {
      room.furniture.push(['~stairs', rx + STAIR_UP2[0], ry + STAIR_UP2[1]]);
      STATIONS.push({ id: `hstair${g.house}_${fl}`, type: 'hstair', idx: g.house, fl, room: room.id, label: `บันไดขึ้นชั้น ${fl + 1}`, icon: '🪜', x: rx + STAIR_UP2[0], y: ry + STAIR_UP2[1] + .4, r: 1.1 });
    }
  }
}
// ================================================================= home yards
// Every house stands in its own big private yard (Hay Day style): the door on the estate street leads into the yard,
// the house's own door in the yard leads inside. The yard is 3x3 zones; the middle column (house, lawn, gate) is open
// from the start and the six side zones are unlocked one by one for a rising price. Owners plant vegetable fields and
// lay out their garden with the same placement tool as the furniture indoors (floor 9 = the yard).
const YARD = { x0: YX0, w: 32, h: 26, zw: 10, zh: 8, start: [1, 4, 7], price: [25000, 40000, 60000, 85000, 115000, 150000] };
const YARDS = [];
for (const room of ROOMS.filter(r => r.rk === 'house' && !r.floor)) {
  const i = room.house, x = YX0 + (i % 4) * 34, y = 1 + Math.floor(i / 4) * 28, ox = x + 1, oy = y + 1;
  const yard = { id: 'yard' + i, kind: 'map', yard: 1, house: i, name: `สวนบ้านเลขที่ ${i + 1}`, x, y, w: YARD.w, h: YARD.h, ox, oy };
  rect(x, y, YARD.w, YARD.h, '.');
  for (let k = 0; k < YARD.w; k++) { set(x + k, y, 'T'); set(x + k, y + YARD.h - 1, 'T'); }
  for (let k = 0; k < YARD.h; k++) { set(x, y + k, 'T'); set(x + YARD.w - 1, y + k, 'T'); }
  const hb = BUILDINGS.find(b => b.house === i), sp = SPR(hb.sprite), front = oy + 6;
  const b = B('yh' + i, hb.sprite, ox + 10 + Math.floor((10 - sp.w) / 2), front, { label: '', icon: '🏠', deco: true, area: yard.id, yhouse: i });
  rect(b.x, b.y, b.w, b.h, 'B');
  pathDown(b, y + YARD.h - 1);
  const cx = Math.floor(b.x + b.w / 2);
  rect(cx - 2, y + YARD.h - 1, 4, 1, 'c');                            // a gap in the hedge of trees for the gate
  const door = { x: b.x + b.w / 2, y: front + .6 };
  STATIONS.push({ id: 'ydoor' + i, type: 'door', to: room.id, label: 'เข้าบ้าน', icon: '🏠', x: door.x, y: door.y, r: 1.5, area: yard.id, house: i, bld: hb.id });
  room.outside = { x: door.x, y: front + 1.2 };                       // walking out of the house puts you in your yard
  yard.spawn = { x: cx, y: y + YARD.h - 3 };
  const street = STATIONS.find(t => t.id === 'door_' + hb.id);
  street.yspawn = yard.spawn;                                          // the estate-street door opens onto the yard
  GATES['yardout' + i] = { x: street.x, y: street.y + .6 };
  STATIONS.push({ id: 'ygate' + i, type: 'gate', to: 'yardout' + i, label: 'ออกไปถนนหมู่บ้าน', icon: '🏘️', x: cx, y: y + YARD.h - 1.7, r: 1.4, area: yard.id });
  for (const z of [0, 2, 3, 5, 6, 8]) {
    const c = z % 3, r = Math.floor(z / 3);
    STATIONS.push({ id: `yzone${i}_${z}`, type: 'yzone', idx: i, z, label: 'ขยายพื้นที่สวน', icon: '🔓', x: c === 0 ? ox + 10.9 : ox + 19.1, y: oy + r * YARD.zh + (r === 0 ? 7.2 : 4), r: 1.2, area: yard.id });
  }
  for (let ty = y; ty < y + YARD.h; ty++) for (let tx = x; tx < x + YARD.w; tx++) if (grid[ty][tx] === 'T') TREES.push([tx, ty, TREE_KINDS[(tx * 7 + ty * 13) % TREE_KINDS.length]]);
  YARDS.push(yard);
}
// which zone of a yard a spot (in yard-relative tiles) falls in
const yardZone = (x, y) => Math.max(0, Math.min(2, Math.floor((x - 1) / YARD.zw))) + 3 * Math.max(0, Math.min(2, Math.floor((y - 1) / YARD.zh)));
// the room a house floor lives in, and where you arrive on it
const floorRoom = (house, fl) => ROOMS.find(r => r.rk === 'house' && r.house === house && (r.floor || 1) === fl);
// ================================================================= AMUSEMENT PARK: rides you sit on for a while; every second on a ride
// gives back energy, health and happiness. A ticket buys a few minutes; walking away gets you off.
// k: ride, cx/cy: centre of its footprint, w/h: footprint (solid), cap: riders at once, price: ticket, mins: ticket length,
// gain: per second while riding
const POOL = {};   // the park pool's water (filled in below): swimmers move freely inside it, nobody else (and no vehicle) can enter
const ENERGY_MUL = 0.9;   // every energy cost (jobs, quests, fishing...) x this (was 1.3: players ran dry too fast)
const RIDES = {
  carousel: { name: 'ม้าหมุน', icon: '🎠', price: 0, mins: 3, cap: 6, gain: { energy: 2.0, health: 0.8, happy: .3 }, desc: 'นั่งม้าหมุนชิลๆ พลังงานคืนไว' },
  ferris:   { name: 'ชิงช้าสวรรค์', icon: '🎡', price: 0, mins: 4, cap: 8, gain: { energy: 1.8, health: 1.2, happy: .35 }, desc: 'ขึ้นไปชมวิวทั้งสวน ได้ทุกอย่างสมดุล' },
  coaster:  { name: 'รถไฟเหาะ', icon: '🎢', price: 0, mins: 2, cap: 6, gain: { energy: 1.2, health: 0.4, happy: .8 }, desc: 'หวาดเสียว! ความสุขพุ่งที่สุด' },
  pool:     { name: 'สระว่ายน้ำ', icon: '🏊', price: 0, mins: 4, cap: 10, gain: { energy: 2.4, health: 2.2, happy: .3 }, desc: 'ว่ายน้ำคลายร้อน ฟื้นเลือดดีที่สุด' },
  bumper:   { name: 'รถบั๊มพ์', icon: '🚗', price: 0, mins: 2, cap: 4, gain: { energy: 1.2, health: 0.4, happy: .6 }, desc: 'ขับชนกันสนุกๆ' },
  shooting: { name: 'เกมยิงเป้า', icon: '🎯', price: 0, mins: 2, cap: 3, gain: { energy: 1.0, health: 0.4, happy: .45 }, desc: 'ยิงเป้าเล่นเพลินๆ ราคาถูก' },
};
{
  const X = PARK.x, Y = PARK.y, P = PARK;
  rect(P.x, P.y, P.w, P.h, '.');
  for (let x = P.x; x < P.x + P.w; x++) { set(x, P.y, 'T'); set(x, P.y + P.h - 1, 'T'); }
  for (let y = P.y; y < P.y + P.h; y++) { set(P.x, y, 'T'); set(P.x + P.w - 1, y, 'T'); }
  // compact layout (40 x 28): rides on both sides of one promenade, a shopping street along the south with a minimart,
  // and two short walks joining them, so everything is a few steps apart
  rect(X + 1, Y + 10, 38, 3, 'k');                                   // the promenade (west gate to east)
  rect(X + 15, Y + 13, 2, 9, 'k'); rect(X + 27, Y + 13, 2, 9, 'k');   // walks down to the shopping street
  rect(X + 1, Y + 22, 38, 2, 'k');                                   // the shopping street
  const ride = (k, cx, cy, w, h, solid = true) => {
    const R = RIDES[k], x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
    if (solid) rect(x0, y0, w, h, 'o');
    const sy = y0 + h + .6;
    rect(Math.floor(cx) - 1, y0 + h, 2, Math.max(0, Y + 10 - (y0 + h)), 'k');   // a short path from the ride to the promenade (north side)
    STATIONS.push({ id: 'ride_' + k, type: 'ride', k, label: R.name, icon: R.icon, x: cx, y: sy, r: 1.8, area: 'park', cx, cy, w, h });
  };
  ride('carousel', X + 7, Y + 5, 8, 6);
  ride('ferris', X + 18, Y + 5, 8, 8);
  ride('coaster', X + 32, Y + 5, 12, 6);
  // south side: rides open toward the promenade, so their stations sit on their north edge
  const rideS = (k, cx, cy, w, h, solid = true) => {
    const R = RIDES[k], x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
    if (solid) rect(x0, y0, w, h, 'o');
    rect(Math.floor(cx) - 1, Y + 13, 2, Math.max(0, y0 - (Y + 13)), 'k');
    STATIONS.push({ id: 'ride_' + k, type: 'ride', k, label: R.name, icon: R.icon, x: cx, y: y0 - .4, r: 1.8, area: 'park', cx, cy, w, h, top: 1 });
  };
  // the pool: a tiled deck round the water; swimmers move about freely in the water (it is not walkable on foot)
  rect(X + 2, Y + 14, 13, 8, 'k'); rect(X + 3, Y + 15, 11, 6, 'w'); rect(X + 8, Y + 13, 2, 1, 'k');
  POOL.x0 = X + 3; POOL.y0 = Y + 15; POOL.x1 = X + 14; POOL.y1 = Y + 21;
  STATIONS.push({ id: 'ride_pool', type: 'ride', k: 'pool', label: RIDES.pool.name, icon: RIDES.pool.icon, x: X + 8.5, y: Y + 13.6, r: 2, area: 'park', cx: X + 8.5, cy: Y + 18, w: 11, h: 6, top: 1, swim: 1 });
  rideS('bumper', X + 22, Y + 17, 10, 6, false);
  { const x0 = X + 17, y0 = Y + 14; rect(x0, y0, 10, 6, 'k'); for (let i = 0; i < 10; i++) { set(x0 + i, y0, 'o'); set(x0 + i, y0 + 5, 'o'); } for (let j = 0; j < 6; j++) { set(x0, y0 + j, 'o'); set(x0 + 9, y0 + j, 'o'); } }   // the bumper car floor
  rideS('shooting', X + 33, Y + 18, 8, 4);
  // the shopping street: a minimart, the snack & souvenir kiosk, food trucks and drinks
  const shop = (sp, cx, w, sc) => { PROPS.push({ s: sp, x: X + cx, y: Y + 26.8, sc }); rect(Math.round(X + cx - w / 2), Y + 24, w, 3, 'o'); };
  shop('b_cs1', 5, 4, .7);
  STATIONS.push({ id: 'pmart', type: 'cstore', label: 'มินิมาร์ทสวนสนุก', icon: '🏪', x: X + 5, y: Y + 23.4, r: 1.8, area: 'park' });
  shop('kiosk', 10.5, 2);
  STATIONS.push({ id: 'pshop', type: 'pshop', label: 'ร้านขนม & ของฝากสวนสนุก', icon: '🍿', x: X + 10.5, y: Y + 23.4, r: 1.8, area: 'park' });
  shop('foodtruck', 15, 3); shop('icecream', 20, 3, .8); shop('cartstall', 24.5, 2); shop('b_cafe2', 31, 4, .55);
  for (const c of [35.4, 36.6]) prop('x_vending', X + c, Y + 24.6);
  STATIONS.push({ id: 'balloon', type: 'balloon', label: 'ร้านลูกโป่ง', icon: '🎈', x: X + 27.5, y: Y + 23.4, r: 1.5, area: 'park' });   // 🎈 the balloon seller on the shopping street
  STATIONS.push({ id: 'gate_town_p', type: 'gate', to: 'town_from_park', label: 'กลับเข้าเมือง', icon: '🏙️', x: X + 2.6, y: Y + 11.5, r: 1.6, area: 'park' });
  prop('signpost', X + 4.2, Y + 9.9);
  for (const [x, y] of [[X + 12, Y + 9.4], [X + 24, Y + 9.4], [X + 24, Y + 13.4], [X + 37, Y + 13.4], [X + 6, Y + 21.4]]) { prop('o_bench', x, y, false); STATIONS.push({ id: 'seat_p' + x + '_' + y, type: 'seat', label: 'ม้านั่งในสวนสนุก', icon: '🪑', x, y: y + .2, r: .7, area: 'park' }); }
  for (const [x, y] of [[X + 6, Y + 9.9], [X + 14.5, Y + 9.9], [X + 26, Y + 9.9], [X + 38, Y + 9.9], [X + 14.4, Y + 14.2], [X + 29.6, Y + 14.2], [X + 1.6, Y + 22.3], [X + 38, Y + 22.3]]) prop('o_lampball', x, y);
  for (let y = P.y; y < P.y + P.h - 1; y++) for (let x = P.x; x < P.x + P.w; x++) if (grid[y][x] === 'T') TREES.push([x, y, TREE_KINDS[(x * 7 + y * 13) % TREE_KINDS.length]]);
  // the way in from town: an arch at the south edge, where the main road leaves town (like the farm and the housing estate)
  STATIONS.push({ id: 'gate_park', type: 'gate', to: 'park_in', label: 'ไปสวนสนุก', icon: '🎡', x: 54, y: 55.3, r: 1.8, area: 'town' });   // the amusement park's arch now stands just off the south avenue, a short walk from the square
  for (let i = TREES.length - 1; i >= 0; i--) if (TREES[i][0] >= 50 && TREES[i][0] <= 58 && TREES[i][1] >= 52 && TREES[i][1] <= 61) { set(TREES[i][0], TREES[i][1], '.'); TREES.splice(i, 1); }   // clear the ground in front of the arch
  for (let i = PROPS.length - 1; i >= 0; i--) if (PROPS[i].s === 'o_topiary' && PROPS[i].x === 56.4 && PROPS[i].y === 54) { set(56, 53, '.'); PROPS.splice(i, 1); }
  rect(51, 55, 6, 2, 'c');                                                            // cobblestone from the avenue to the arch
  rect(49, 76, 2, 14, '='); for (let i = TREES.length - 1; i >= 0; i--) if (TREES[i][1] >= 88 && TREES[i][0] >= 47 && TREES[i][0] <= 52) TREES.splice(i, 1);   // a gap in the tree line for the road
  GATES.park_in = { x: X + 5, y: Y + 11.5 }; GATES.town_from_park = { x: 54, y: 57.4 };
}
// ================================================================= THE TEMPLE: a walled ground of sand and lawns - the ordination
// hall (โบสถ์) with a stone courtyard, a golden chedi, an open sala by a bodhi tree, a lotus pond, the temple shop and the bell tower.
// Buildings are solid footprints ('o'); the client paints them (station type 'wat', k = which building).
{
  const X = TEMPLE.x, Y = TEMPLE.y, T = TEMPLE;
  const tree = (x, y, k) => { set(x, y, 'T'); TREES.push([x, y, k]); };
  rect(T.x, T.y, T.w, T.h, 's');
  rect(X + 1, Y + 1, 12, 13, '.'); rect(X + 29, Y + 1, 14, 11, '.'); rect(X + 1, Y + 27, 13, 4, '.'); rect(X + 36, Y + 20, 7, 11, '.');   // lawns in the corners
  for (let x = T.x; x < T.x + T.w; x++) { set(x, T.y, 'o'); set(x, T.y + T.h - 1, 'o'); }   // the white temple wall
  for (let y = T.y; y < T.y + T.h; y++) { set(T.x, y, 'o'); set(T.x + T.w - 1, y, 'o'); }
  set(T.x, Y + 16, 's'); set(T.x, Y + 17, 's');                                                   // the way in (west)
  rect(X + 1, Y + 16, 35, 2, 'c');                                                                // the main walk, gate -> bell tower
  rect(X + 14, Y + 12, 16, 4, 'c');                                                               // the courtyard before the hall
  rect(X + 30, Y + 10, 2, 6, 'c'); rect(X + 32, Y + 10, 3, 1, 'c');                              // up to the chedi
  rect(X + 8, Y + 18, 2, 2, 'c'); rect(X + 31, Y + 18, 2, 6, 'c'); rect(X + 29, Y + 24, 6, 2, 'c'); // down to the sala and the shop
  rect(X + 15, Y + 18, 13, 1, 'c'); rect(X + 15, Y + 19, 1, 9, 'c'); rect(X + 27, Y + 19, 1, 9, 'c'); rect(X + 15, Y + 28, 13, 1, 'c');   // a walk round the pond
  rect(X + 17, Y + 20, 9, 7, 'w');                                                                // the lotus pond
  const wat = (k, label, icon, x0, y0, w, h, solid = true, extra = {}) => {
    if (solid) rect(x0, y0, w, h, 'o');
    STATIONS.push({ id: 'wat_' + k, type: 'wat', k, label, icon, x: -99, y: -99, r: 0, area: 'temple', cx: x0 + w / 2, cy: y0 + h / 2, w, h, deco: 1, ...extra });
  };
  wat('bot', 'โบสถ์', '🛕', X + 18, Y + 5, 8, 7);
  wat('chedi', 'เจดีย์', '🛕', X + 32, Y + 4, 6, 6);
  wat('bell', 'หอระฆัง', '🔔', X + 36, Y + 14, 3, 3);
  wat('shop', 'ร้านของวัด', '🪔', X + 29, Y + 21, 6, 3);
  // the open sala: a wooden floor you walk onto, posts at the corners, benches inside
  rect(X + 3, Y + 20, 10, 6, 'k'); for (const [dx, dy] of [[0, 0], [9, 0], [0, 5], [9, 5]]) set(X + 3 + dx, Y + 20 + dy, 'o');
  STATIONS.push({ id: 'wat_sala', type: 'wat', k: 'sala', label: 'ศาลาการเปรียญ', icon: '🪑', x: -99, y: -99, r: 0, area: 'temple', cx: X + 8, cy: Y + 23, w: 10, h: 6, deco: 1 });
  for (const [dx, dy] of [[2.5, 2.2], [6.5, 2.2], [2.5, 4.4], [6.5, 4.4]]) STATIONS.push({ id: `seat_t${dx}_${dy}`, type: 'seat', label: 'นั่งพักที่ศาลา', icon: '🪑', x: X + 3 + dx, y: Y + 20 + dy, r: 1, area: 'temple', sala: 1 });
  // things to do
  STATIONS.push({ id: 'wat_pray', type: 'wpray', label: 'ไหว้พระขอพร', icon: '🙏', x: X + 22, y: Y + 13.1, r: 1.5, area: 'temple' });
  STATIONS.push({ id: 'wat_siamsi', type: 'siamsi', label: 'เสี่ยงเซียมซี', icon: '🎋', x: X + 26.5, y: Y + 13.1, r: 1.3, area: 'temple' });
  STATIONS.push({ id: 'wat_ring', type: 'wbell', label: 'ตีระฆัง', icon: '🔔', x: X + 37.5, y: Y + 17.7, r: 1.4, area: 'temple' });
  STATIONS.push({ id: 'tshop', type: 'tshop', label: 'ร้านของวัด', icon: '🪔', x: X + 32, y: Y + 24.7, r: 1.6, area: 'temple' });   // the counter faces south
  for (const [x, y] of [[X + 16, Y + 19.9], [X + 26, Y + 19.9], [X + 16, Y + 27.9], [X + 26, Y + 27.9]]) STATIONS.push({ id: `seat_tp${x}_${y}`, type: 'seat', label: 'นั่งชมบ่อบัว', icon: '🪷', x, y, r: .9, area: 'temple' });
  // the bodhi tree with a stone bench ring, shade trees along the wall, lanterns along the walks, flowers before the hall
  tree(X + 7, Y + 8, 'tree_twin'); prop('o_hedgering', X + 7.5, Y + 10.9, false);
  for (const [x, y] of [[X + 5, Y + 11.9], [X + 10, Y + 11.9]]) prop('o_stonebench', x, y);
  for (const [x, y, k] of [[X + 2, Y + 2, 'tree_oak'], [X + 11, Y + 2, 'tree_white'], [X + 2, Y + 6, 'tree_pink'], [X + 2, Y + 12, 'tree_oak'], [X + 41, Y + 2, 'tree_oak'], [X + 41, Y + 7, 'tree_white'], [X + 30, Y + 2, 'tree_pink'],
    [X + 2, Y + 28, 'tree_pink2'], [X + 12, Y + 29, 'tree_oak'], [X + 41, Y + 22, 'tree_oak'], [X + 41, Y + 28, 'tree_pink'], [X + 37, Y + 28, 'tree_white'], [X + 14, Y + 2, 'pine2'], [X + 28, Y + 2, 'pine2']]) tree(x, y, k);
  for (const x of [X + 4, X + 12, X + 33]) prop('o_lantern', x, Y + 15.9); for (const x of [X + 4, X + 12]) prop('o_lantern', x, Y + 18.95);
  for (const [x, y] of [[X + 14, Y + 18.9], [X + 28.6, Y + 18.9], [X + 14, Y + 28.9], [X + 28.6, Y + 28.9]]) prop('o_lantern', x, y);
  for (const x of [X + 15, X + 28.5]) prop('o_potflower', x, Y + 12.9);
  for (const [x, y, k] of [[X + 16, Y + 6, 'tree_white'], [X + 27, Y + 6, 'tree_white']]) tree(x, y, k);
  for (const [x, y] of [[X + 16.5, Y + 10.9], [X + 27.5, Y + 10.9]]) prop('bush2', x, y);
  for (const x of [X + 17.5, X + 26.5]) prop('flowerbed', x, Y + 12.4, false);
  for (const [x, y] of [[X + 31, Y + 9.9], [X + 38.6, Y + 9.9]]) prop('x_bonsai', x, y);
  for (const [x, y] of [[X + 36, Y + 13.4], [X + 40, Y + 13.4], [X + 6, Y + 2.9], [X + 9, Y + 2.9], [X + 37, Y + 25], [X + 39, Y + 25]]) prop('bush', x, y);
  for (const [x, y] of [[X + 3, Y + 14.9], [X + 11, Y + 14.9], [X + 21, Y + 29.9], [X + 38, Y + 19.9]]) prop('o_flowerbed', x, y, false);
  for (const [x, y] of [[X + 30, Y + 26.9], [X + 34, Y + 26.9]]) prop('x_orchids', x, y);
  STATIONS.push({ id: 'gate_town_t', type: 'gate', to: 'town_from_temple', label: 'กลับเข้าเมือง', icon: '🏙️', x: X + 1.6, y: Y + 17, r: 1.6, area: 'temple' });
  // the way in from town: the temple complex (painted, seen from above) on the open lawn south of the town pond. It stands on a
  // diamond of ground; tiles inside it are solid, and the client draws it in strips so people in front of an edge stand in front.
  const F = { cx: 74, bv: 72, hw: 8.92, lv: 5.19, x0: 64.66, by: 72.18, w: 18.39 };   // bottom vertex, half width, side-vertex rise; picture left/bottom/width
  for (let y = 56; y <= 71; y++) for (let x = 62; x <= 86; x++) { const c = get(x, y); if (c === 'T' || c === 'o') set(x, y, '.'); }
  for (let i = PROPS.length - 1; i >= 0; i--) { const q = PROPS[i]; if (q.x >= 62 && q.x < 87 && q.y >= 56.5 && q.y < 72.5 && !(q.s === 'pond')) PROPS.splice(i, 1); }
  for (let i = TREES.length - 1; i >= 0; i--) { const q = TREES[i]; if (q[0] >= 62 && q[0] <= 86 && q[1] >= 56 && q[1] <= 71) TREES.splice(i, 1); }
  for (let y = 60; y <= 72; y++) for (let x = 64; x <= 84; x++) { const dx = Math.abs(x + .5 - F.cx) / F.hw, dy = Math.abs(y + .5 - (F.bv - F.lv)) / F.lv; if (dx + dy <= .92) set(x, y, 'o'); }
  rect(73, 72, 3, 4, 'c'); rect(71, 72, 7, 1, 'c');                            // the stone walk from the road up to the steps
  prop('o_lantern', 72.4, 74.95); prop('o_lantern', 75.6, 74.95); prop('signpost', 76.6, 75.9, false);
  STATIONS.push({ id: 'gate_temple', type: 'gate', to: 'temple_in', label: 'เข้าวัด', icon: '🛕', x: 74, y: 72.8, r: 1.9, area: 'town', facade: F });
  GATES.temple_in = { x: X + 3.5, y: Y + 17 }; GATES.town_from_temple = { x: 74, y: 73.8 };
}
// ================================================================= the park, dressed up: a food court on the south lawn, café tables,
// flowerbeds along the main walk and more blossom trees (added after everything else, so nothing older moves)
{
  const X = PARK.x, Y = PARK.y, free = (x, y) => get(Math.floor(x), Math.floor(y - .5)) === '.' && !PROPS.some(q => Math.hypot(q.x - x, q.y - y) < 1.3) && !STATIONS.some(q => q.area === 'park' && Math.hypot((q.cx ?? q.x) - x, (q.cy ?? q.y) - y) < (q.w ? q.w / 2 + 1.5 : 1.5));
  const put = (sp, x, y, solid = true) => { if (free(x, y)) prop(sp, x, y, solid); };
  for (const c of [30.5, 37.2]) put('x_cafeset', X + c, Y + 15.4);                     // café tables on the lawn by the shooting gallery
  for (const c of [32.2, 35.5]) put('o_parasol', X + c, Y + 15.2, false);
  for (let c = 2; c < 38; c += 3) { if (Math.abs(c - 7) < 2 || Math.abs(c - 18) < 2 || Math.abs(c - 32) < 2) continue; put(c % 6 === 2 ? 'o_tulips' : 'o_flowerbed', X + c + .5, Y + 9.9, false); }
  for (const [sp, c, r] of [['tree_pink', 12.5, 2], ['tree_white', 24, 2], ['tree_pink2', 24, 6.5], ['tree_pink', 38, 9], ['tree_pink2', 38, 20.5]]) put(sp, X + c, Y + r);
  for (const [sp, c, r] of [['o_potflower', 14.4, 13.6], ['o_potflower', 29, 13.6], ['bush', 20, 21], ['bush', 24, 21], ['o_flowerbed', 1.6, 15], ['o_tulips', 1.6, 18]]) put(sp, X + c, Y + r, false);
}
// 🚜 the suburban farm is gone from the game: it is still generated above (so every other random layout stays exactly
// as it was), then wiped here — no tiles, buildings, props, trees, stations, gates or garden lots left
{
  const inF = (x, y) => x >= FARM.x && x < FARM.x + FARM.w && y >= FARM.y && y < FARM.y + FARM.h;
  rect(FARM.x, FARM.y, FARM.w, FARM.h, ' ');
  const keep = (arr, f) => { const k = arr.filter(f); arr.length = 0; arr.push(...k); };
  keep(BUILDINGS, b => !inF(b.x, b.y)); keep(PROPS, p => !inF(p.x, p.y) && !(p.s === 'sign_walk' && Math.hypot(p.x - 4.6, p.y - 30.3) < .5));
  keep(TREES, t => !inF(t[0], t[1])); keep(STATIONS, st => st.area !== 'farm' && st.id !== 'gate_farm');
  LOTS.length = 0; delete GATES.farm_in; delete GATES.town_from_farm;
}
// ================================================================= ⚽ THE FOOTBALL GROUND (in the farm's empty space): an 18 x 10 pitch with a goal at each
// end, stands (you can sit on them) and a scoreboard along the north, dugouts and a snack kiosk along the south. The ball is simulated by the server.
// deco: [sprite in football.webp, x, y of the bottom centre] (drawn by the client); solid footprints are 'o' tiles here.
const FBJ = require('../public/assets/football.json');
const FOOTBALL = { pitch: { x: FIELD.x + 6, y: FIELD.y + 8, w: 18, h: 10 }, goalH: 3, deco: [] };
{
  const X = FIELD.x, Y = FIELD.y, F = FIELD, P = FOOTBALL.pitch;
  rect(F.x, F.y, F.w, F.h, '.');
  const tree = (x, y) => { set(x, y, 'T'); TREES.push([x, y, TREE_KINDS[(x * 7 + y * 13) % TREE_KINDS.length]]); };
  for (let x = F.x; x < F.x + F.w; x++) { tree(x, F.y); tree(x, F.y + F.h - 1); }
  for (let y = F.y + 1; y < F.y + F.h - 1; y++) { tree(F.x, y); tree(F.x + F.w - 1, y); }
  rect(X + 1, Y + 5, 3, 2, 'c'); rect(X + 1, Y + 7, F.w - 2, 1, 'c'); rect(X + 1, Y + 18, F.w - 2, 1, 'c');   // the way in (north-west) and walks along both touchlines
  const deco = (s, x, y, w = 0, d = 0) => { FOOTBALL.deco.push([s, x, y]); if (w) rect(Math.round(x - w / 2), Math.ceil(y) - d, w, d, 'o'); };
  // the stands are open (walk up onto them): every seat is a place to sit and watch
  const sw = FBJ.sprites.stands, SW = sw[4], SH = SW * sw[3] / sw[2];
  for (const cx of [8, 22]) {
    const x0 = X + cx - SW / 2, by = Y + 6.9;
    deco('stands', X + cx, by);
    [[.19, .38], [.41, .38], [.62, .38], [.84, .38], [.19, .81]].forEach(([fx, fy], k) =>
      STATIONS.push({ id: `seat_fb${cx}_${k}`, type: 'seat', label: 'นั่งดูบอลบนอัฒจันทร์', icon: '🏟️', x: +(x0 + SW * fx).toFixed(2), y: +(by - SH + SH * fy + .15).toFixed(2), r: .6, area: 'field' }));
  }
  FOOTBALL.standTop = +(Y + 6.9 - SH + SH * .38).toFixed(2);   // the client draws the stands under anyone sitting on them
  deco('score', X + 15, Y + 6.9, 3, 1);
  for (const [cx, cy] of [[3.6, 7.9], [26.4, 7.9], [3.6, 19.6], [26.4, 19.6]]) deco('light', X + cx, Y + cy, 1, 1);
  for (const cx of [10, 20]) deco('dugout', X + cx, Y + 20.8, 4, 2);
  deco('kiosk', X + 26, Y + 21.3, 2, 2); deco('cooler', X + 15, Y + 20.2, 1, 1); deco('trophy', X + 2.4, Y + 10.5, 1, 1);
  deco('cones', X + 3, Y + 15.8);
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) deco('flag', P.x + fx * P.w + (fx ? .25 : -.25), P.y + fy * P.h + (fy ? .35 : -.05));
  STATIONS.push({ id: 'gate_town_fb', type: 'gate', to: 'town_from_field', label: 'กลับเข้าเมือง', icon: '🏙️', x: X + 2, y: Y + 6.2, r: 1.5, area: 'field' });
  STATIONS.push({ id: 'gate_field', type: 'gate', to: 'field_in', label: 'ไปสนามฟุตบอล', icon: '⚽', x: 3, y: 32, r: 1.6, area: 'town' });   // where the farm road used to leave town
  GATES.field_in = { x: X + 4, y: Y + 6.2 }; GATES.town_from_field = { x: 5.5, y: 32 };
}
const AREAS = [TOWN, HOUSING, PARK, TEMPLE, FIELD, ...ROOMS, ...YARDS];
const areaAt = (x, y) => AREAS.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
const roomAt = (x, y) => { const a = areaAt(x, y); return a && a.kind === 'room' ? a : null; };
for (const s of STATIONS) if (!s.area) s.area = areaAt(s.x, s.y)?.id;
const TILES = grid.map(r => r.join(''));
const SOLID = 'wBT# og';
const isSolidTile = (tx, ty) => tx < 0 || ty < 0 || tx >= W || ty >= H || SOLID.includes(grid[ty][tx]);
const RADIUS = 0.3;
function blocked(x, y, r = RADIUS) {
  return isSolidTile(Math.floor(x - r), Math.floor(y - r)) || isSolidTile(Math.floor(x + r), Math.floor(y - r)) ||
         isSolidTile(Math.floor(x - r), Math.floor(y + r)) || isSolidTile(Math.floor(x + r), Math.floor(y + r));
}
const SPAWN = { x: 50, y: 36.6 };
// a seat whose spot is walled in on every side would trap whoever sits there (the joystick just rubber-bands): move it to the nearest spot with a free way out
{
  const clear = (x0, y0, x1, y1) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2)); for (let i = 1; i <= n; i++) if (blocked(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, i === n ? RADIUS - 0.04 : RADIUS - 0.12)) return false; return true; };
  const open = (x, y) => { let k = 0; for (let i = 0; i < 8; i++) if (clear(x, y, x + Math.cos(i * Math.PI / 4) * .15, y + Math.sin(i * Math.PI / 4) * .15)) k++; return k; };
  for (const st of STATIONS) {
    if (st.type !== 'seat' || open(st.x, st.y) > 0) continue;
    let best = null;
    for (let dx = -1.5; dx <= 1.5; dx += .1) for (let dy = -1.5; dy <= 1.5; dy += .1) {
      const x = st.x + dx, y = st.y + dy, d = Math.hypot(dx, dy);
      if ((!best || d < best.d) && !blocked(x, y) && open(x, y) === 8) best = { d, x: +x.toFixed(2), y: +y.toFixed(2) };
    }
    if (best) { st.x = best.x; st.y = best.y; }
  }
}

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
// ---------------------------------------------------------------- stock market (traded at the bank)
// Prices are a deterministic random walk from a fixed start date (so restarts keep the same history): mean-reverting around a slowly
// drifting fair value, with trend regimes and the odd news shock. One candle every 30 real seconds; vol = typical move per candle.
const STOCKS = [
  { id: 'TTECH', name: 'ไทยเทค', icon: '🏢', base: 120, vol: 0.006, desc: 'บริษัทไอทีที่พนักงานในเมืองทำงานอยู่' },
  { id: 'LTB', name: 'ธนาคารไลฟ์ทาวน์', icon: '🏦', base: 85, vol: 0.003, desc: 'หุ้นปันผลมั่นคง ขึ้นลงช้า' },
  { id: 'FARM', name: 'สหกรณ์การเกษตร', icon: '🌾', base: 42, vol: 0.005, desc: 'ราคาพุ่งช่วงภัยแล้ง', ev: { drought: 0.004, rain: -0.002 } },
  { id: 'SEAFD', name: 'ประมงทองคำ', icon: '🐟', base: 28, vol: 0.006, desc: 'ธุรกิจปลาและอาหารทะเล' },
  { id: 'RIDE', name: 'ส่งไวเดลิเวอรี่', icon: '🛵', base: 65, vol: 0.008, desc: 'ขึ้นแรงช่วงเทศกาลและคนหิว', ev: { festival: 0.004, hungry: 0.004 } },
  { id: 'FUEL', name: 'พลังงานไทย', icon: '⛽', base: 150, vol: 0.004, desc: 'ปั๊มน้ำมันและพลังงาน' },
  { id: 'MOON', name: 'มูนคอยน์', icon: '🚀', base: 12, vol: 0.025, desc: 'เสี่ยงสูงมาก ขึ้นลงทีละหลายสิบ%' },
];
const STOCK = { candleMs: 30000, epoch: Date.UTC(2026, 10, 1), fee: 0.0015, feeMin: 5, keep: 240 };
// the 24-hour store: what it stocks and its shelf mark-up over the base price
const PSHOP = { items: ['popcorn', 'cottoncandy', 'icecream', 'soda', 'hotdog', 'balloon', 'parkplush'], markup: 1 };   // the amusement park's snack bar & souvenirs
const TSHOP = { items: ['offering', 'malai', 'amulet', 'khaotom', 'kanomthai', 'namlamyai', 'water'], markup: 1 };
const TEMPLEQ = { pray: 20, blessMin: 20, blessMul: 1.05, almsStops: 5, almsFrom: 5, almsTo: 10, almsPay: 140, almsTip: [10, 30], almsFood: ['khaotom', 'kanomthai', 'bread', 'water', 'namlamyai'] };
const CSTORE = { items: ['water', 'bread', 'coffee', 'bento', 'icecream', 'snack', 'drink', 'noodle', 'painkiller', 'medkit', 'umbrella'], markup: 1.35 };
const HOURS = { fashion: [9, 21], furnshop: [9, 21], barber: [9, 21], police: [0, 24], square: [6, 22], office: [6, 21], market: [0, 24], warehouse: [5, 20], restaurant: [7, 23], kitchen: [5, 23], hospital: [0, 24], school: [7, 18],
  bank: [8, 17], dealer: [8, 20], toolshop: [8, 20], rider: [6, 23], coop: [5, 20], farmbuy: [5, 20], estate: [0, 24], flower: [8, 20], plantshop: [8, 20], tshop: [6, 20], fishclub: [0, 24], petshop: [9, 21], pet1: [9, 21], pet2: [9, 21] };
const isOpen = (kind, h) => { const o = HOURS[kind]; return !o || (h >= o[0] && h < o[1]); };
const SHIFT = { start: 8, end: 17, grace: 8.25, lunch: null, ot: 21, otMul: 1.25 };   // ot: overtime after 17:00 until the office closes, paid x1.25
// doctors are paid for every game hour they spend inside the hospital during their shift
const DOCTOR = { start: 8, end: 20, wage: [88, 98, 110, 125, 140, 158, 178] };   // (old shift pay, kept for reference)
// ICU cases: pay per case by level, x (0.6 + 0.6 * score); a new case is ready this long after the last one
const ICU = { pay: [55, 62, 70, 80, 90, 104, 120], next: 45000, energy: 6,
  cpr: { n: 20, bpm: [100, 110, 120] }, surgery: { steps: 5 },
  patients: ['คุณสมชาย (หัวใจหยุดเต้น)', 'ป้าบุญมี (หมดสติกลางตลาด)', 'น้องปิ่น (อุบัติเหตุจักรยาน)', 'ลุงเหม (ไส้ติ่งแตก)', 'พี่ก้อง (ถูกรถชน)', 'คุณยายทองคำ (หัวใจวาย)', 'หนุ่มนักวิ่ง (ล้มหมดสติ)', 'ช่างไฟ (ไฟดูด)'] };   // above office: needs a degree + licence
// lost-dog cases for police: find the dog before the time runs out; pay = base + perMin x the minutes the search took (x a speed bonus when found early)
// job mini-games, played on the client and paid by the server: score is capped by max and by how long the game ran (rate per second)
// 🎈 balloons: buy once, hold one in your hand (shown to everyone); shape 'h' = heart, 's' = star
const BALLOONS = {
  red: { name: 'ลูกโป่งแดง', c: '#ff4d5e', price: 80 }, blue: { name: 'ลูกโป่งฟ้า', c: '#4da6ff', price: 80 }, yellow: { name: 'ลูกโป่งเหลือง', c: '#ffd23a', price: 80 },
  green: { name: 'ลูกโป่งเขียว', c: '#5ad15a', price: 80 }, pink: { name: 'ลูกโป่งชมพู', c: '#ff8ad0', price: 100 }, purple: { name: 'ลูกโป่งม่วง', c: '#a77bff', price: 100 },
  white: { name: 'ลูกโป่งขาว', c: '#f4f4f4', price: 120 }, black: { name: 'ลูกโป่งดำ', c: '#3a3a44', price: 150 },
  heart: { name: 'ลูกโป่งหัวใจ', c: '#ff3a6a', price: 400, sh: 'h' }, star: { name: 'ลูกโป่งดาว', c: '#ffc21a', price: 400, sh: 's' },
  gold: { name: 'ลูกโป่งทองคำ', c: '#e8b830', price: 0, gems: 5, sh: 's' },
};
const JOBGAMES = {
  spot:  { career: 'police', name: 'จับผิดภาพหาโจร', icon: '🔍', energy: 5, cd: 25, min: 10, max: 5, per: 8, rate: .5 },
  shoot: { career: 'police', name: 'ซ้อมยิงเป้า', icon: '🎯', energy: 4, cd: 25, min: 20, max: 30, per: 1.4, rate: 1.6 },
  cash:  { career: 'cashier', name: 'คิดเงินทอนลูกค้า', icon: '🧾', energy: 4, cd: 15, min: 20, max: 10, per: 5.5, rate: .4 },
  type:  { career: 'office', name: 'พิมพ์เอกสารตามแบบ', icon: '⌨️', energy: 4, cd: 20, min: 10, max: 12, per: 6, rate: .5 },
  stock: { career: 'cashier', name: 'เติมของและจัดเรียงชั้น', icon: '📦', energy: 4, cd: 15, min: 20, max: 24, per: 2.6, rate: 1.2 },
  vend:  { career: 'merchant', name: 'ส่งของเติมตู้กดน้ำ', icon: '🥤', energy: 4, cd: 20, min: 20, max: 30, per: 2.2, rate: 1.3 },
  slice: { career: '', name: 'หั่นผักผลไม้', icon: '🔪', energy: 5, cd: 18, min: 10, max: 70, per: 1.5, rate: 2.5, dayCap: 3000 },   // anyone, at the big kitchen; capped per day
};
// the police "find the thief" case: like the lost dog, but drive out to where the red-named thief was seen and catch him
const THIEFQ = { energy: 6, next: 30000, base: 110, perMin: 100, names: ['ไอ้เสือดำ', 'ไอ้โจ๊ก', 'เจ้ามืด', 'ไอ้ตี๋มือไว', 'เจ้าหน้ากาก', 'ไอ้ปลาไหล', 'เจ้าจิ้งจก'], stole: ['กระเป๋าสตางค์', 'มือถือ', 'สร้อยทอง', 'กล้องถ่ายรูป', 'จักรยาน', 'นาฬิกาหรู'] };
const DOGQ = { next: 27000, energy: 5, base: 70, perMin: 90, early: .25, minSteps: 40, maxSteps: 150,
  dogs: ['shiba', 'golden', 'corgi', 'pug', 'husky', 'dalmatian', 'poodle', 'pom', 'chihuahua'],
  names: ['โมจิ', 'ถุงเงิน', 'ทองดี', 'บราวนี่', 'ข้าวปั้น', 'ลัคกี้', 'มะลิ', 'ซุปเปอร์', 'โบว์', 'หมูกรอบ', 'ลาเต้', 'ขาวจั๊วะ'],
  owners: ['คุณยายบุญมี', 'น้องปิ่น', 'ลุงสมชาย', 'ป้าแดง', 'คุณหมอใจดี', 'เด็กชายต้น', 'พี่ติ๊ก', 'ครูสมศรี'] };
// calendar: 12 months of 5 game days (a month = 2 real hours, a year = 1 real day). Water & electricity are billed monthly.
const MONTH_DAYS = 5;
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const monthIdx = t => Math.floor(dayAt(t) / MONTH_DAYS);
const YEAR0 = Math.floor(Math.floor(Date.UTC(2026, 10, 1) / DAY_MS) / (MONTH_DAYS * 12)) * MONTH_DAYS * 12;   // year 2569 starts here
const dateAt = t => { const d = dayAt(t) - YEAR0; return { day: d % MONTH_DAYS + 1, month: Math.floor(d / MONTH_DAYS) % 12, year: 2569 + Math.floor(d / MONTH_DAYS / 12) }; };
// a home's monthly bill: a fixed part + what you used (nights slept, furniture that runs on power)
const UTIL = { water: 80, waterPerSleep: 12, elec: 110, elecPerComfort: 15, elecPerSleep: 10, lateFee: 0.15 };   // roughly half of the old rates (150/25, 220/35/20)
for (const r of ROOMS) r.hours = HOURS[r.rk] || null;
for (const b of BUILDINGS) b.hours = HOURS[b.house !== undefined ? 'house' : b.id] || null;

// ================================================================= items
// kind: crop | fish | meal | goods.  base = what players typically pay; NPCs buy far below it.
const ITEMS = {
  rice:   { name: 'ข้าว', icon: '🌾', kind: 'crop', base: 25 },
  corn:   { name: 'ข้าวโพด', icon: '🌽', kind: 'crop', base: 45, eat: { hunger: 8 } },
  chili:  { name: 'พริก', icon: '🌶️', kind: 'crop', base: 65 },
  durian: { name: 'ทุเรียน', icon: '🍈', kind: 'crop', base: 220, eat: { hunger: 20, energy: 5 } },
  tomato: { name: 'มะเขือเทศ', icon: '🍅', kind: 'crop', base: 90, eat: { hunger: 8 } },
  sunflower: { name: 'ทานตะวัน', icon: '🌻', kind: 'crop', base: 75 },
  pumpkin: { name: 'ฟักทอง', icon: '🎃', kind: 'crop', base: 140, eat: { hunger: 15 } },
  watermelon: { name: 'แตงโม', icon: '🍉', kind: 'crop', base: 190, eat: { hunger: 12, energy: 3 } },

  // fish (rar = rarity 1 ทั่วไป · 2 ไม่ธรรมดา · 3 หายาก · 4 มหากาพย์ · 5 ตำนาน; spr = sprite in the atlas)
  sfish:     { name: 'ปลาซิว', icon: '🐟', kind: 'fish', base: 25, rar: 1 },
  sardine:   { name: 'ปลาซาร์ดีน', icon: '🐟', kind: 'fish', base: 30, rar: 1 },
  herring:   { name: 'ปลาหลังเขียว', icon: '🐟', kind: 'fish', base: 35, rar: 1 },
  carp:      { name: 'ปลาไน', icon: '🐟', kind: 'fish', base: 40, rar: 1 },
  catfish:   { name: 'ปลาดุก', icon: '🐟', kind: 'fish', base: 45, rar: 1 },
  mackerel:  { name: 'ปลาทู', icon: '🐟', kind: 'fish', base: 45, rar: 1 },
  shrimp:    { name: 'กุ้ง', icon: '🦐', kind: 'fish', base: 55, rar: 1 },
  tilapia:   { name: 'ปลานิล', icon: '🐠', kind: 'fish', base: 60, rar: 1 },
  crab:      { name: 'ปู', icon: '🦀', kind: 'fish', base: 75, rar: 2 },
  squid:     { name: 'ปลาหมึก', icon: '🦑', kind: 'fish', base: 80, rar: 2 },
  guppy:     { name: 'ปลาหางนกยูง', icon: '🐠', kind: 'fish', base: 90, rar: 2 },
  snakehead: { name: 'ปลาช่อน', icon: '🐠', kind: 'fish', base: 95, rar: 2 },
  seabass:   { name: 'ปลากะพง', icon: '🐟', kind: 'fish', base: 110, rar: 2 },
  eel:       { name: 'ปลาไหล', icon: '🐍', kind: 'fish', base: 120, rar: 2 },
  puffer:    { name: 'ปลาปักเป้า', icon: '🐡', kind: 'fish', base: 130, rar: 2 },
  trout:     { name: 'ปลาเทราต์', icon: '🐟', kind: 'fish', base: 140, rar: 2 },
  snapper:   { name: 'ปลากะพงแดง', icon: '🐟', kind: 'fish', base: 160, rar: 2 },
  goldfish:  { name: 'ปลาทอง', icon: '🐠', kind: 'fish', base: 220, rar: 3 },
  angelfish: { name: 'ปลาเทวดา', icon: '🐠', kind: 'fish', base: 240, rar: 3 },
  clownfish: { name: 'ปลาการ์ตูน', icon: '🐠', kind: 'fish', base: 250, rar: 3 },
  octopus:   { name: 'ปลาหมึกยักษ์', icon: '🐙', kind: 'fish', base: 260, rar: 3 },
  salmon:    { name: 'ปลาแซลมอน', icon: '🐟', kind: 'fish', base: 280, rar: 3 },
  tuna:      { name: 'ทูน่า', icon: '🐋', kind: 'fish', base: 300, rar: 3 },
  grouper:   { name: 'ปลาเก๋า', icon: '🐟', kind: 'fish', base: 320, rar: 3 },
  stingray:  { name: 'ปลากระเบน', icon: '🐟', kind: 'fish', base: 360, rar: 3 },
  lionfish:  { name: 'ปลาสิงโต', icon: '🐠', kind: 'fish', base: 550, rar: 4 },
  koi:       { name: 'ปลาคาร์ป (โคอิ)', icon: '🎏', kind: 'fish', base: 650, rar: 4 },
  seahorse:  { name: 'ม้าน้ำ', icon: '🐉', kind: 'fish', base: 750, rar: 4 },
  swordfish: { name: 'ปลากระโทงดาบ', icon: '🗡️', kind: 'fish', base: 900, rar: 4 },
  hammerhead:{ name: 'ฉลามหัวค้อน', icon: '🦈', kind: 'fish', base: 1100, rar: 4 },
  shark:     { name: 'ฉลาม', icon: '🦈', kind: 'fish', base: 1200, rar: 4 },
  goldenfish:{ name: 'ปลาทองคำ', icon: '✨', kind: 'fish', base: 5000, rar: 5 },
  mayorkoi:  { name: 'ปลาทองยักษ์นายกฯ', icon: '🐡', kind: 'fish', base: 15000, rar: 5, legend: 1 },
  // second sheet: freshwater (lake/river) and sea fish, plus a few sea creatures
  bluegill:  { name: 'ปลาบลูกิล', icon: '🐟', kind: 'fish', base: 35, rar: 1, w: 'f' },
  perch:     { name: 'ปลาเพิร์ช', icon: '🐟', kind: 'fish', base: 45, rar: 1, w: 'f' },
  sunfish:   { name: 'ปลาซันฟิช', icon: '🐠', kind: 'fish', base: 85, rar: 2, w: 'f' },
  bream:     { name: 'ปลาบรีม', icon: '🐟', kind: 'fish', base: 40, rar: 1, w: 'f' },
  rudd:      { name: 'ปลาตะเพียนขาว', icon: '🐟', kind: 'fish', base: 35, rar: 1, w: 'f' },
  btrout:    { name: 'ปลาเทราต์สีน้ำตาล', icon: '🐟', kind: 'fish', base: 150, rar: 2, w: 'f' },
  chub:      { name: 'ปลาชับ', icon: '🐟', kind: 'fish', base: 45, rar: 1, w: 'f' },
  whitefish: { name: 'ปลาไวท์ฟิช', icon: '🐟', kind: 'fish', base: 90, rar: 2, w: 'f' },
  goby:      { name: 'ปลาบู่', icon: '🐟', kind: 'fish', base: 30, rar: 1, w: 'f' },
  barbel:    { name: 'ปลาบาร์เบล', icon: '🐟', kind: 'fish', base: 120, rar: 2, w: 'f' },
  pangasius: { name: 'ปลาสวาย', icon: '🐟', kind: 'fish', base: 110, rar: 2, w: 'f' },
  roach:     { name: 'ปลาตะเพียน', icon: '🐟', kind: 'fish', base: 30, rar: 1, w: 'f' },
  dace:      { name: 'ปลาซิวหางแดง', icon: '🐟', kind: 'fish', base: 25, rar: 1, w: 'f' },
  zander:    { name: 'ปลาแซนเดอร์', icon: '🐟', kind: 'fish', base: 260, rar: 3, w: 'f' },
  tench:     { name: 'ปลาเทนช์', icon: '🐟', kind: 'fish', base: 100, rar: 2, w: 'f' },
  char:      { name: 'ปลาชาร์', icon: '🐟', kind: 'fish', base: 240, rar: 3, w: 'f' },
  grayling:  { name: 'ปลาเกรย์ลิง', icon: '🐟', kind: 'fish', base: 130, rar: 2, w: 'f' },
  lamprey:   { name: 'ปลาแลมป์เพรย์', icon: '🐍', kind: 'fish', base: 300, rar: 3, w: 'f' },
  mullet:    { name: 'ปลากระบอก', icon: '🐟', kind: 'fish', base: 40, rar: 1, w: 's' },
  anchovy:   { name: 'ปลากะตัก', icon: '🐟', kind: 'fish', base: 20, rar: 1, w: 's' },
  flounder:  { name: 'ปลาตาเดียว', icon: '🐟', kind: 'fish', base: 120, rar: 2, w: 's' },
  sole:      { name: 'ปลาลิ้นหมา', icon: '🐟', kind: 'fish', base: 140, rar: 2, w: 's' },
  halibut:   { name: 'ปลาฮาลิบัต', icon: '🐟', kind: 'fish', base: 380, rar: 3, w: 's' },
  shad:      { name: 'ปลาตะลุมพุก', icon: '🐟', kind: 'fish', base: 35, rar: 1, w: 's' },
  turbot:    { name: 'ปลาเทอร์บอต', icon: '🐟', kind: 'fish', base: 330, rar: 3, w: 's' },
  cod:       { name: 'ปลาค็อด', icon: '🐟', kind: 'fish', base: 150, rar: 2, w: 's' },
  hake:      { name: 'ปลาเฮก', icon: '🐟', kind: 'fish', base: 110, rar: 2, w: 's' },
  whiting:   { name: 'ปลาไวท์ติ้ง', icon: '🐟', kind: 'fish', base: 45, rar: 1, w: 's' },
  saithe:    { name: 'ปลาพอลลอค', icon: '🐟', kind: 'fish', base: 95, rar: 2, w: 's' },
  haddock:   { name: 'ปลาแฮดด็อก', icon: '🐟', kind: 'fish', base: 105, rar: 2, w: 's' },
  bonito:    { name: 'ปลาโอแถบ', icon: '🐟', kind: 'fish', base: 160, rar: 2, w: 's' },
  skipjack:  { name: 'ปลาทูน่าท้องแถบ', icon: '🐟', kind: 'fish', base: 220, rar: 3, w: 's' },
  barracuda: { name: 'ปลาสาก', icon: '🐟', kind: 'fish', base: 340, rar: 3, w: 's' },
  wahoo:     { name: 'ปลาอินทรี', icon: '🐟', kind: 'fish', base: 300, rar: 3, w: 's' },
  marlin:    { name: 'ปลามาร์ลิน', icon: '🗡️', kind: 'fish', base: 1300, rar: 4, w: 's' },
  tunny:     { name: 'ปลาโอดำ', icon: '🐟', kind: 'fish', base: 140, rar: 2, w: 's' },
  threadfin: { name: 'ปลาทรายแดง', icon: '🐟', kind: 'fish', base: 90, rar: 2, w: 's' },
  seabream:  { name: 'ปลาอีคุด', icon: '🐟', kind: 'fish', base: 110, rar: 2, w: 's' },
  parrotfish:{ name: 'ปลานกแก้ว', icon: '🐠', kind: 'fish', base: 380, rar: 3, w: 's' },
  damsel:    { name: 'ปลาสลิดหินฟ้า', icon: '🐠', kind: 'fish', base: 230, rar: 3, w: 's' },
  moray:     { name: 'ปลาไหลมอเรย์', icon: '🐍', kind: 'fish', base: 400, rar: 3, w: 's' },
  lanternfish:{ name: 'ปลาตะเกียง', icon: '🏮', kind: 'fish', base: 600, rar: 4, w: 's' },
  angler:    { name: 'ปลาตกเบ็ด (ปลาแองเกลอร์)', icon: '🎣', kind: 'fish', base: 900, rar: 4, w: 's' },
  starfish:  { name: 'ปลาดาว', icon: '⭐', kind: 'fish', base: 70, rar: 2, w: 's' },
  jellyfish: { name: 'แมงกะพรุน', icon: '🪼', kind: 'fish', base: 15, rar: 1, w: 's' },
  turtle:    { name: 'เต่าทะเล', icon: '🐢', kind: 'fish', base: 1500, rar: 4, w: 's' },
  dolphin:   { name: 'โลมา', icon: '🐬', kind: 'fish', base: 4000, rar: 5, w: 's' },
  chest:    { name: 'หีบสมบัติ', icon: '💎', kind: 'fish', base: 3000, rar: 4 },

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

  // convenience-store goods (sold only at the 24-hour store)
  offering: { name: 'ชุดธูปเทียนดอกไม้', icon: '🪷', kind: 'goods', base: 20 },
  malai:  { name: 'พวงมาลัยดอกมะลิ', icon: '🌼', kind: 'goods', base: 30 },
  khaotom: { name: 'ข้าวต้มมัด', icon: '🍙', kind: 'goods', base: 25, eat: { hunger: 20 } },
  kanomthai: { name: 'ขนมไทย', icon: '🍡', kind: 'goods', base: 18, eat: { hunger: 8, happy: 3 } },
  amulet: { name: 'ผ้ายันต์นำโชค', icon: '🧧', kind: 'goods', base: 199 },
  namlamyai: { name: 'น้ำลำไยเย็น', icon: '🍯', kind: 'goods', base: 15, eat: { energy: 6, hunger: 3, happy: 1 } },
  water:  { name: 'น้ำดื่ม', icon: '💧', kind: 'goods', base: 12, eat: { energy: 3, hunger: 2 } },
  bread:  { name: 'ขนมปังไส้หมูหยอง', icon: '🥐', kind: 'goods', base: 30, eat: { hunger: 18 } },
  coffee: { name: 'กาแฟกระป๋อง', icon: '☕', kind: 'goods', base: 35, eat: { energy: 12 } },
  umbrella: { name: 'ร่มกันฝน', icon: '☂️', kind: 'goods', base: 180, umb: 1 },   // sold only by the umbrella man who walks into the square when it rains · kept in the bag: opens by itself when it rains outdoors, keeps you dry (no cold from the rain)
  bento:  { name: 'ข้าวกล่องเวฟ', icon: '🍱', kind: 'goods', base: 55, eat: { hunger: 32, energy: 4 } },
  petegg: { name: 'ไข่สัตว์เลี้ยงปริศนา', icon: '🥚', kind: 'goods', base: 0, egg: 1 },   // from inviting friends: open it in the bag to hatch a random pet
  popcorn: { name: 'ป๊อปคอร์นคาราเมล', icon: '🍿', kind: 'goods', base: 45, eat: { hunger: 8, happy: 5 } },
  cottoncandy: { name: 'สายไหมสีชมพู', icon: '🍭', kind: 'goods', base: 35, eat: { hunger: 3, happy: 7 } },
  soda: { name: 'น้ำอัดลมเย็นเจี๊ยบ', icon: '🥤', kind: 'goods', base: 25, eat: { hunger: 2, happy: 3 } },
  hotdog: { name: 'ฮอตดอกจัมโบ้', icon: '🌭', kind: 'goods', base: 60, eat: { hunger: 22, happy: 2 } },
  balloon: { name: 'ลูกโป่งสวนสนุก', icon: '🎈', kind: 'goods', base: 50, eat: { happy: 10 } },
  parkplush: { name: 'ตุ๊กตาของฝากสวนสนุก', icon: '🧸', kind: 'goods', base: 250 },
  icecream: { name: 'ไอศกรีมแท่ง', icon: '🍦', kind: 'goods', base: 25, eat: { hunger: 6, happy: 4 } },
  snack:  { name: 'ขนม', icon: '🍪', kind: 'goods', base: 30, eat: { hunger: 10 }, wholesale: 18, stock: 80, refill: 8 },
  drink:  { name: 'เครื่องดื่มชูกำลัง', icon: '🥤', kind: 'goods', base: 400, eat: { energy: 20 }, keepEnergy: 1, dayMax: 3, wholesale: 280, stock: 12, refill: 25 },   // the one drink that still gives energy: pricey, 3 a day
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
  tomato: { seed: 70, grow: 600, min: 4, max: 5 },
  sunflower: { seed: 60, grow: 540, min: 4, max: 5 },
  pumpkin: { seed: 110, grow: 720, min: 3, max: 4 },
  watermelon: { seed: 150, grow: 840, min: 3, max: 4 },
};
// ops: what each ingredient goes through in the cooking battle before it goes on the plate (chop / fry need you standing
// at the board or the pan; boil / grill cook by themselves and must be taken off in time or they are ruined)
const RECIPES = [
  { id: 'fried_rice',   in: { rice: 2 }, ops: { rice: ['fry'] } },
  { id: 'corn_soup',    in: { corn: 2, rice: 1 }, ops: { corn: ['chop', 'boil'], rice: ['boil'] } },
  { id: 'grilled_fish', in: { catfish: 1, chili: 1 }, ops: { catfish: ['chop', 'grill'], chili: ['chop'] } },
  { id: 'tomyum',       in: { tilapia: 1, chili: 1, corn: 1 }, ops: { tilapia: ['chop', 'boil'], chili: ['chop'], corn: ['chop', 'boil'] } },
  { id: 'durian_sweet', in: { durian: 1, rice: 1 }, ops: { durian: ['chop'], rice: ['boil'] } },
];
const COOK = { chop: 4, fry: 5, boil: 7, grill: 6, window: { boil: 9, grill: 6 }, grillMax: 2 };
// fishing pools: [id, weight]. null = junk
// what bites where. The first sheet's fish keep their hand-set weights; the second sheet's join every water of their kind
// ('f' fresh: river + lake, 's' sea) with a weight by rarity. The nothing-bites weight is then set so a cast is worth about
// the same on average as before (river ~38, lake ~56, sea ~72), so more species never means more money.
const FISH = {
  river: [['sfish', 48], ['carp', 26], ['catfish', 24], ['tilapia', 10], ['snakehead', 4], ['eel', 3], ['guppy', 2.5], ['goldfish', 1], ['koi', 0.2], ['goldenfish', 0.02]],
  lake:  [['sfish', 34], ['carp', 20], ['tilapia', 24], ['snakehead', 9], ['seabass', 4], ['trout', 4], ['guppy', 3], ['goldfish', 2], ['salmon', 1.2], ['koi', 0.45], ['chest', 0.1], ['goldenfish', 0.03]],
  sea:   [['sardine', 26], ['mackerel', 18], ['herring', 14], ['shrimp', 9], ['crab', 6], ['squid', 9], ['puffer', 3], ['snapper', 3], ['seabass', 4],
          ['clownfish', 1.2], ['angelfish', 1.2], ['octopus', 1.2], ['grouper', 1.2], ['tuna', 1.6], ['stingray', 0.8], ['lionfish', 0.3], ['seahorse', 0.25], ['swordfish', 0.25], ['hammerhead', 0.2], ['shark', 0.35], ['chest', 0.15], ['goldenfish', 0.025]],
};
{
  const RW = [0, 9, 3.5, 1.1, 0.22, 0.02], TARGET = { river: 38, lake: 56, sea: 72 };
  for (const [k, it] of Object.entries(ITEMS)) if (it.w) for (const pool of it.w === 'f' ? ['river', 'lake'] : ['sea']) FISH[pool].push([k, RW[it.rar]]);
  for (const pool in FISH) {
    const wsum = FISH[pool].reduce((t, [, w]) => t + w, 0), vsum = FISH[pool].reduce((t, [id, w]) => t + w * ITEMS[id].base, 0);
    FISH[pool].unshift([null, Math.max(10, vsum / TARGET[pool] - wsum)]);
  }
}
// rods: bought from the fishing club, kept in the bag, one equipped. zone = width of the timing window, luck = how much
// more often rare (and better) fish bite, junk = how often nothing/junk bites (x the base chance)
const RODS = {
  bamboo: { name: 'เบ็ดไม้ไผ่', icon: '🎋', price: 150, zone: 0.20, luck: 1.0, junk: 1.0, desc: 'เบ็ดเริ่มต้น' },
  fiber:  { name: 'เบ็ดไฟเบอร์กลาส', icon: '🎣', price: 1500, zone: 0.24, luck: 1.25, junk: 0.75, desc: 'จังหวะกว้างขึ้นนิด ปลาหายากบ่อยขึ้น' },
  carbon: { name: 'เบ็ดคาร์บอน', icon: '🎣', price: 6000, zone: 0.28, luck: 1.55, junk: 0.55, desc: 'เบา ไว ขยะน้อยลง' },
  pro:    { name: 'เบ็ดโปรตกทะเล', icon: '🎣', price: 20000, zone: 0.33, luck: 1.9, junk: 0.4, desc: 'สำหรับปลาใหญ่ ปลาหายากบ่อยขึ้นมาก' },
  gold:   { name: 'เบ็ดทองคำ', icon: '✨', price: 75000, zone: 0.38, luck: 2.4, junk: 0.25, desc: 'แทบไม่เจอขยะ' },
  dragon: { name: 'เบ็ดมังกรทะเลลึก', icon: '🐉', price: 250000, zone: 0.44, luck: 3.2, junk: 0.12, desc: 'เบ็ดในตำนาน ปลามหากาพย์-ตำนานกินเบ็ดบ่อยที่สุด' },
};
const ROD_ORDER = Object.keys(RODS);
// profile frames (public/assets/frames.webp, in this order): 12 metal & gem rings, 12 cute ones, 12 special ones (rainbow and neon are on sale, the rest locked for now)
const FRAMES = [
  ['กรอบไม้', 300], ['กรอบไม้หมุด', 600], ['กรอบเงิน', 1500], ['กรอบทอง', 3000], ['กรอบแพลทินัม', 5000], ['แหวนเพชร', 12000],
  ['แหวนทับทิม', 6000], ['แหวนมรกต', 6000], ['แหวนไพลิน', 6000], ['แหวนอเมทิสต์', 7000], ['สร้อยไข่มุก', 8000], ['ออบซิเดียน', 9000],
  ['ซากุระ', 2000], ['ทานตะวัน', 2000], ['เถาวัลย์ดอกไม้', 2500], ['ปุยเมฆ', 2500], ['ออร่าชมพู', 3000], ['ราตรีดาว', 3500],
  ['หัวใจ', 2500], ['แมวเหมียว', 3000], ['กระต่ายโบว์', 3000], ['น้องหมา', 3000], ['ลูกกวาด', 3500], ['ป่าเห็ด', 3500],
  ['มงกุฎราชา', 0, 1], ['ปีกเทวดา', 0, 1], ['ปีศาจ', 0, 1], ['เปลวเพลิง', 0, 1], ['คริสตัลน้ำแข็ง', 0, 1], ['สายฟ้า', 0, 1],
  ['กาแล็กซี', 0, 1], ['สายรุ้ง', 12000, 1, 1], ['นีออน', 12000, 1, 1], ['ลายไทย', 0, 1], ['ดอกบัว', 0, 1], ['สายน้ำ', 0, 1],
].map(([name, price, special, open], id) => ({ id, name, price, special: !!special, locked: !!special && !open }));   // 4th flag: a special frame that is on sale
// pets: bought in the pet panel (the pet shops are closed for renovation), one follows you around. rar 1-5 like fish
const PETS = {
  chick:    { name: 'ลูกเจี๊ยบ', icon: '🐤', price: 500, rar: 1, desc: 'ตัวจิ๋วเจี๊ยบๆ กระโดดตุ๊บๆ' },
  duck:     { name: 'ลูกเป็ด', icon: '🦆', price: 600, rar: 1, desc: 'เดินส่ายก้นกุ๊กกิ๊ก' },
  hamster:  { name: 'แฮมสเตอร์', icon: '🐹', price: 800, rar: 1, desc: 'แก้มป่องน่าฟัด' },
  guinea:   { name: 'หนูตะเภา', icon: '🐹', price: 1000, rar: 1, desc: 'ตัวกลมๆ นุ่มนิ่ม' },
  tabby:    { name: 'แมวส้ม', icon: '🐱', price: 1200, rar: 1, desc: 'แมวส้มหน้าตายิ้มแย้ม' },
  blackcat: { name: 'แมวดำ', icon: '🐈‍⬛', price: 1500, rar: 1, desc: 'ตาสีทอง นำโชค' },
  shiba:    { name: 'ชิบะ', icon: '🐕', price: 1500, rar: 1, desc: 'ซนแต่ซื่อสัตย์' },
  rabbit:   { name: 'กระต่ายขาว', icon: '🐰', price: 1500, rar: 1, desc: 'กระโดดเก่งที่สุด' },
  lop:      { name: 'กระต่ายหูตก', icon: '🐰', price: 1800, rar: 1, desc: 'หูยาวตกลงมาน่ารัก' },
  pug:      { name: 'ปั๊ก', icon: '🐶', price: 1800, rar: 1, desc: 'หน้ายู่ ตัวกลม' },
  whitecat: { name: 'แมวขาว', icon: '🐈', price: 1800, rar: 1, desc: 'ขนขาวฟู ตาสองสี' },
  golden:   { name: 'โกลเดนรีทรีฟเวอร์', icon: '🦮', price: 2000, rar: 2, desc: 'เพื่อนซี้ใจดี' },
  calico:   { name: 'แมวสามสี', icon: '🐱', price: 2000, rar: 2, desc: 'ขนสามสีมงคล' },
  hedgehog: { name: 'เม่นน้อย', icon: '🦔', price: 2000, rar: 2, desc: 'หนามนุ่มๆ ไม่เจ็บ' },
  siamese:  { name: 'แมววิเชียรมาศ', icon: '🐱', price: 2200, rar: 2, desc: 'ตาสีฟ้าสวยสง่า' },
  britcat:  { name: 'แมวบริติช', icon: '🐱', price: 2200, rar: 2, desc: 'หน้ากลมแก้มป่อง' },
  squirrel: { name: 'กระรอก', icon: '🐿️', price: 2200, rar: 2, desc: 'หางฟูเป็นเกลียว' },
  corgi:    { name: 'คอร์กี้', icon: '🐕', price: 2500, rar: 2, desc: 'ก้นกลมวิ่งแล้วส่าย' },
  chihuahua:{ name: 'ชิวาวา', icon: '🐕', price: 2500, rar: 2, desc: 'ตัวเล็ก หูใหญ่ ใจกล้า' },
  oddeye:   { name: 'แมวตาสองสี', icon: '🐈', price: 2800, rar: 3, desc: 'ตาสีทอง–ฟ้า หายากนิดๆ' },
  dalmatian:{ name: 'ดัลเมเชียน', icon: '🐕', price: 2800, rar: 3, desc: 'จุดดำเต็มตัว' },
  husky:    { name: 'ฮัสกี้', icon: '🐺', price: 3000, rar: 3, desc: 'ตาสีฟ้า ขนหนา' },
  pom:      { name: 'ปอมเมอเรเนียน', icon: '🐕', price: 3200, rar: 3, desc: 'ก้อนขนสีส้มฟูฟ่อง' },
  poodle:   { name: 'พุดเดิ้ลชมพู', icon: '🐩', price: 3500, rar: 3, desc: 'ผูกโบว์ชมพู' },
  turtle:   { name: 'เต่าน้อย', icon: '🐢', price: 4000, rar: 3, desc: 'ช้านิด แต่ไม่ทิ้งกัน' },
  capybara: { name: 'คาปิบาร่า', icon: '🦫', price: 8000, rar: 4, desc: 'ใจเย็นสุดๆ มีส้มบนหัว' },
  fox:      { name: 'จิ้งจอกส้ม', icon: '🦊', price: 9000, rar: 4, desc: 'หางฟูปลายขาว' },
  redpanda: { name: 'แพนด้าแดง', icon: '🦝', price: 12000, rar: 4, desc: 'หางลายวงแหวน' },
  penguin:  { name: 'เพนกวินน้อย', icon: '🐧', price: 15000, rar: 4, desc: 'ขนปุยเทาเดินเตาะแตะ' },
  panda:    { name: 'แพนด้า', icon: '🐼', price: 20000, rar: 5, desc: 'สุดยอดความน่ารัก' },
  dragon:   { name: 'มังกรน้อย', icon: '🐲', price: 120000, rar: 5, desc: 'ตำนาน! ปีกเล็กๆ หางม้วน' },
  unicorn:  { name: 'ยูนิคอร์น', icon: '🦄', price: 150000, rar: 5, desc: 'ตำนาน! แผงคอสีรุ้ง' },
};
// which water a spot fishes in: the sea along the east coast, the river in the farm, any other water is "lake" (the lake, ponds)
function waterPool(x, y) {
  let best = null, bd = 1.7;
  for (let j = Math.floor(y) - 2; j <= Math.floor(y) + 2; j++) for (let i = Math.floor(x) - 2; i <= Math.floor(x) + 2; i++) {
    if ((grid[j] || [])[i] !== 'w') continue;
    const d = Math.hypot(Math.max(i - x, 0, x - i - 1), Math.max(j - y, 0, y - j - 1));
    if (d < bd) { bd = d; best = [i, j]; }
  }
  if (!best) return null;
  const a = AREAS.find(r => best[0] >= r.x && best[0] < r.x + r.w && best[1] >= r.y && best[1] < r.y + r.h);
  if (!a || a.kind !== 'map') return null;
  return a.id === 'farm' ? 'river' : a.id === 'town' && best[0] >= 100 ? 'sea' : 'lake';
}
const BIG_FISH = Object.keys(ITEMS).filter(k => ITEMS[k].kind === 'fish' && ITEMS[k].rar >= 3);   // better rods and fish blooms make these bite more
const FISH_RARITY = ['', 'ทั่วไป', 'ไม่ธรรมดา', 'หายาก', 'มหากาพย์', 'ตำนาน'];
for (const k in ITEMS) if (ITEMS[k].kind === 'fish') ITEMS[k].spr = 'fish_' + k;
for (const k of ['rice', 'corn', 'chili', 'durian']) ITEMS[k].spr = 'ic_' + k;   // real pictures for the first four crops (the rest use their emoji)
ITEMS.chest.spr = null;
const FISHING = { rod: 150, xpPerLv: 8, maxLv: 10, zone: [0.2, 0.26, 0.32, 0.4] };   // zone = width of the timing window per rod tier

// ================================================================= careers
// Nobody picks a career at the start: you walk into the right building and apply.
const CAREERS = {
  none:     { name: 'ว่างงาน', icon: '🙂', where: null, desc: 'ยังไม่มีงานทำ ไปสมัครงานตามอาคารต่างๆ' },
  office:   { name: 'พนักงานบริษัท', icon: '👔', where: 'office', need: ['degree'], desc: 'เข้างาน 08:00–17:00 (โอทีต่อได้ถึง 21:00 ค่าส่ง x1.25) รับซองเอกสารที่บริษัทไปส่งตามอาคารทั่วเมือง ได้เงินทุกครั้งที่ส่งถึง ยิ่งไกลยิ่งได้มาก มาสายโดนหักเงินและอาจถูกเลิกจ้าง' },
  merchant: { name: 'พ่อค้า', icon: '🛒', where: 'warehouse', need: [], desc: 'ประมูลสินค้าที่โรงประมูล (คลังสินค้าเดิม) แข่งกับคู่แข่ง เดาราคาให้แม่น ชนะต่ำกว่ามูลค่าจริง = กำไร สูงกว่า = ขาดทุน · ของในกระเป๋ายังวางขายที่ตลาดกลางในราคาที่ตั้งเอง' },
  doctor:   { name: 'แพทย์', icon: '🩺', where: 'hospital', need: ['degree', 'medicine'], desc: 'รับเคสฉุกเฉินที่ ICU: เดินหยิบยา/เครื่องมือแล้วรักษาคนไข้ให้ทันเวลา ได้ค่ารักษาทุกเคส + รักษาคนไข้บนเตียง (วินิจฉัยจากอาการ) ไม่ต้องเข้าเวร' },
  police:   { name: 'ตำรวจ', icon: '👮', where: 'police', need: ['hs', 'policeExam'], desc: 'ตามหาหมาที่หายไปได้ค่าตอบแทนตามเวลา ไปลาดตระเวนและช่วยเหลือชาวเมือง' },
  beggar:   { name: 'ขอทาน', icon: '🥣', where: 'square', need: [], desc: 'สมัครได้ถ้ามีเงิน (สด+ฝาก) ไม่เกิน ฿2,000 · วิ่งเก็บขยะที่ถังขยะ (หลบสิ่งกีดขวางไปเรื่อยๆ จนกว่าจะชน) หรือนั่งขอทาน (🥣) · มีเงินเกิน ฿2,000 พ้นจากขอทานอัตโนมัติ' },
  monk:     { name: 'พระ', icon: '🙏', where: 'wat_pray', need: [], desc: 'บวชเป็นพระที่วัด · เช้า 05:00–10:00 ออกบิณฑบาตรอบเมือง ได้อาหารและปัจจัย · ฉันอาหารได้ถึงเที่ยงวันเท่านั้น · หิวช้ากว่าคนทั่วไป' },
  cashier:  { name: 'พนักงานซูเปอร์มาร์เก็ต', icon: '🧾', where: 'cstore', need: [], desc: 'ยืนแคชเชียร์ที่ร้านสะดวกซื้อ/ซูเปอร์มาร์เก็ตสาขาไหนก็ได้ คิดเงินและทอนเงินลูกค้าให้ถูก ยิ่งถูกยิ่งได้มาก' },
  templeboy: { name: 'เด็กวัด', icon: '🧒', where: 'gate_temple', need: [], desc: 'ช่วยงานวัด: ตามหลวงพ่อบิณฑบาต กวาดลานวัด ซื้อของไหว้พระ บอกบุญ · รับภารกิจที่พี่ตุ๋ยหน้าประตูวัด' },
  undertaker: { name: 'สัปเหร่อ', icon: '⚱️', where: 'gate_temple', need: [], desc: 'ดูแลงานศพ: เตรียมพิธี ปลอบญาติ ลอยอังคาร ซ่อมโลง (ไม่ต้องกลัวผีนะ) · รับภารกิจที่ลุงสัปหน้าประตูวัด' },
  mechanic: { name: 'ช่างซ่อมรถ', icon: '🔧', where: 'door_dealer', need: [], desc: 'ตระเวนซ่อมรถเสียทั่วเมือง ปะยาง เปลี่ยนแบต ตรวจรถโชว์รูม · รับภารกิจที่ช่างเปี๊ยกหน้าโชว์รูมรถ' },
  thug: { name: 'นักเลง', icon: '😎', where: 'market', need: [], desc: 'นักเลงใจดีประจำตลาด: ไกล่เกลี่ยวัยรุ่น ตามหนี้ คุ้มกันเสี่ย (ใช้ปากมากกว่ามือ) · รับภารกิจที่เสี่ยเสือในตลาด' },
  photographer: { name: 'ช่างภาพ', icon: '📷', where: 'square', need: [], desc: 'รับจ้างถ่ายภาพสถานที่ งานแต่ง สัตว์หายาก ทั่วเมือง · รับภารกิจที่พี่โฟกัสที่จัตุรัส' },
  courier: { name: 'พนักงานส่งของ', icon: '📦', where: 'door_warehouse', need: [], desc: 'เดินส่งพัสดุตามบ้าน (ไม่ต้องมีใบขับขี่) ส่งครบเร็วได้โบนัส · รับภารกิจที่พี่ด่วนหน้าคลังสินค้า' },
  rider:    { name: 'ไรเดอร์ส่งอาหาร', icon: '🛵', where: 'rider', need: ['driving'], desc: 'รับออเดอร์จากแอพ ไปรับอาหารที่ร้านอาหาร แล้วไปส่งให้ลูกค้า ได้ค่าส่ง + ทิป (ใบขับขี่ต้องต่ออายุทุกปี)' },
};
// the degree comes from classes at the university; other licences are bought
// classroom pop quizzes: o[0] is the right answer (the server shuffles); lv hs / uni
const QUIZ = [
  { q: "เมืองหลวงของประเทศไทยคือเมืองอะไร", o: ["กรุงเทพมหานคร", "เชียงใหม่", "ภูเก็ต", "ขอนแก่น"], lv: 'hs' },
  { q: "7 × 8 เท่ากับเท่าไร", o: ["56", "54", "48", "64"], lv: 'hs' },
  { q: "น้ำเดือดที่กี่องศาเซลเซียส (ที่ระดับน้ำทะเล)", o: ["100", "90", "120", "80"], lv: 'hs' },
  { q: "ดาวดวงใดอยู่ใกล้ดวงอาทิตย์ที่สุด", o: ["ดาวพุธ", "ดาวศุกร์", "ดาวโลก", "ดาวอังคาร"], lv: 'hs' },
  { q: "พืชใช้ก๊าซอะไรในการสังเคราะห์แสง", o: ["คาร์บอนไดออกไซด์", "ออกซิเจน", "ไนโตรเจน", "ไฮโดรเจน"], lv: 'hs' },
  { q: "สระในภาษาไทยมีทั้งหมดกี่รูป", o: ["21 รูป", "32 รูป", "44 รูป", "18 รูป"], lv: 'hs' },
  { q: "แม่น้ำสายหลักที่ไหลผ่านกรุงเทพฯ คือแม่น้ำอะไร", o: ["เจ้าพระยา", "โขง", "ปิง", "มูล"], lv: 'hs' },
  { q: "ข้อใดเป็นสัตว์เลี้ยงลูกด้วยนม", o: ["ปลาวาฬ", "ปลาฉลาม", "เต่า", "จระเข้"], lv: 'hs' },
  { q: "1 ชั่วโมงมีกี่นาที", o: ["60", "100", "30", "24"], lv: 'hs' },
  { q: "ประเทศใดอยู่ติดกับประเทศไทยทางทิศตะวันออก", o: ["กัมพูชา", "เมียนมา", "มาเลเซีย", "เวียดนาม"], lv: 'hs' },
  { q: "ผลรวมมุมภายในของสามเหลี่ยมคือกี่องศา", o: ["180", "90", "360", "270"], lv: 'hs' },
  { q: "น้ำ (H₂O) ประกอบด้วยธาตุอะไรบ้าง", o: ["ไฮโดรเจนกับออกซิเจน", "ไฮโดรเจนกับคาร์บอน", "ออกซิเจนกับไนโตรเจน", "คาร์บอนกับออกซิเจน"], lv: 'hs' },
  { q: "วันลอยกระทงตรงกับเดือนอะไรตามปฏิทินจันทรคติ", o: ["เดือน 12", "เดือน 5", "เดือน 8", "เดือน 1"], lv: 'hs' },
  { q: "สัตว์ชนิดใดเป็นสัตว์ประจำชาติไทย", o: ["ช้าง", "เสือ", "ม้า", "นกยูง"], lv: 'hs' },
  { q: "12 หารด้วย 4 เท่ากับเท่าไร", o: ["3", "4", "2", "6"], lv: 'hs' },
  { q: "สีแดงผสมสีเหลืองได้สีอะไร", o: ["สีส้ม", "สีเขียว", "สีม่วง", "สีน้ำตาล"], lv: 'hs' },
  { q: "GDP ย่อมาจากอะไร", o: ["Gross Domestic Product", "General Debt Plan", "Global Demand Price", "Gross Dollar Profit"], lv: 'uni' },
  { q: "อัตราเงินเฟ้อสูงขึ้น หมายความว่าอะไร", o: ["ราคาสินค้าโดยรวมสูงขึ้น", "ราคาสินค้าโดยรวมลดลง", "ค่าเงินแข็งขึ้นเสมอ", "คนว่างงานน้อยลงเสมอ"], lv: 'uni' },
  { q: "ข้อใดคือสกุลเงินของประเทศญี่ปุ่น", o: ["เยน", "วอน", "หยวน", "ริงกิต"], lv: 'uni' },
  { q: "ภาษาโปรแกรมใดนิยมใช้เขียนหน้าเว็บให้โต้ตอบได้", o: ["JavaScript", "SQL", "Excel", "Photoshop"], lv: 'uni' },
  { q: "ค่า 2 ยกกำลัง 10 เท่ากับเท่าไร", o: ["1,024", "512", "2,048", "1,000"], lv: 'uni' },
  { q: "ผู้เขียนบทละคร \"โรมิโอกับจูเลียต\" คือใคร", o: ["เชกสเปียร์", "ดิคเกนส์", "โมซาร์ท", "ดาร์วิน"], lv: 'uni' },
  { q: "ทฤษฎีวิวัฒนาการโดยการคัดเลือกตามธรรมชาติ เสนอโดยใคร", o: ["ชาลส์ ดาร์วิน", "ไอแซก นิวตัน", "กาลิเลโอ", "หลุยส์ ปาสเตอร์"], lv: 'uni' },
  { q: "ข้อใดเป็นอวัยวะที่สูบฉีดเลือดไปทั่วร่างกาย", o: ["หัวใจ", "ปอด", "ตับ", "ไต"], lv: 'uni' },
  { q: "ธนาคารกลางของประเทศไทยคือ", o: ["ธนาคารแห่งประเทศไทย", "ธนาคารกรุงเทพ", "ธนาคารออมสิน", "ธนาคารกสิกรไทย"], lv: 'uni' },
  { q: "ความเร็วแสงในสุญญากาศประมาณกี่กิโลเมตรต่อวินาที", o: ["300,000", "30,000", "3,000", "3,000,000"], lv: 'uni' },
  { q: "ดอกเบี้ยทบต้น หมายถึง", o: ["คิดดอกเบี้ยจากเงินต้นรวมดอกเบี้ยที่สะสม", "คิดดอกเบี้ยจากเงินต้นเท่านั้น", "ไม่มีดอกเบี้ย", "ดอกเบี้ยลดลงทุกปี"], lv: 'uni' },
  { q: "ข้อใดคือหน่วยวัดความถี่", o: ["เฮิรตซ์", "โอห์ม", "โวลต์", "นิวตัน"], lv: 'uni' },
  { q: "โรคใดเกิดจากการขาดวิตามินซี", o: ["เลือดออกตามไรฟัน (โรคลักปิดลักเปิด)", "โรคเหน็บชา", "โรคกระดูกอ่อน", "โรคตาบอดกลางคืน"], lv: 'uni' },
  { q: "เมืองหลวงของประเทศออสเตรเลียคือ", o: ["แคนเบอร์รา", "ซิดนีย์", "เมลเบิร์น", "เพิร์ธ"], lv: 'uni' },
];
const LICENSES = {
  hs:       { name: 'วุฒิ ม.6', icon: '📘', price: 1500, classes: 4, where: 'school' },
  degree:   { name: 'ปริญญาตรี', icon: '🎓', price: 4500, classes: 6, need: 'hs', where: 'school' },
  policeExam: { name: 'ผลสอบนายสิบตำรวจ', icon: '👮', price: 1000, need: 'hs', where: 'school', test: true },
  cooking:  { name: 'ใบรับรองเชฟ', icon: '📜', price: 1800, where: 'school' },
  medicine: { name: 'ใบประกอบวิชาชีพเวชกรรม', icon: '⚕️', price: 15000, need: 'degree', where: 'school' },
  driving:  { name: 'ใบขับขี่', icon: '🪪', price: 1200, where: 'dealer', test: true, renew: 600 },
};
const DRIVING_TEST = [
  { q: 'สัญญาณไฟสีเหลือง หมายถึงอะไร', a: ['เร่งความเร็วผ่านไป', 'เตรียมหยุดรถ', 'จอดรถได้ทันที'], ok: 1 },
  { q: 'ขี่มอเตอร์ไซค์ต้องสวมอะไรทุกครั้ง', a: ['หมวกกันน็อก', 'แว่นกันแดด', 'ถุงมือ'], ok: 0 },
  { q: 'เห็นคนกำลังข้ามทางม้าลาย ควรทำอย่างไร', a: ['บีบแตรไล่', 'ขับอ้อมไป', 'หยุดรถให้คนข้าม'], ok: 2 },
  { q: 'ป้ายสีแดงแปดเหลี่ยมเขียนว่า หยุด หมายถึง', a: ['หยุดรถก่อนแล้วค่อยไป', 'ลดความเร็ว', 'ห้ามจอด'], ok: 0 },
  { q: 'ดื่มแอลกอฮอล์แล้วควรทำอย่างไร', a: ['ขับช้าๆ', 'ไม่ขับรถ', 'เปิดไฟฉุกเฉินแล้วขับ'], ok: 1 },
];
const POLICE_TEST = [
  { q: 'หมายเลขแจ้งเหตุด่วนเหตุร้ายคือ', a: ['191', '1669', '199'], ok: 0 },
  { q: 'จับกุมผู้ต้องสงสัยได้เมื่อใด', a: ['เมื่อหน้าตาน่าสงสัย', 'เมื่อมีพยานหรือหลักฐานการกระทำผิด', 'ทุกเมื่อที่อยากจับ'], ok: 1 },
  { q: 'ตำรวจควรวางตัวกับประชาชนอย่างไร', a: ['สุภาพและช่วยเหลือ', 'ข่มขู่ให้กลัว', 'ไม่สนใจ'], ok: 0 },
];
// changing careers too often makes you wait longer (minutes); index = changes in the last 24 h
const JOB_COOLDOWN_MIN = [0, 5];
const OFFICE_TITLES = ['พนักงานฝึกหัด', 'พนักงาน', 'พนักงานอาวุโส', 'หัวหน้าทีม', 'ผู้จัดการ', 'ผู้อำนวยการ', 'CEO'];
// pay ladder (Lv.1, per real minute of work): beggar ~12 < fishing ~20 < rider ~27 < merchant ~35 < office ~45 < police ~55 < doctor ~70
// (a game hour of daytime lasts 1.75 real minutes, so ฿80 per game hour ≈ ฿45 a minute)
const OFFICE_WAGE = [80, 92, 106, 122, 140, 160, 185];          // per game hour seated
const RIDER = { baseFee: 18, perTile: 0.45, npcEvery: 55, tipMax: 30 };
// running: faster, costs energy per tile; you stop running when energy gets low
const RUN = { mul: 1.2, energyPerTile: 0.3, minEnergy: 5 };
const POLICE = { patrolWage: 48, bounty: 300, jailSec: 75, fineBase: 300, wantedMin: 6, outfitMin: 3, npcSpeed: 4.3, begMax: 5000 };   // outfitMin: thief outfit stays on after a pickpocket; npcSpeed: the NPC patrol (players walk at 3)
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
const VEHICLES = {   // bought at the car showroom; ride outdoors (🛵 button) — faster than walking, no running needed
  escoot:  { name: 'สกู๊ตเตอร์ไฟฟ้า', icon: '🛴', price: 9000, speed: 1.25, kind: 'moto' },
  cub:     { name: 'มอเตอร์ไซค์คับ', icon: '🛵', price: 28000, speed: 1.5, kind: 'moto', license: 'driving' },
  vespa:   { name: 'เวสป้าวินเทจ', icon: '🛵', price: 55000, speed: 1.55, kind: 'moto', license: 'driving' },
  delivery:{ name: 'มอไซค์ส่งอาหาร', icon: '🛵', price: 35000, speed: 1.55, kind: 'moto', license: 'driving', rider: 1 },
  dirt:    { name: 'วิบากออฟโรด', icon: '🏍️', price: 85000, speed: 1.65, kind: 'moto', license: 'driving' },
  cafe:    { name: 'คาเฟ่เรเซอร์', icon: '🏍️', price: 120000, speed: 1.7, kind: 'moto', license: 'driving' },
  cruiser: { name: 'ครุยเซอร์ฮาร์เลย์', icon: '🏍️', price: 280000, speed: 1.75, kind: 'moto', license: 'driving' },
  sport:   { name: 'บิ๊กไบค์สปอร์ต', icon: '🏍️', price: 450000, speed: 1.9, kind: 'moto', license: 'driving' },
  mini:    { name: 'มินิคูเปอร์', icon: '🚗', price: 180000, speed: 1.7, kind: 'car', license: 'driving' },
  sedan:   { name: 'รถเก๋งซีดาน', icon: '🚘', price: 260000, speed: 1.75, kind: 'car', license: 'driving' },
  taxi:    { name: 'แท็กซี่', icon: '🚕', price: 300000, speed: 1.75, kind: 'car', license: 'driving' },
  pickup:  { name: 'กระบะ', icon: '🛻', price: 350000, speed: 1.75, kind: 'car', license: 'driving' },
  van:     { name: 'รถตู้', icon: '🚐', price: 420000, speed: 1.7, kind: 'car', license: 'driving' },
  suv:     { name: 'SUV ออฟโรด', icon: '🚙', price: 750000, speed: 1.85, kind: 'car', license: 'driving' },
  sports:  { name: 'ซูเปอร์คาร์เปิดประทุน', icon: '🏎️', price: 1500000, speed: 2.1, kind: 'car', license: 'driving' },
  // 💎 specials: bought with diamonds only, a glowing aura while driving; helicopters fly over everything outdoors
  lambo:   { name: 'ซูเปอร์คาร์แดงเพลิง', icon: '🏎️', gem: 300, speed: 2.2, kind: 'car', license: 'driving', aura: '#ff4a3a' },
  mclaren: { name: 'ไฮเปอร์คาร์ส้มสายฟ้า', icon: '🏎️', gem: 350, speed: 2.25, kind: 'car', license: 'driving', aura: '#ffa12e' },
  phantom: { name: 'แฟนธอมดำ', icon: '🏎️', gem: 400, speed: 2.25, kind: 'car', license: 'driving', aura: '#a46bff' },
  porsche: { name: 'คลาสสิกเงินยวง', icon: '🚗', gem: 450, speed: 2.2, kind: 'car', license: 'driving', aura: '#cfe3ff' },
  jag:     { name: 'โรดสเตอร์เขียวมรกต', icon: '🚗', gem: 500, speed: 2.2, kind: 'car', license: 'driving', aura: '#3fe08a' },
  spider:  { name: 'สไปเดอร์ขาวทองคำ', icon: '🏎️', gem: 650, speed: 2.3, kind: 'car', license: 'driving', aura: '#ffd34d' },
  heli:    { name: 'เฮลิคอปเตอร์ส่วนตัว', icon: '🚁', locked: 1, gem: 10000, speed: 2.4, kind: 'heli', license: 'driving', aura: '#7fd3ff', fly: 1 },
  heli2:   { name: 'เฮลิคอปเตอร์กู้ภัยแดง', icon: '🚁', gem: 2000, speed: 2.6, kind: 'heli', license: 'driving', aura: '#ff6a8a', fly: 1, hidden: 1 },   // no longer sold (owners keep it)
  police:  { name: 'รถสายตรวจ', icon: '🚓', price: 150000, speed: 1.9, kind: 'car', license: 'driving', job: 'police' },
};
const TOOL_PRICES = [4000, 15000, 50000];
const TOOLS = {
  office:   { name: 'ชุดสูทหรู', icon: '👔', fx: ['ค่าแรง +10%', 'ค่าแรง +20%', 'ค่าแรง +30%'] },
  farmer:   { name: 'จอบ & ปุ๋ย', icon: '🧪', fx: ['ผลผลิต +1, โตเร็วขึ้น 15%', 'ผลผลิต +2, โตเร็วขึ้น 30%', 'ผลผลิต +3, โตเร็วขึ้น 45%'] },
  merchant: { name: 'รถเข็นสินค้า', icon: '🛒', fx: ['ผู้ประเมินแม่นขึ้น (±22%)', 'ผู้ประเมินแม่นขึ้น (±15%)', 'ผู้ประเมินแม่นขึ้น (±9%)'] },
  doctor:   { name: 'เครื่องมือแพทย์', icon: '🩺', fx: ['ค่ารักษา +15%', 'ค่ารักษา +30%', 'ค่ารักษา +50%'] },
  police:   { name: 'วิทยุสื่อสาร', icon: '📻', fx: ['ค่าตอบแทน +15%', 'ค่าตอบแทน +30%', 'ค่าตอบแทน +50%'] },
  beggar:   { name: 'ป้ายกระดาษซึ้งๆ', icon: '🪧', fx: ['คนให้เงินบ่อยขึ้น 15%', 'คนให้เงินบ่อยขึ้น 30%', 'คนให้เงินบ่อยขึ้น 50%'] },
  rider:    { name: 'กล่องเก็บความร้อน', icon: '📦', fx: ['ค่าส่ง +10%', 'ค่าส่ง +20%', 'ค่าส่ง +35%'] },
};
const FURNITURE = {
  // gift: only from the 30-day login rewards (never sold in the shop); you keep them even without a house
  bookcase: { name: 'ตู้หนังสือหายาก', icon: '📚', price: 20000, comfort: 3, gift: 1 },
  gclock:   { name: 'นาฬิกาตั้งพื้นโบราณ', icon: '🕰️', price: 30000, comfort: 4, gift: 1 },
  teddy:    { name: 'ตุ๊กตาหมียักษ์', icon: '🧸', price: 40000, comfort: 4, gift: 1 },
  flamp:    { name: 'โคมไฟหรู', icon: '💡', price: 50000, comfort: 5, gift: 1 },
  vase:     { name: 'แจกันลายครามโบราณ', icon: '🏺', price: 80000, comfort: 6, gift: 1 },
  plant:  { name: 'ต้นไม้', icon: '🪴', price: 1500,  comfort: 1 },
  sofa:   { name: 'โซฟา', icon: '🛋️', price: 3000,  comfort: 1 },
  tv:     { name: 'ทีวีจอใหญ่', icon: '📺', price: 6000,  comfort: 2 },
  bed:    { name: 'เตียงนุ่ม', icon: '🛏️', price: 8000,  comfort: 2 },
  sbed:   { name: 'เตียงประจำบ้าน', icon: '🛏️', price: 0, comfort: 0, cat: 'starter', spr: 'f_bed_blue', solid: 1 },   // every home has one; it can be moved, never sold or stored
  aqua:   { name: 'ตู้ปลา', icon: '🐠', price: 12000, comfort: 3 },
  art:    { name: 'ภาพวาด', icon: '🖼️', price: 18000, comfort: 3 },
  piano:  { name: 'เปียโน', icon: '🎹', price: 25000, comfort: 4 },
  jacuzzi:{ name: 'อ่างจากุซซี่', icon: '🛁', price: 40000, comfort: 5 },
  // decor: cheap pieces to arrange your own way (bought at the furniture shop or from your house)
  rugr:   { name: 'พรมกลม', icon: '🟠', price: 800, comfort: 0 },
  rugb:   { name: 'พรมสีฟ้า', icon: '🟦', price: 900, comfort: 0 },
  cactus: { name: 'กระบองเพชร', icon: '🌵', price: 600, comfort: 0 },
  plant2: { name: 'ต้นไม้ใหญ่', icon: '🌿', price: 2200, comfort: 1 },
  lamp:   { name: 'โคมไฟตั้งพื้น', icon: '🛋️', price: 2500, comfort: 1 },
  table:  { name: 'โต๊ะกินข้าว', icon: '🍽️', price: 4500, comfort: 1 },
  rtable: { name: 'โต๊ะกลม', icon: '☕', price: 2000, comfort: 0 },
  shelf:  { name: 'ชั้นหนังสือ', icon: '📖', price: 3500, comfort: 1 },
  desk:   { name: 'โต๊ะทำงาน', icon: '💻', price: 5000, comfort: 1 },
  wardrobe2: { name: 'ตู้เสื้อผ้า', icon: '🚪', price: 4000, comfort: 1 },
  mirror: { name: 'กระจกบานใหญ่', icon: '🪞', price: 3000, comfort: 1 },
  armchair: { name: 'อาร์มแชร์', icon: '💺', price: 3800, comfort: 1 },
  bunk:   { name: 'เตียงสองชั้น', icon: '🛏️', price: 6500, comfort: 1 },
  coffee: { name: 'เครื่องชงกาแฟ', icon: '☕', price: 7000, comfort: 1 },
  winer:  { name: 'ชั้นวางไวน์', icon: '🍷', price: 15000, comfort: 2 },
  // the big furniture-shop catalogue (sprites x_*; cat = shop tab)
  xlsofa: { name: 'โซฟาหนังพรีเมียม', icon: '🛋️', price: 12000, comfort: 2, cat: 'live', spr: 'x_lsofa' },
  xsofa2: { name: 'โซฟาสองที่นั่ง', icon: '🛋️', price: 6000, comfort: 1, cat: 'live', spr: 'x_sofa2' },
  xtv2: { name: 'ทีวีพร้อมชั้นวาง', icon: '📺', price: 15000, comfort: 2, cat: 'live', spr: 'x_tv' },
  xrtable: { name: 'โต๊ะกลมไม้', icon: '🪵', price: 3000, comfort: 0, cat: 'live', spr: 'x_rtable' },
  xbeanbag: { name: 'บีนแบ็ก', icon: '🫘', price: 2500, comfort: 1, cat: 'live', spr: 'x_beanbag' },
  xrocker: { name: 'เก้าอี้โยก', icon: '🪑', price: 5500, comfort: 2, cat: 'live', spr: 'x_rocker' },
  xsideboard: { name: 'ตู้ไซด์บอร์ด', icon: '🗄️', price: 8000, comfort: 1, cat: 'live', spr: 'x_sideboard' },
  xaquarium: { name: 'ตู้ปลาพร้อมฐาน', icon: '🐟', price: 20000, comfort: 3, cat: 'live', spr: 'x_aquarium' },
  xmagrack: { name: 'ชั้นวางนิตยสาร', icon: '📰', price: 1200, comfort: 0, cat: 'live', spr: 'x_magrack' },
  xflamp: { name: 'โคมไฟตั้งพื้นสีครีม', icon: '💡', price: 2000, comfort: 1, cat: 'live', spr: 'x_flamp' },
  xalamp: { name: 'โคมไฟแขนยาว', icon: '💡', price: 2400, comfort: 1, cat: 'live', spr: 'x_alamp' },
  xpendant: { name: 'โคมไฟห้อยเพดาน', icon: '💡', price: 1800, comfort: 0, cat: 'live', spr: 'x_pendant' },
  xaircon: { name: 'แอร์ติดผนัง', icon: '❄️', price: 15000, comfort: 3, cat: 'live', spr: 'x_aircon' },
  xfan: { name: 'พัดลมตั้งพื้น', icon: '🌀', price: 1500, comfort: 1, cat: 'live', spr: 'x_fan' },
  xwclock: { name: 'นาฬิกาแขวน', icon: '🕰️', price: 1500, comfort: 0, cat: 'live', spr: 'x_wclock' },
  xwardrobe: { name: 'ตู้เสื้อผ้าบานใหญ่', icon: '🚪', price: 7000, comfort: 1, cat: 'bed', spr: 'x_wardrobe' },
  xdrawers: { name: 'ตู้ลิ้นชัก', icon: '🗄️', price: 4500, comfort: 1, cat: 'bed', spr: 'x_drawers' },
  xbookshelf: { name: 'ตู้หนังสือ', icon: '📚', price: 4500, comfort: 1, cat: 'bed', spr: 'x_bookshelf' },
  xshelf_s: { name: 'ชั้นวางของจุกจิก', icon: '📚', price: 2500, comfort: 1, cat: 'bed', spr: 'x_shelf_s' },
  xdesk: { name: 'โต๊ะทำงานไม้', icon: '🪵', price: 4000, comfort: 1, cat: 'bed', spr: 'x_desk' },
  xdlamp: { name: 'โคมไฟตั้งโต๊ะ', icon: '💡', price: 900, comfort: 0, cat: 'bed', spr: 'x_dlamp' },
  xgchair: { name: 'เก้าอี้เกมมิ่ง', icon: '🎮', price: 8500, comfort: 2, cat: 'bed', spr: 'x_gchair' },
  xpcdesk2: { name: 'โต๊ะคอมพิวเตอร์', icon: '🖥️', price: 16000, comfort: 2, cat: 'bed', spr: 'x_pcdesk2' },
  xcrib: { name: 'เปลเด็ก', icon: '👶', price: 6000, comfort: 1, cat: 'bed', spr: 'x_crib' },
  xcoatrack: { name: 'ราวแขวนเสื้อโค้ท', icon: '🧥', price: 1500, comfort: 0, cat: 'bed', spr: 'x_coatrack' },
  xmirror: { name: 'กระจกตั้งพื้น', icon: '🪞', price: 2500, comfort: 0, cat: 'bed', spr: 'x_mirror' },
  xchest: { name: 'หีบสมบัติ', icon: '🧰', price: 3500, comfort: 0, cat: 'bed', spr: 'x_chest' },
  xblanket: { name: 'ผ้าห่มลายสก็อต', icon: '🧶', price: 1200, comfort: 1, cat: 'bed', spr: 'x_blanket' },
  xksink: { name: 'ซิงก์ล้างจานสแตนเลส', icon: '🚰', price: 6000, comfort: 1, cat: 'kitchen', spr: 'x_sink' },
  xmicrowave: { name: 'ไมโครเวฟ', icon: '📦', price: 2500, comfort: 1, cat: 'kitchen', spr: 'x_microwave' },
  xespresso: { name: 'เครื่องชงเอสเพรสโซ', icon: '☕', price: 9000, comfort: 1, cat: 'kitchen', spr: 'x_espresso' },
  xdishrack: { name: 'ที่คว่ำจาน', icon: '🍽️', price: 800, comfort: 0, cat: 'kitchen', spr: 'x_dishrack' },
  xdrinkfridge: { name: 'ตู้แช่เครื่องดื่ม', icon: '🥤', price: 14000, comfort: 1, cat: 'kitchen', spr: 'x_drinkfridge' },
  xcafeset: { name: 'ชุดโต๊ะคาเฟ่', icon: '☕', price: 7000, comfort: 1, cat: 'kitchen', spr: 'x_cafeset' },
  xbarstool: { name: 'เก้าอี้บาร์', icon: '🪑', price: 1500, comfort: 0, cat: 'kitchen', spr: 'x_barstool' },
  xwasher: { name: 'เครื่องซักผ้า', icon: '🫧', price: 9000, comfort: 1, cat: 'kitchen', spr: 'x_washer' },
  xlaundry: { name: 'ตะกร้าผ้า', icon: '🧺', price: 500, comfort: 0, cat: 'kitchen', spr: 'x_laundry' },
  xiron: { name: 'โต๊ะรีดผ้า', icon: '👕', price: 1200, comfort: 0, cat: 'kitchen', spr: 'x_iron' },
  xvacuum: { name: 'เครื่องดูดฝุ่น', icon: '🧹', price: 3500, comfort: 0, cat: 'kitchen', spr: 'x_vacuum' },
  xheater: { name: 'เครื่องทำน้ำอุ่น', icon: '🚿', price: 4500, comfort: 1, cat: 'kitchen', spr: 'x_heater' },
  xfern: { name: 'ต้นเฟิร์นในกระถาง', icon: '🌿', price: 1800, comfort: 1, cat: 'deco', spr: 'x_fern' },
  xbonsai: { name: 'บอนไซ', icon: '🌳', price: 4000, comfort: 1, cat: 'deco', spr: 'x_bonsai' },
  xtree: { name: 'ต้นมะกอกในกระถาง', icon: '🌳', price: 4500, comfort: 1, cat: 'deco', spr: 'x_tree' },
  xplantx: { name: 'ต้นยางอินเดีย', icon: '🪴', price: 2600, comfort: 1, cat: 'deco', spr: 'x_plant' },
  xhanging: { name: 'กระถางแขวน', icon: '🪴', price: 2000, comfort: 1, cat: 'deco', spr: 'x_hanging' },
  xvases: { name: 'แจกันดอกไม้สามใบ', icon: '💐', price: 2500, comfort: 1, cat: 'deco', spr: 'x_vases' },
  xorchids: { name: 'กล้วยไม้', icon: '🌸', price: 4000, comfort: 1, cat: 'deco', spr: 'x_orchids' },
  xflowers: { name: 'ชั้นวางดอกไม้', icon: '💐', price: 5500, comfort: 1, cat: 'deco', spr: 'x_flowers' },
  xgnome: { name: 'ตุ๊กตาคนแคระ', icon: '🧙', price: 1500, comfort: 0, cat: 'deco', spr: 'x_gnome' },
  xmushroom: { name: 'โคมเห็ดแดง', icon: '🍄', price: 2000, comfort: 0, cat: 'deco', spr: 'x_mushroom' },
  xglobe: { name: 'ลูกโลก', icon: '🌍', price: 3500, comfort: 0, cat: 'deco', spr: 'x_globe' },
  xcubby: { name: 'ชั้นช่องไม้', icon: '🗃️', price: 4000, comfort: 0, cat: 'deco', spr: 'x_cubby' },
  xpatio: { name: 'โต๊ะร่มสนาม', icon: '⛱️', price: 5000, comfort: 1, cat: 'deco', spr: 'x_patio' },
  xpbench: { name: 'ม้านั่งสวน', icon: '🪑', price: 3500, comfort: 0, cat: 'deco', spr: 'x_pbench' },
  // home-yard garden pieces: buy as many as you like and lay them out in your yard (fields grow vegetables)
  gsoil: { name: 'แปลงดินปลูกผัก (1 ช่อง · วางต่อกันได้)', icon: '🟫', price: 300, comfort: 0, cat: 'garden', spr: 'y_soil15', multi: 1, max: 200, field: 1, tile: 1 },
  gsprk: { name: 'สปริงเกลอร์ทองแดง (รดน้ำรอบตัว 3×3)', icon: '💦', price: 2500, comfort: 0, cat: 'garden', spr: 'y_sprk1', multi: 1, sprk: 1 },
  gsprk2: { name: 'สปริงเกลอร์อิริเดียม (รดน้ำรอบตัว 5×5)', icon: '💦', price: 9000, comfort: 0, cat: 'garden', spr: 'y_sprk2', multi: 1, sprk: 2 },
  gfield: { name: 'แปลงผัก (ปลูกพืชได้)', icon: '🌱', price: 2500, comfort: 0, cat: 'garden', spr: 'y_field', multi: 1, field: 1 },
  gtree: { name: 'ต้นไม้ใหญ่', icon: '🌳', price: 3000, comfort: 0, cat: 'garden', spr: 'tree', multi: 1, solid: 1, sw: 0.8 },
  gtreeoak: { name: 'ต้นโอ๊ก', icon: '🌳', price: 3500, comfort: 0, cat: 'garden', spr: 'tree_oak', multi: 1, solid: 1, sw: 0.8 },
  gsakura: { name: 'ต้นซากุระ', icon: '🌸', price: 4500, comfort: 0, cat: 'garden', spr: 'tree_pink', multi: 1, solid: 1, sw: 0.8 },
  gtreew: { name: 'ต้นดอกขาว', icon: '🌳', price: 4500, comfort: 0, cat: 'garden', spr: 'tree_white', multi: 1, solid: 1, sw: 0.8 },
  gpine: { name: 'ต้นสน', icon: '🌲', price: 3000, comfort: 0, cat: 'garden', spr: 'pine', multi: 1, solid: 1, sw: 0.7 },
  gpalm: { name: 'ต้นมะพร้าว', icon: '🌴', price: 3500, comfort: 0, cat: 'garden', spr: 'palm', multi: 1, solid: 1, sw: 0.6 },
  gbush: { name: 'พุ่มไม้', icon: '🌿', price: 900, comfort: 0, cat: 'garden', spr: 'bush', multi: 1, solid: 1 },
  gbush2: { name: 'พุ่มไม้กลม', icon: '🌿', price: 900, comfort: 0, cat: 'garden', spr: 'bush2', multi: 1, solid: 1 },
  ghedge: { name: 'รั้วต้นไม้', icon: '🌳', price: 1200, comfort: 0, cat: 'garden', spr: 'hedge', multi: 1, solid: 1 },
  ghedgef: { name: 'รั้วต้นไม้ดอก', icon: '🌺', price: 1500, comfort: 0, cat: 'garden', spr: 'hedge_flower', multi: 1, solid: 1 },
  ghcube: { name: 'พุ่มไม้สี่เหลี่ยม', icon: '🟩', price: 1500, comfort: 0, cat: 'garden', spr: 'o_hedgecube', multi: 1, solid: 1 },
  gtopiary: { name: 'ไม้ดัดทรงกลม', icon: '🌳', price: 1800, comfort: 0, cat: 'garden', spr: 'o_topiary', multi: 1, solid: 1 },
  ghring: { name: 'วงพุ่มไม้', icon: '⭕', price: 2500, comfort: 0, cat: 'garden', spr: 'o_hedgering', multi: 1, solid: 1 },
  gfwhite: { name: 'รั้วไม้สีขาว', icon: '🪵', price: 800, comfort: 0, cat: 'garden', spr: 'fence_white', multi: 1, solid: 1 },
  gfbamboo: { name: 'รั้วไม้ไผ่', icon: '🎋', price: 700, comfort: 0, cat: 'garden', spr: 'fence_bamboo', multi: 1, solid: 1 },
  gfiron: { name: 'รั้วเหล็กดัด', icon: '⛓️', price: 1500, comfort: 0, cat: 'garden', spr: 'fence_iron', multi: 1, solid: 1 },
  gfgate: { name: 'ประตูรั้ว', icon: '🚪', price: 1500, comfort: 0, cat: 'garden', spr: 'o_gate', multi: 1 },
  gfbed: { name: 'กระบะดอกไม้ขาว', icon: '💐', price: 2000, comfort: 0, cat: 'garden', spr: 'o_flowerbed', multi: 1, solid: 1 },
  gfbed2: { name: 'แปลงดอกไม้หลากสี', icon: '🌷', price: 2200, comfort: 0, cat: 'garden', spr: 'flowerbed', multi: 1, solid: 1 },
  gplanter: { name: 'กระบะดอกไม้', icon: '🌼', price: 1500, comfort: 0, cat: 'garden', spr: 'o_planter', multi: 1, solid: 1 },
  glplanter: { name: 'กระบะดอกไม้รูปตัวแอล', icon: '🌼', price: 1800, comfort: 0, cat: 'garden', spr: 'o_lplanter', multi: 1, solid: 1 },
  groses: { name: 'กระถางกุหลาบหิน', icon: '🌹', price: 1500, comfort: 0, cat: 'garden', spr: 'o_roses', multi: 1, solid: 1 },
  gtulips: { name: 'แท่นทิวลิป', icon: '🌷', price: 1200, comfort: 0, cat: 'garden', spr: 'o_tulips', multi: 1, solid: 1 },
  gfbox: { name: 'กล่องดอกไม้', icon: '🌸', price: 900, comfort: 0, cat: 'garden', spr: 'flowerbox', multi: 1, solid: 1 },
  gpot: { name: 'กระถางดอกไม้', icon: '🌼', price: 400, comfort: 0, cat: 'garden', spr: 'o_potflower', multi: 1 },
  ggrass: { name: 'กอหญ้า', icon: '🌾', price: 200, comfort: 0, cat: 'garden', spr: 'o_grass', multi: 1 },
  gfount: { name: 'น้ำพุใหญ่สามชั้น', icon: '⛲', price: 25000, comfort: 0, cat: 'garden', spr: 'o_fountain', multi: 1, solid: 1 },
  gfount2: { name: 'น้ำพุกลม', icon: '⛲', price: 15000, comfort: 0, cat: 'garden', spr: 'o_fountain2', multi: 1, solid: 1 },
  gfount3: { name: 'น้ำพุเล็ก', icon: '⛲', price: 8000, comfort: 0, cat: 'garden', spr: 'o_fountain3', multi: 1, solid: 1 },
  gpond: { name: 'บ่อปลา', icon: '🐟', price: 12000, comfort: 0, cat: 'garden', spr: 'pond', multi: 1, solid: 1 },
  gwell: { name: 'บ่อน้ำ', icon: '🪣', price: 6000, comfort: 0, cat: 'garden', spr: 'well', multi: 1, solid: 1, sw: 0.9 },
  gbench: { name: 'ม้านั่งไม้', icon: '🪑', price: 2500, comfort: 0, cat: 'garden', spr: 'o_bench', multi: 1, solid: 1 },
  gsbench: { name: 'ม้านั่งหิน', icon: '🪑', price: 2500, comfort: 0, cat: 'garden', spr: 'o_stonebench', multi: 1, solid: 1 },
  gparasol: { name: 'โต๊ะร่มสนาม', icon: '⛱️', price: 4000, comfort: 0, cat: 'garden', spr: 'o_parasol', multi: 1, solid: 1, sw: 0.6 },
  gwtable: { name: 'โต๊ะไม้กลม', icon: '🪵', price: 2000, comfort: 0, cat: 'garden', spr: 'o_woodtable', multi: 1, solid: 1 },
  glamp: { name: 'เสาไฟสวน', icon: '💡', price: 2500, comfort: 0, cat: 'garden', spr: 'o_lamp', multi: 1, solid: 1, sw: 0.4 },
  glampb: { name: 'โคมไฟหัวกลม', icon: '💡', price: 2000, comfort: 0, cat: 'garden', spr: 'o_lampball', multi: 1, solid: 1, sw: 0.4 },
  glantern: { name: 'ตะเกียงประดับ', icon: '🏮', price: 1800, comfort: 0, cat: 'garden', spr: 'o_lantern', multi: 1 },
  garch: { name: 'ซุ้มกุหลาบ', icon: '🌹', price: 6000, comfort: 0, cat: 'garden', spr: 'o_rosearch', multi: 1 },
  gpergola: { name: 'ซุ้มไม้เลื้อย', icon: '🌿', price: 7000, comfort: 0, cat: 'garden', spr: 'o_pergola', multi: 1 },
  gslide: { name: 'สไลเดอร์เด็กเล่น', icon: '🛝', price: 9000, comfort: 0, cat: 'garden', spr: 'o_slide', multi: 1, solid: 1 },
  gbird: { name: 'รูปปั้นนก', icon: '🕊️', price: 3500, comfort: 0, cat: 'garden', spr: 'o_birdstatue', multi: 1, solid: 1 },
  gcat: { name: 'รูปปั้นแมว', icon: '🐈', price: 3500, comfort: 0, cat: 'garden', spr: 'o_catstatue', multi: 1, solid: 1 },
  ggnome: { name: 'ตุ๊กตาคนแคระ', icon: '🧙', price: 600, comfort: 0, cat: 'garden', spr: 'gnome', multi: 1 },
  gfcart: { name: 'รถเข็นดอกไม้', icon: '🛒', price: 6000, comfort: 0, cat: 'garden', spr: 'o_flowercart', multi: 1, solid: 1 },
  ghay: { name: 'ฟางมัด', icon: '🌾', price: 500, comfort: 0, cat: 'garden', spr: 'hay', multi: 1, solid: 1 },
  gtap: { name: 'ก๊อกน้ำสนาม', icon: '🚰', price: 800, comfort: 0, cat: 'garden', spr: 'o_tap', multi: 1, solid: 1 },
  gmailbox: { name: 'ตู้จดหมาย', icon: '📫', price: 800, comfort: 0, cat: 'garden', spr: 'o_mailbox', multi: 1, solid: 1 },
  gstump: { name: 'ตอไม้', icon: '🪵', price: 400, comfort: 0, cat: 'garden', spr: 'stump', multi: 1, solid: 1 },
  grock: { name: 'ก้อนหิน', icon: '🪨', price: 300, comfort: 0, cat: 'garden', spr: 'rock', multi: 1, solid: 1 },
  // room partitions (pixel_walls sheet): buy as many as you like and build your own rooms; walls and screens block the way, doors and curtains let you through
  wpink: { name: 'ผนังสีชมพู', icon: '🧱', price: 1200, comfort: 0, cat: 'wall', spr: 'pw_pink', multi: 1, solid: 1 },
  wcream: { name: 'ผนังสีครีม', icon: '🧱', price: 1200, comfort: 0, cat: 'wall', spr: 'pw_cream', multi: 1, solid: 1 },
  wblue: { name: 'ผนังสีฟ้าเทา', icon: '🧱', price: 1200, comfort: 0, cat: 'wall', spr: 'pw_blue', multi: 1, solid: 1 },
  wgrey: { name: 'ผนังสีเทา', icon: '🧱', price: 1200, comfort: 0, cat: 'wall', spr: 'pw_grey', multi: 1, solid: 1 },
  wwood: { name: 'ผนังไม้ระแนง', icon: '🪵', price: 1800, comfort: 0, cat: 'wall', spr: 'pw_wood', multi: 1, solid: 1 },
  wcornerl: { name: 'มุมผนังชมพู (ซ้าย)', icon: '📐', price: 1400, comfort: 0, cat: 'wall', spr: 'pw_corner_l', multi: 1, solid: 1 },
  wcornerr: { name: 'มุมผนังชมพู (ขวา)', icon: '📐', price: 1400, comfort: 0, cat: 'wall', spr: 'pw_corner_r', multi: 1, solid: 1 },
  wpillar: { name: 'เสาผนังชมพู', icon: '🏛️', price: 600, comfort: 0, cat: 'wall', spr: 'pw_pillar', multi: 1, solid: 1 },
  wwin: { name: 'ผนังมีหน้าต่าง', icon: '🪟', price: 2500, comfort: 0, cat: 'wall', spr: 'pw_win_pink', multi: 1, solid: 1 },
  wpic: { name: 'ผนังครีมแขวนภาพ', icon: '🖼️', price: 2200, comfort: 0, cat: 'wall', spr: 'pw_pic', multi: 1, solid: 1 },
  wshelf: { name: 'ผนังครีมมีชั้นวาง', icon: '🧱', price: 2200, comfort: 0, cat: 'wall', spr: 'pw_shelf', multi: 1, solid: 1 },
  wdoor: { name: 'ประตูไม้', icon: '🚪', price: 2000, comfort: 0, cat: 'wall', spr: 'pw_door_wood', multi: 1 },
  wdoorg: { name: 'ประตูกระจก', icon: '🚪', price: 3000, comfort: 0, cat: 'wall', spr: 'pw_door_glass', multi: 1 },
  wdoorway: { name: 'วงกบประตู (ช่องทางเดิน)', icon: '🚪', price: 900, comfort: 0, cat: 'wall', spr: 'pw_doorway', multi: 1 },
  wdoorl: { name: 'ประตูบานเกล็ด', icon: '🚪', price: 2200, comfort: 0, cat: 'wall', spr: 'pw_door_louver', multi: 1 },
  wrail: { name: 'ราวกั้นไม้', icon: '🪵', price: 1600, comfort: 0, cat: 'wall', spr: 'pw_railing', multi: 1, solid: 1 },
  wglass: { name: 'ฉากกั้นกระจก', icon: '🪟', price: 3500, comfort: 0, cat: 'wall', spr: 'pw_glass', multi: 1, solid: 1 },
  wlowg: { name: 'ผนังเตี้ยสีเทา', icon: '🧱', price: 1000, comfort: 0, cat: 'wall', spr: 'pw_low_grey', multi: 1, solid: 1 },
  wlowc: { name: 'ผนังเตี้ยสีครีม', icon: '🧱', price: 1000, comfort: 0, cat: 'wall', spr: 'pw_low_cream', multi: 1, solid: 1 },
  wsliding: { name: 'ประตูบานเลื่อนไม้', icon: '🚪', price: 4500, comfort: 0, cat: 'wall', spr: 'pw_sliding', multi: 1, solid: 1 },
  wcurtain: { name: 'ม่านกั้นห้อง', icon: '🎐', price: 1500, comfort: 0, cat: 'wall', spr: 'pw_curtain', multi: 1 },
  wshoji: { name: 'ฉากไม้ฉลุสามบาน', icon: '🏯', price: 4000, comfort: 0, cat: 'wall', spr: 'pw_shoji', multi: 1, solid: 1 },
  wshelfdiv: { name: 'ชั้นวางกั้นห้อง', icon: '🗄️', price: 2800, comfort: 0, cat: 'wall', spr: 'pw_shelfdiv', multi: 1, solid: 1 },
  whalf: { name: 'ฉากกั้นไม้ครึ่งตัว', icon: '🪵', price: 2000, comfort: 0, cat: 'wall', spr: 'pw_halfwall', multi: 1, solid: 1 },
  wlamp: { name: 'โคมไฟติดผนัง', icon: '💡', price: 1200, comfort: 0, cat: 'wall', spr: 'pw_lamp', multi: 1 },
  whooks: { name: 'ราวแขวนติดผนัง', icon: '🧥', price: 700, comfort: 0, cat: 'wall', spr: 'pw_hooks', multi: 1 },
  wmirror: { name: 'กระจกเงาติดผนัง', icon: '🪞', price: 1500, comfort: 0, cat: 'wall', spr: 'pw_mirror', multi: 1 },
  // garden & outdoor pieces (pixel_outdoor sheet)
  xofount: { name: 'น้ำพุหินเล็ก', icon: '⛲', price: 18000, comfort: 2, cat: 'deco', spr: 'o_fountain3' },
  xopalm: { name: 'ปาล์มกระถางใหญ่', icon: '🌴', price: 5500, comfort: 1, cat: 'deco', spr: 'o_potpalm' },
  xotree: { name: 'ต้นไม้ทรงพุ่มกระถางสูง', icon: '🌳', price: 6000, comfort: 1, cat: 'deco', spr: 'o_pottree' },
  xotopi: { name: 'ไม้ดัดทรงกลม', icon: '🌳', price: 3800, comfort: 1, cat: 'deco', spr: 'o_topiary' },
  xotulip: { name: 'แท่นทิวลิป', icon: '🌷', price: 3200, comfort: 1, cat: 'deco', spr: 'o_tulips' },
  xoroses: { name: 'กระถางกุหลาบหิน', icon: '🌹', price: 4200, comfort: 1, cat: 'deco', spr: 'o_roses' },
  xopot: { name: 'กระถางดอกไม้ดินเผา', icon: '🌼', price: 900, comfort: 0, cat: 'deco', spr: 'o_potflower' },
  xocactus: { name: 'แคคตัสกระถาง', icon: '🌵', price: 800, comfort: 0, cat: 'deco', spr: 'o_cactus' },
  xobowl: { name: 'กระถางหินทรงชาม', icon: '🪴', price: 1500, comfort: 0, cat: 'deco', spr: 'o_bowlpot' },
  xolantern: { name: 'โคมตะเกียงไม้ประดับ', icon: '🏮', price: 4500, comfort: 1, cat: 'deco', spr: 'o_lantern' },
  xocat: { name: 'รูปปั้นแมว', icon: '🐈', price: 7000, comfort: 1, cat: 'deco', spr: 'o_catstatue' },
  xobird: { name: 'รูปปั้นนกพิราบ', icon: '🕊️', price: 7000, comfort: 1, cat: 'deco', spr: 'o_birdstatue' },
  xoplanter: { name: 'กระบะดอกไม้ขาว', icon: '💐', price: 2800, comfort: 1, cat: 'deco', spr: 'o_planter' },
  xohedge: { name: 'พุ่มไม้สี่เหลี่ยม', icon: '🟩', price: 2500, comfort: 0, cat: 'deco', spr: 'o_hedgecube' },
  xotable: { name: 'โต๊ะไม้กลมสนาม', icon: '🪵', price: 3000, comfort: 1, cat: 'deco', spr: 'o_woodtable' },
  xobench: { name: 'ม้านั่งไม้ทาสี', icon: '🪑', price: 4000, comfort: 1, cat: 'deco', spr: 'o_bench' },
  xoslide: { name: 'สไลเดอร์เด็กเล่น', icon: '🛝', price: 25000, comfort: 2, cat: 'fun', spr: 'o_slide' },
  xoarch: { name: 'ซุ้มกุหลาบ', icon: '🌹', price: 22000, comfort: 2, cat: 'deco', spr: 'o_rosearch' },
  xeasel: { name: 'กระดานขาตั้ง', icon: '🖼️', price: 3000, comfort: 0, cat: 'deco', spr: 'x_easel' },
  xarcade: { name: 'ตู้เกมอาเขต', icon: '🕹️', price: 35000, comfort: 3, cat: 'fun', spr: 'x_arcade' },
  xpool: { name: 'โต๊ะพูล', icon: '🎱', price: 60000, comfort: 4, cat: 'fun', spr: 'x_pool' },
  xdart: { name: 'กระดานปาเป้า', icon: '🎯', price: 2500, comfort: 1, cat: 'fun', spr: 'x_dart' },
  xupiano: { name: 'เปียโนตั้งพื้น', icon: '🎹', price: 45000, comfort: 4, cat: 'fun', spr: 'x_piano' },
  xtreadmill: { name: 'ลู่วิ่งไฟฟ้า', icon: '🏃', price: 18000, comfort: 2, cat: 'fun', spr: 'x_treadmill' },
  xebike: { name: 'จักรยานออกกำลัง', icon: '🚲', price: 12000, comfort: 1, cat: 'fun', spr: 'x_ebike' },
  xwbench: { name: 'ม้านั่งยกน้ำหนัก', icon: '🏋️', price: 6000, comfort: 1, cat: 'fun', spr: 'x_wbench' },
  xyoga: { name: 'เสื่อโยคะ', icon: '🧘', price: 800, comfort: 0, cat: 'fun', spr: 'x_yoga' },
  xvending: { name: 'ตู้กดน้ำ', icon: '🥫', price: 25000, comfort: 1, cat: 'fun', spr: 'x_vending' },
  xphonebooth: { name: 'ตู้โทรศัพท์วินเทจ', icon: '☎️', price: 30000, comfort: 1, cat: 'fun', spr: 'x_phonebooth' },
  xmoto: { name: 'มอเตอร์ไซค์โชว์', icon: '🏍️', price: 80000, comfort: 2, cat: 'fun', spr: 'x_moto' },
  xtoolbox: { name: 'ตู้เครื่องมือช่าง', icon: '🧰', price: 6500, comfort: 0, cat: 'fun', spr: 'x_toolbox' },
};
// rates are per game day (24 real minutes): savings earn 0.5%/day, a loan costs a 2% fee up front plus 1%/day on what is still owed
// (the bank always charges more than it pays, so borrowing to save never pays off); at most 3 game days accrue while you are offline
const BANK = { rate: 0.005, cap: 200000, loanMax: 30000, loanFee: 0.02, loanRate: 0.01, repayShare: 0.25, offlineDays: 3 };

// ================================================================= health
const DISEASES = {
  cold:    { name: 'ไข้หวัด', icon: '🤒', cure: 'fever', drain: 0.05, income: 0.8, sym: ['ตัวร้อน มีไข้', 'ไอ จาม น้ำมูกไหล', 'หนาวสั่น'], cause: 'ตากฝนนานๆ อยู่ใกล้คนป่วย หรือช่วงไข้หวัดระบาด', self: 'นั่งหรือนอนพักในอาคาร 1 นาทีก็หาย หรือให้หมอรักษา' },
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
// the townsfolk who stroll around: fixed people, each matching a painted portrait (public/assets/portraits, folk_*)
const FOLK = {
  town: [
    { name: 'พี่โจ้ (พนักงานออฟฟิศ)', g: 'm', face: 'folk_m1', look: { hair: 'black', shirt: 'black', pants: 'gray' } },
    { name: 'คุณเมย์', g: 'f', face: 'folk_f1', look: { hair: 'brown', shirt: 'black', pants: 'black' } },
    { name: 'ป้าสมใจ', g: 'f', face: 'folk_f2', look: { hair: 'black', shirt: 'white', pants: 'gray' } },
    { name: 'พี่ดำ', g: 'm', face: 'folk_m2', look: { hair: 'black', shirt: 'red', pants: 'gray' } },
    { name: 'ต้นกล้า', g: 'm', face: 'folk_m3', look: { hair: 'brown', shirt: 'black', pants: 'gray' } },
    { name: 'น้องมะปราง', g: 'f', face: 'mprang_happy', look: { hair: 'brown', shirt: 'pink', pants: 'gray' }, kid: 1 },
  ],
  housing: [
    { name: 'ป้านวล', g: 'f', face: 'folk_f3', look: { hair: 'brown', shirt: 'yellow', pants: 'gray' } },
    { name: 'ตาเฉย', g: 'm', face: 'folk_m4', look: { hair: 'silver', shirt: 'white', pants: 'gray' } },
    { name: 'น้องเจมส์ (นักเรียน)', g: 'm', face: 'folk_m5', look: { hair: 'black', shirt: 'white', pants: 'black' } },
  ],
};
const NPC_NAMES = ['ป้าสมศรี', 'ลุงมี', 'น้องเมย์', 'พี่ต้น', 'ยายจันทร์', 'ตาเหลือง', 'น้าแดง', 'พี่ฝน', 'น้องบอส', 'ป้าแจ๋ว', 'ลุงชัย', 'พี่นก'];

// ================================================================= achievements -> titles shown over your head
// ================================================================= looks (pixel character in public/assets/pchar.*, recoloured per player)
// everyone starts with the same brown hair; hair dye at the barber's, shirts and shorts at the fashion shop
const LOOKS = {
  hair:  { brown: { name: 'ผมสีน้ำตาล (เริ่มต้น)', price: 0, color: '#6e4528' }, black: { name: 'ย้อมผมดำ', price: 800, color: '#2e2622' },
           blonde: { name: 'ย้อมผมบลอนด์', price: 1200, color: '#e6bd55' }, ginger: { name: 'ย้อมผมส้มแดง', price: 1200, color: '#c0552d' },
           pink: { name: 'ย้อมผมชมพู', price: 1800, color: '#ec82b8' }, blue: { name: 'ย้อมผมน้ำเงิน', price: 1800, color: '#4f6fd6' }, silver: { name: 'ย้อมผมสีเงิน', price: 2200, color: '#d9dbe6' } },
  shirt: { white: { name: 'เสื้อยืดขาว', price: 300, color: '#ffffff' }, blue: { name: 'เสื้อยืดฟ้า', price: 300, color: '#5aa0e0' }, green: { name: 'เสื้อยืดเขียว', price: 300, color: '#7cc06a' },
           red: { name: 'เสื้อยืดแดง', price: 300, color: '#e0645a' }, yellow: { name: 'เสื้อยืดเหลือง', price: 400, color: '#f2c84b' }, pink: { name: 'เสื้อยืดชมพู', price: 400, color: '#f29ac0' },
           purple: { name: 'เสื้อยืดม่วง', price: 600, color: '#9a7ae0' }, black: { name: 'เสื้อยืดดำ', price: 600, color: '#45454f' } },
  // skin tone: free, pick any time at the barber (the sprites are drawn in 'warm'; the others are recoloured on the client)
  skin:  { warm: { name: 'ผิวสองสี (เริ่มต้น)', price: 0, color: '#ef965e' }, fair: { name: 'ผิวขาว', price: 0, color: '#f7cdb0' },
           light: { name: 'ผิวขาวเหลือง', price: 0, color: '#f2b98d' }, brown: { name: 'ผิวแทน', price: 0, color: '#b9703f' },
           dark: { name: 'ผิวเข้ม', price: 0, color: '#7f4a2b' } },
  pants: { gray: { name: 'กางเกงเทา (เริ่มต้น)', price: 0, color: '#bdbdbd' }, jeans: { name: 'กางเกงยีนส์', price: 400, color: '#5574b0' }, brown: { name: 'กางเกงน้ำตาล', price: 400, color: '#93613f' },
           black: { name: 'กางเกงดำ', price: 500, color: '#3d3d47' }, green: { name: 'กางเกงเขียวขี้ม้า', price: 500, color: '#6f8e4c' } },
};
const SHIRTS = ['white', 'blue', 'green', 'red'];       // starter choices
const NPC_LINES = ['วันนี้อากาศดีจังเลย', 'ตลาดวันนี้คนเยอะมาก', 'หิวจัง ไปกินก๋วยเตี๋ยวดีกว่า', 'ได้ยินว่าที่ทะเลมีฉลามด้วย',
  'ค่าไฟเดือนนี้แพงจัง', 'ไปนั่งเล่นที่จัตุรัสกัน', 'หมอที่โรงพยาบาลเก่งมาก', 'อยากได้บ้านในหมู่บ้านจัดสรรจัง', 'ข้าวโพดปีนี้หวานมาก', 'สวัสดีจ้า', 'วันนี้ทำงานเหนื่อยมาก'];

// outfits you can wear instead of your job's clothes (rewards)
const OUTFITS = { fisher: { name: 'ชุดนักตกปลา', how: 'ตกปลาจนถึงเลเวลสูงสุด' },
  // sold at the fashion shop (price = how fancy / rare the outfit is)
  pajama:    { name: 'ชุดนอนหมีน้อย', how: 'ซื้อที่ร้านแฟชั่น', price: 10000 },
  tracksuit: { name: 'ชุดวอร์มสปอร์ต', how: 'ซื้อที่ร้านแฟชั่น', price: 25000 },
  hoodie:    { name: 'ชุดฮู้ดดี้สตรีท', how: 'ซื้อที่ร้านแฟชั่น', price: 45000 },
  cowboy:    { name: 'ชุดคาวบอยนายอำเภอ', how: 'ซื้อที่ร้านแฟชั่น', price: 120000 },
  tuxedo:    { name: 'ชุดทักซิโด้หูกระต่าย', how: 'ซื้อที่ร้านแฟชั่น', price: 180000 },
  devil:     { name: 'ชุดปีศาจน้อย', how: 'ซื้อที่ร้านแฟชั่น', price: 250000 },
  pilot:     { name: 'ชุดนักบินขับไล่', how: 'ซื้อที่ร้านแฟชั่น', price: 400000 },
  magician:  { name: 'ชุดสุภาพบุรุษนักมายากล', how: 'ซื้อที่ร้านแฟชั่น', price: 650000 },
  thai:      { name: 'ชุดไทยทองคำ', how: 'ซื้อที่ร้านแฟชั่น', price: 1000000 },
  // new collection (sorted from plain to fanciest); g = only for that gender, nf = the women's name of a unisex outfit
  student:   { name: 'ชุดนักเรียนไทย', how: 'ซื้อที่ร้านแฟชั่น', price: 19999 },
  scout:     { name: 'ชุดลูกเสือ', how: 'ซื้อที่ร้านแฟชั่น', price: 39999, g: 'm' },
  songkran:  { name: 'ชุดสงกรานต์ฉ่ำน้ำ', how: 'ซื้อที่ร้านแฟชั่น', price: 59999 },
  lanna:     { name: 'ชุดพื้นเมืองล้านนา', how: 'ซื้อที่ร้านแฟชั่น', price: 79999, g: 'm' },
  phasin:    { name: 'ชุดผ้าซิ่นพื้นเมือง', how: 'ซื้อที่ร้านแฟชั่น', price: 79999, g: 'f' },
  muaythai:  { name: 'ชุดนักมวยไทย', how: 'ซื้อที่ร้านแฟชั่น', price: 129999, g: 'm' },
  bunny:     { name: 'ชุดกระต่ายชมพู', how: 'ซื้อที่ร้านแฟชั่น', price: 149999, g: 'f' },
  chinese:   { name: 'ชุดตรุษจีนมังกรทอง', nf: 'ชุดกี่เพ้าตรุษจีน', how: 'ซื้อที่ร้านแฟชั่น', price: 199999 },
  lukthung:  { name: 'ชุดนักร้องลูกทุ่งกากเพชร', how: 'ซื้อที่ร้านแฟชั่น', price: 349999 },
  chakri:    { name: 'ชุดไทยจักรี', how: 'ซื้อที่ร้านแฟชั่น', price: 888888, g: 'f' },
  angel:     { name: 'ชุดเทวดา', nf: 'ชุดนางฟ้า', how: 'แพ็กเติมเงิน ฿99 (ไม่มีขายในร้าน)' },
  santa:     { name: 'ชุดซานต้า', nf: 'ชุดซานต้าสาว', how: 'ของขวัญปีใหม่ 2570 จากเมือง (ไม่มีขาย)' },
  // fashion collection 2 (normal money for the plain ones, diamonds for the prettiest)
  tigerpj:   { name: 'ชุดนอนลายเสือ', how: 'ซื้อที่ร้านแฟชั่น', price: 29999 },
  photog:    { name: 'ชุดช่างภาพสายลุย', how: 'ซื้อที่ร้านแฟชั่น', price: 49999, g: 'm' },
  raincoat:  { name: 'ชุดกันฝนสีเหลือง', how: 'ซื้อที่ร้านแฟชั่น', price: 69999 },
  explorer:  { name: 'ชุดนักสำรวจป่า', how: 'ซื้อที่ร้านแฟชั่น', price: 99999 },
  catsuit:   { name: 'ชุดแมวขาวขนฟู', how: 'ซื้อที่ร้านแฟชั่น', price: 159999 },
  chicken:   { name: 'ชุดไก่น้อยกุ๊กกุ๊ก', how: 'ซื้อที่ร้านแฟชั่น', gems: 100 },
  surf:      { name: 'ชุดสายเซิร์ฟฮาวาย', how: 'ซื้อที่ร้านแฟชั่น', gems: 150 },
  hiphop:    { name: 'ชุดฮิปฮอปสตรีท', how: 'ซื้อที่ร้านแฟชั่น', gems: 200 },
  thairoyal: { name: 'ชุดไทยราชสำนัก', how: 'ซื้อที่ร้านแฟชั่น', gems: 250 },
  martial:   { name: 'ชุดจอมยุทธ์มังกรแดง', nf: 'ชุดจอมยุทธ์หญิงมังกรแดง', how: 'ซื้อที่ร้านแฟชั่น', gems: 350 },
  knight:    { name: 'ชุดอัศวินเกราะเงิน', how: 'ซื้อที่ร้านแฟชั่น', gems: 450 },
  fortune:   { name: 'ชุดแม่หมอพยากรณ์', how: 'ซื้อที่ร้านแฟชั่น', gems: 300 } };
// 🎨 dyed versions of the shop outfits: same sheet (base), clothes recoloured to one hue on the client; sold like the original
const DYES = { red: ['แดง', 0], orange: ['ส้ม', 28], yellow: ['เหลือง', 52], green: ['เขียว', 125], sky: ['ฟ้า', 195], blue: ['น้ำเงิน', 228], purple: ['ม่วง', 275], pink: ['ชมพู', 325] };
const DYE_SETS = { tracksuit: ['sky', 'green'], hoodie: ['purple', 'red'], songkran: ['pink', 'purple'], bunny: ['sky', 'purple'], chinese: ['blue', 'purple'],
  lukthung: ['pink', 'blue'], muaythai: ['blue', 'green'], raincoat: ['red', 'sky', 'green'], catsuit: ['pink', 'sky'], chicken: ['blue', 'purple'],
  surf: ['pink', 'purple'], hiphop: ['blue', 'green'], martial: ['blue', 'purple'], knight: ['blue', 'red'] };
const DYE_WHITE = ['catsuit', 'chicken', 'knight'];   // white / silver cloth also takes a soft tint
// shop tabs
const OUTFIT_CAT = { casual: ['pajama', 'tracksuit', 'hoodie', 'student', 'scout', 'tigerpj', 'photog', 'raincoat', 'explorer', 'surf', 'hiphop'],
  thai: ['songkran', 'lanna', 'phasin', 'muaythai', 'lukthung', 'chinese', 'chakri', 'thai', 'thairoyal'],
  costume: ['bunny', 'catsuit', 'chicken', 'devil', 'cowboy', 'pilot', 'tuxedo', 'magician', 'martial', 'knight', 'fortune'] };
for (const [c, ids] of Object.entries(OUTFIT_CAT)) for (const id of ids) OUTFITS[id].cat = c;
for (const [base, ds] of Object.entries(DYE_SETS)) for (const d of ds) { const o = OUTFITS[base], [cn, hue] = DYES[d];
  OUTFITS[`${base}_${d}`] = { ...o, name: `${o.name} (สี${cn})`, ...(o.nf ? { nf: `${o.nf} (สี${cn})` } : {}), base, hue, cat: 'dye', nosale: 1, ...(DYE_WHITE.includes(base) ? { wt: 1 } : {}) }; }
// prestige titles bought with money (a money sink for the rich): not achievements, never counted in the achievement total
// the supporter title from the ฿49 top-up pack: lasts 30 days per purchase (stacks), sparkly rarity 8
const PAY_TITLE = { id: 'vip', title: '💖 ผู้สนับสนุนเมือง', r: 8, days: 30 };
const LUX_TITLES = [
  { id: 'lux1', title: 'คนมีอันจะกิน', r: 4, price: 1000000 },
  { id: 'lux2', title: 'พ่อเลี้ยงใหญ่', r: 5, price: 5000000 },
  { id: 'lux3', title: 'เจ้าสัวแห่งเมือง', r: 5, price: 20000000 },
  { id: 'lux4', title: 'ราชันย์เงินตรา', r: 7, price: 100000000 },
];
const ACHIEVEMENTS = [
  { id: 'zsurv1', r: 3, c: null, stat: 'zsurvive', n: 1, title: 'ผู้รอดชีวิต', desc: 'รอดจากคืนปล่อยผีได้ 1 ครั้ง' },
  { id: 'zsurv5', r: 5, c: null, stat: 'zsurvive', n: 5, title: 'นักล่าซอมบี้', desc: 'รอดจากคืนปล่อยผีได้ 5 ครั้ง' },
  { id: 'egg_legend', r: 7, c: null, stat: 'legendfish', n: 1, title: 'ผู้พิชิตตำนาน', desc: 'ตกปลาในตำนานได้', secret: 1 },
  { id: 'egg_explore', r: 4, c: null, stat: 'secrets', n: 1, title: 'นักสำรวจ', desc: 'เจอที่ลับในเมือง', secret: 1 },
  { id: 'egg_explore5', r: 5, c: null, stat: 'secrets', n: 5, title: 'นักสำรวจตัวจริง', desc: 'เจอที่ลับครบทั้ง 5 จุด', secret: 1 },
  { id: 'egg_mayor', r: 4, c: null, stat: 'mayorfound', n: 1, title: 'ตาเหยี่ยว', desc: 'จับได้ว่านายกฯ ปลอมตัวมาเดินเล่น', secret: 1 },
  { id: 'egg_wish', r: 3, c: null, stat: 'wishwin', n: 1, title: 'ดวงเฮง', desc: 'โยนเหรียญที่น้ำพุแล้วได้เงินก้อน', secret: 1 },
  { id: 'off1', r: 1, c: 'office', stat: 'shifts', n: 3, title: 'มนุษย์เงินเดือน', desc: 'เข้างานครบ 3 วัน' },
  { id: 'off2', r: 2, c: 'office', stat: 'ontime', n: 10, title: 'ตรงต่อเวลา', desc: 'เข้างานตรงเวลา 10 วัน' },
  { id: 'off3', r: 3, c: 'office', stat: 'promo', n: 4, title: 'ผู้จัดการไฟแรง', desc: 'ได้เลื่อนตำแหน่ง 4 ครั้ง' },
  { id: 'far1', r: 1, stat: 'harvest', n: 15, title: 'มือใหม่หัดปลูก', desc: 'เก็บเกี่ยว 15 ครั้ง' },
  { id: 'far2', r: 3, stat: 'plots', n: 6, title: 'เจ้าของไร่', desc: 'ขยายสวนจนครบ 6 แปลง' },
  { id: 'far3', r: 3, stat: 'durian', n: 10, title: 'ราชาทุเรียน', desc: 'เก็บทุเรียน 10 ครั้ง' },
  { id: 'fis1', r: 1, c: null, stat: 'fish', n: 25, title: 'นักตกปลา', desc: 'ตกปลาได้ 25 ตัว' },
  { id: 'fis2', r: 4, c: null, stat: 'shark', n: 1, title: 'นักล่าฉลาม', desc: 'ตกฉลามได้' },
  { id: 'fis3', r: 5, c: null, stat: 'chest', n: 1, title: 'ผู้โชคดี', desc: 'ตกได้หีบสมบัติ' },
  { id: 'mer1', r: 1, c: 'merchant', stat: 'wholesale', n: 50, title: 'พ่อค้าหน้าใหม่', desc: 'ประมูลชนะได้สินค้ารวม 50 ชิ้น' },
  { id: 'mer2', r: 3, c: 'merchant', stat: 'psold', n: 100, title: 'เจ้าสัว', desc: 'ขายของให้ผู้เล่นอื่น 100 ชิ้น' },
  { id: 'che1', r: 2, c: 'chef', stat: 'cooked', n: 20, title: 'แม่ครัวหัวป่าก์', desc: 'ปรุงอาหาร 20 จาน' },
  { id: 'che2', r: 4, c: 'chef', stat: 'cooked', n: 100, title: 'เชฟกระทะเหล็ก', desc: 'ปรุงอาหาร 100 จาน' },
  { id: 'doc1', r: 2, c: 'doctor', stat: 'treated', n: 5, title: 'หมอใจดี', desc: 'รักษาคนไข้หาย 5 คน' },
  { id: 'doc2', r: 4, c: 'doctor', stat: 'treated', n: 50, title: 'หัตถ์เทวดา', desc: 'รักษาคนไข้หาย 50 คน' },
  { id: 'doc3', r: 3, c: 'doctor', stat: 'revived', n: 3, title: 'ผู้กู้ชีพ', desc: 'ช่วยชีวิตผู้เล่นที่หมดสติ 3 ครั้ง' },
  { id: 'rid1', r: 1, c: 'rider', stat: 'delivered', n: 10, title: 'ไรเดอร์สายฟ้า', desc: 'ส่งอาหารสำเร็จ 10 ออเดอร์' },
  { id: 'rid2', r: 3, c: 'rider', stat: 'delivered', n: 60, title: 'ขาซิ่งประจำเมือง', desc: 'ส่งอาหารสำเร็จ 60 ออเดอร์' },
  { id: 'beg1', r: 1, c: 'beggar', stat: 'alms', n: 20, title: 'ผู้ยากไร้', desc: 'ได้รับเงินบริจาค 20 ครั้ง' },
  { id: 'gen5', r: 1, c: null, stat: 'donated', n: 5, title: 'ใจบุญ', desc: 'บริจาคให้ขอทาน 5 ครั้ง' },
  { id: 'gen6', r: 2, c: null, stat: 'cravings', n: 10, title: 'นักชิม', desc: 'กินของที่อยากกินได้ทันเวลา 10 ครั้ง' },
  { id: 'gen1', r: 1, c: null, stat: 'trades', n: 5, title: 'นักเจรจา', desc: 'แลกเปลี่ยนกับผู้เล่นอื่น 5 ครั้ง' },
  { id: 'gen2', r: 3, c: null, stat: 'worth', n: 100000, title: 'เศรษฐีใหม่', desc: 'มีทรัพย์สินรวม ฿100,000' },
  { id: 'gen3', r: 1, c: null, stat: 'calls', n: 5, title: 'สายโทรศัพท์', desc: 'โทรคุยกับเพื่อน 5 ครั้ง' },
  { id: 'gen4', r: 3, c: null, stat: 'degree', n: 1, title: 'บัณฑิต', desc: 'เรียนจบปริญญาตรี' },
  { id: 'fis4', r: 4, c: null, stat: 'fish', n: 300, title: 'เจ้าแห่งท้องน้ำ', desc: 'ตกปลาได้ 300 ตัว' },
  { id: 'fis6', r: 5, c: null, stat: 'shark', n: 10, title: 'ราชาฉลาม', desc: 'ตกฉลามได้ 10 ตัว' },
  { id: 'fis7', r: 3, c: null, stat: 'fishdex', n: 15, title: 'นักสะสมปลา', desc: 'ตกปลาได้ครบ 15 ชนิด' },
  { id: 'fis8', r: 4, c: null, stat: 'epicfish', n: 5, title: 'ตำนานริมน้ำ', desc: 'ตกปลาระดับมหากาพย์ขึ้นไปได้ 5 ตัว' },
  { id: 'fis9', r: 5, c: null, stat: 'goldenfish', n: 1, title: 'ผู้ครอบครองปลาทองคำ', desc: 'ตกปลาทองคำได้' },
  { id: 'far4', r: 4, stat: 'harvest', n: 200, title: 'เทพเกษตร', desc: 'เก็บเกี่ยว 200 ครั้ง' },
  { id: 'che3', r: 5, c: 'chef', stat: 'cooked', n: 500, title: 'ยอดเชฟแห่งเมือง', desc: 'ปรุงอาหาร 500 จาน' },
  { id: 'doc4', r: 5, c: 'doctor', stat: 'treated', n: 200, title: 'แพทย์ในตำนาน', desc: 'รักษาคนไข้หาย 200 คน' },
  { id: 'rid3', r: 5, c: 'rider', stat: 'delivered', n: 300, title: 'ตำนานไรเดอร์', desc: 'ส่งอาหารสำเร็จ 300 ออเดอร์' },
  { id: 'beg2', r: 3, c: 'beggar', stat: 'alms', n: 200, title: 'ขอทานพันล้าน', desc: 'ได้รับเงินบริจาค 200 ครั้ง' },
  { id: 'gen7', r: 5, c: null, stat: 'worth', n: 1000000, title: 'มหาเศรษฐี', desc: 'มีทรัพย์สินรวม ฿1,000,000' },
  { id: 'gen8', r: 3, c: null, stat: 'trades', n: 50, title: 'นักค้าขายตัวยง', desc: 'แลกเปลี่ยนกับผู้เล่นอื่น 50 ครั้ง' },
  { id: 'gen9', r: 4, c: null, stat: 'donated', n: 50, title: 'นักบุญแห่งเมือง', desc: 'บริจาคให้ขอทาน 50 ครั้ง' },
  { id: 'gen10', r: 2, c: null, stat: 'calls', n: 50, title: 'คนช่างคุย', desc: 'โทรคุยกับเพื่อน 50 ครั้ง' },
  { id: 'gen11', r: 3, c: null, stat: 'cravings', n: 50, title: 'นักชิมระดับมิชลิน', desc: 'กินของที่อยากกินได้ทันเวลา 50 ครั้ง' },
  { id: 'gen12', r: 2, c: null, stat: 'mails', n: 10, title: 'นักเขียนจดหมาย', desc: 'ส่งจดหมายถึงผู้เล่นอื่น 10 ฉบับ' },
  // loyalty and long-term goals
  { id: 'log7', r: 1, stat: 'loginDays', n: 7, title: 'ขาประจำ', desc: 'เข้าเกมรวม 7 วัน' },
  { id: 'log30', r: 3, stat: 'loginDays', n: 30, title: 'ชาวเมืองตัวจริง', desc: 'เข้าเกมรวม 30 วัน' },
  { id: 'log100', r: 5, stat: 'loginDays', n: 100, title: 'ตำนานแห่งเมือง', desc: 'เข้าเกมรวม 100 วัน' },
  { id: 'wk1', r: 2, stat: 'weekAll', n: 1, title: 'นักล่าเควสต์', desc: 'ทำเควสต์รายสัปดาห์ครบ 1 สัปดาห์' },
  { id: 'wk4', r: 4, stat: 'weekAll', n: 4, title: 'ยอดนักผจญภัย', desc: 'ทำเควสต์รายสัปดาห์ครบ 4 สัปดาห์' },
  // small steps: no title, just 💎1–3 (nt = no title, g = diamonds)
  ...[['s_fish1', 'fish', 1, 1, 'ปลาตัวแรก', 'ตกปลาได้ตัวแรก'], ['s_fish100', 'fish', 100, 3, 'ปลาร้อยตัว', 'ตกปลาได้ 100 ตัว'],
    ['s_dex5', 'fishdex', 5, 2, 'สมุดปลาเล่มเล็ก', 'บันทึกปลาลงสมุดภาพ 5 ชนิด'], ['s_harv1', 'harvest', 1, 1, 'ผลผลิตแรก', 'เก็บเกี่ยวได้ครั้งแรก'],
    ['s_harv50', 'harvest', 50, 2, 'มือเปื้อนดิน', 'เก็บเกี่ยว 50 ครั้ง'], ['s_shift1', 'shifts', 1, 1, 'วันแรกของการทำงาน', 'เข้างานครบ 1 วัน'],
    ['s_login3', 'loginDays', 3, 1, 'กลับมาอีกแล้ว', 'เข้าเกมรวม 3 วัน'], ['s_login14', 'loginDays', 14, 2, 'สองสัปดาห์ในเมือง', 'เข้าเกมรวม 14 วัน'],
    ['s_call1', 'calls', 1, 1, 'ฮัลโหล', 'โทรหาเพื่อนครั้งแรก'], ['s_mail1', 'mails', 1, 1, 'จดหมายฉบับแรก', 'ส่งจดหมายถึงผู้เล่นอื่นครั้งแรก'],
    ['s_trade1', 'trades', 1, 1, 'ดีลแรก', 'แลกเปลี่ยนกับผู้เล่นอื่นครั้งแรก'], ['s_donate1', 'donated', 1, 1, 'ใจบุญ', 'บริจาคให้ขอทานครั้งแรก'],
    ['s_cook5', 'cooked', 5, 1, 'เข้าครัว', 'ทำอาหาร 5 จาน'], ['s_crave3', 'cravings', 3, 1, 'อยากกินต้องได้กิน', 'กินของที่อยากกินทันเวลา 3 ครั้ง'],
    ['s_rides5', 'rides', 5, 2, 'ขาเครื่องเล่น', 'เล่นเครื่องเล่นในสวนสนุก 5 ครั้ง'], ['s_pray3', 'pray', 3, 1, 'สายบุญ', 'ไหว้พระ 3 ครั้ง'],
    ['s_quiz5', 'quizOk', 5, 2, 'หัวไว', 'ตอบคำถามถูก 5 ข้อ'], ['s_miss3', 'missions', 3, 2, 'รับจ๊อบ', 'ทำภารกิจสำเร็จ 3 ครั้ง'],
    ['s_dogs1', 'dogs', 1, 1, 'เพื่อนสี่ขา', 'ดูแลน้องหมาครั้งแรก'], ['s_worth50k', 'worth', 50000, 3, 'เริ่มมีเก็บ', 'มีทรัพย์สินรวม ฿50,000']]
    .map(([id, stat, n, g, title, desc]) => ({ id, r: 1, nt: 1, g, stat, n, title, desc })),
];
// title rarity: common → legendary (colour on the name tag)
const RARITY = [null, { name: 'ธรรมดา', col: '#e8e8e8' }, { name: 'ไม่ธรรมดา', col: '#7be07b' }, { name: 'หายาก', col: '#62b8ff' }, { name: 'มหากาพย์', col: '#d08cff' }, { name: 'ตำนาน', col: '#ffb43c' }];

// trash bins beggars can dig through (one station in front of each bin in town)
PROPS.filter(p => /bin/.test(p.s) && areaAt(p.x, p.y)?.id === 'town').forEach((p, i) => STATIONS.push({ id: 'trash' + i, type: 'trash', label: 'ถังขยะ', icon: '🗑️', x: p.x, y: p.y + .7, r: 1.1, area: 'town' }));
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

// easter eggs: the wishing fountain, the disguised mayor, the legendary fish and the secret signs
const EGG = { wishCost: 10, wishWin: 1000, wishOdds: 50, wishDay: 30, legend: { x: 38.6, y: 62.4, r: 2.8, odds: .25 }, secretGems: 5, secretFrame: 30, mayorGems: 3 };
const FORTUNES = [
  'วันนี้ปลาหายากจะกินเบ็ดคุณ', 'จะมีคนแปลกหน้าทักคุณก่อน แล้วกลายเป็นเพื่อนสนิท', 'เงินจะไหลมาเทมา... แต่ก็จะไหลออกเหมือนกัน', 'อย่าเพิ่งขายหุ้นวันนี้ รออีกนิด',
  'ของที่คุณตามหาอยู่ใกล้กว่าที่คิด', 'วันนี้เหมาะกับการกินของอร่อยๆ สักมื้อ', 'มีคนแอบชื่นชมคุณอยู่นะ', 'ดวงการงานรุ่งเรือง เจ้านายจะยิ้มให้',
  'ระวังเดินชนเสาไฟ', 'ลองเดินไปมุมที่ไม่เคยไป อาจเจออะไรดีๆ', 'คืนนี้ดาวสวย ฟ้าเปิด', 'สัตว์เลี้ยงของคุณรักคุณมากกว่าที่คิด',
  'โชคดีจะมาตอนที่คุณไม่ทันตั้งตัว', 'วันนี้เหมาะกับการโทรหาเพื่อนเก่า', 'น้ำพุบอกว่า... ขอเหรียญอีกสักเหรียญ', 'ดวงความรักสดใส ยิ้มเยอะๆ นะ',
  'เที่ยงคืนเป็นเวลาของสิ่งแปลกประหลาด', 'คนที่เดินผ่านคุณไปเมื่อกี้ อาจไม่ใช่คนธรรมดา', 'อดทนอีกนิด สิ่งที่รอจะมาถึง', 'วันนี้ใครให้อะไร รับไว้ด้วยรอยยิ้ม',
];
// 🔮 tarot reading at the fortune teller's tent: pick a topic (money / work / love), draw ONE card (upright or reversed), once a day.
// s = [upright, reversed] omen: 1 good, 0 neutral, -1 warning. A good omen pays a small bonus.
const FORTUNE = { price: 50, perDay: 1, bonus: 30, topics: { money: ['💰', 'การเงิน'], work: ['💼', 'การงาน'], love: ['💖', 'ความรัก'] } };
const TAROT = {   // key order = card order in assets/tarot.webp (see tools/build_tarot.py)
  fool:       { n: 'ไพ่ผู้เริ่มต้น (The Fool)', s: [1, -1],
    up: { money: 'มีโอกาสหาเงินทางใหม่ๆ ลองเสี่ยงเล็กน้อยได้ แต่อย่าทุ่มหมดตัว', work: 'เริ่มงานหรือไอเดียใหม่ได้เลย วันนี้ใจกล้าจะพาไปไกล', love: 'ความสัมพันธ์ใหม่กำลังจะเริ่ม เปิดใจให้คนแปลกหน้าสักนิด' },
    rev: { money: 'ระวังใช้เงินไม่คิด ของที่อยากได้ตอนนี้อาจไม่จำเป็น', work: 'อย่าเพิ่งรีบตัดสินใจเรื่องงาน คิดให้รอบคอบก่อน', love: 'ระวังพูดหรือทำอะไรหุนหัน อาจทำให้คนที่รักเข้าใจผิด' } },
  magician:   { n: 'ไพ่นักมายากล (The Magician)', s: [1, -1],
    up: { money: 'คุณมีฝีมือหาเงินอยู่ในมือแล้ว ลงมือทำเลยวันนี้', work: 'ความสามารถของคุณโดดเด่น เหมาะกับการนำเสนอหรือเริ่มโปรเจกต์', love: 'เสน่ห์ของคุณเปล่งประกาย พูดอะไรคนก็อยากฟัง' },
    rev: { money: 'ระวังคำชวนลงทุนที่ฟังดีเกินจริง', work: 'อย่าพูดเกินความจริงกับเพื่อนร่วมงานหรือลูกค้า', love: 'มีคนพูดหวานเกินไป ลองดูการกระทำมากกว่าคำพูด' } },
  priestess:  { n: 'ไพ่นักบวชหญิง (The High Priestess)', s: [0, -1],
    up: { money: 'อย่าเพิ่งรีบ เก็บข้อมูลก่อนตัดสินใจเรื่องเงิน', work: 'เชื่อสัญชาตญาณของคุณ มีคำตอบอยู่ในใจแล้ว', love: 'ความรู้สึกลึกๆ ของคุณถูกต้อง ฟังเสียงหัวใจให้มาก' },
    rev: { money: 'มีค่าใช้จ่ายซ่อนอยู่ ตรวจรายการให้ละเอียด', work: 'มีบางอย่างที่ยังไม่ถูกบอก ลองถามให้ชัดก่อน', love: 'อย่าเก็บความรู้สึกไว้คนเดียว ลองพูดออกมาตรงๆ' } },
  empress:    { n: 'ไพ่จักรพรรดินี (The Empress)', s: [1, 0],
    up: { money: 'ความอุดมสมบูรณ์กำลังมา ผลงานที่ลงแรงไว้จะออกดอกผล', work: 'งานที่ใส่ใจดูแลมาตลอดจะได้รับคำชม', love: 'ความรักอบอุ่นและเติบโต เหมาะกับการดูแลคนที่รัก' },
    rev: { money: 'ใช้จ่ายให้ตัวเองบ้าง แต่อย่าฟุ่มเฟือยเกินไป', work: 'พักผ่อนให้พอ อย่าให้งานกินเวลาชีวิตทั้งหมด', love: 'อย่าลืมรักตัวเองก่อน แล้วความรักจะดีขึ้นเอง' } },
  emperor:    { n: 'ไพ่จักรพรรดิ (The Emperor)', s: [1, -1],
    up: { money: 'การวางแผนการเงินที่มั่นคงจะให้ผลดี ออมเพิ่มได้', work: 'ผู้นำและความรับผิดชอบของคุณจะเป็นที่ยอมรับ', love: 'ความรักที่มั่นคงและเชื่อถือได้ กำลังอยู่ใกล้คุณ' },
    rev: { money: 'ระวังยึดติดกับความคิดเดิมเรื่องเงินมากเกินไป', work: 'อย่าดื้อ ลองฟังความเห็นของคนอื่นบ้าง', love: 'ระวังการควบคุมกันเกินไป ให้พื้นที่แก่กันบ้าง' } },
  hierophant: { n: 'ไพ่พระสังฆราช (The Hierophant)', s: [1, 0],
    up: { money: 'ผู้ใหญ่ใจดีหรือคนมีประสบการณ์จะแนะนำเรื่องเงินให้', work: 'เรียนรู้จากรุ่นพี่แล้วจะก้าวหน้าเร็วขึ้น', love: 'ความรักแบบดั้งเดิม ซื่อตรง จริงใจ จะนำโชคมาให้' },
    rev: { money: 'ไม่ต้องทำตามคนอื่นเสมอไป ลองหาวิธีของตัวเอง', work: 'วิธีเดิมๆ อาจไม่เวิร์กแล้ว ลองคิดนอกกรอบ', love: 'อย่ายึดกฎของใครมากเกินไป ทำตามใจตัวเองบ้าง' } },
  chariot:    { n: 'ไพ่รถศึก (The Chariot)', s: [1, -1],
    up: { money: 'ความมุ่งมั่นจะพาคุณถึงเป้าหมายทางการเงิน', work: 'ลุยเต็มที่ได้เลย งานเดินหน้าและชนะอุปสรรค', love: 'ถ้าชอบใครอยู่ วันนี้กล้าก้าวเข้าไปได้' },
    rev: { money: 'ไปเร็วเกินไปอาจพลาด ชะลอและเช็กตัวเลขอีกที', work: 'ระวังรีบจนงานผิดพลาด ใจเย็นลงสักนิด', love: 'อย่าฝืนเร่งความสัมพันธ์ ให้เวลาแก่กัน' } },
  strength:   { n: 'ไพ่พลัง (Strength)', s: [1, 0],
    up: { money: 'ความอดทนและใจเย็นจะช่วยให้การเงินมั่นคง', work: 'คุณรับมือแรงกดดันได้ดี งานยากวันนี้ผ่านไปได้', love: 'ความอ่อนโยนและความเข้าใจชนะใจคนที่รัก' },
    rev: { money: 'ช่วงนี้ใจอาจไม่มั่นใจเรื่องเงิน อย่าเพิ่งตัดสินใจใหญ่', work: 'ใจอ่อนแรงนิดหน่อย ขอกำลังใจจากเพื่อนร่วมงานได้', love: 'อย่ากลัวที่จะอ่อนแอต่อหน้าคนที่ไว้ใจ' } } };
// food no longer gives energy (energy comes back by sleeping at home or at the amusement park)
for (const it of Object.values(ITEMS)) if (it.eat && it.eat.energy && !it.keepEnergy) { delete it.eat.energy; if (!Object.keys(it.eat).length) it.eat.happy = 2; }
// what the plant nursery sells: every garden piece, plus the potted plants for indoors
const PLANT_INDOOR = ['xfern', 'xbonsai', 'xtree', 'xplantx', 'xvases', 'xflowers', 'xopalm', 'xotree', 'xotulip', 'xoroses', 'xopot', 'xocactus', 'xobowl', 'xoplanter'];
module.exports = { FIELD, FOOTBALL, TAROT, FORTUNE, BALLOONS, QUIZ, PLANT_INDOOR, POOL, PSHOP, TSHOP, TEMPLEQ, EGG, FORTUNES, RIDES, ENERGY_MUL,
  RUN, CLOCK, gameRate, DOCTOR, ICU, FISHING, OUTFITS, LUX_TITLES, PAY_TITLE,
  LOOKS, SHIRTS, NPC_LINES, FOLK, MONTH_DAYS, MONTHS, monthIdx, dateAt, UTIL, POLICE_TEST, POLICE, HAPPY,
  W, H, TILES, AREAS, ROOMS, BUILDINGS, STATIONS, PROPS, TREES, LOTS, GARDEN, GATES, CSTORE, STOCKS, STOCK, YARD, YARDS, yardZone, SPAWN, RADIUS, SOLID,
  areaAt, roomAt, blocked, DAY_MS, TIME_OFF, hourAt, dayAt, HOURS, isOpen, SHIFT,
  RARITY, FISH_RARITY, RODS, ROD_ORDER, PETS, DOGQ, JOBGAMES, THIEFQ, COOK, FRAMES, waterPool, ITEMS, CATEGORIES, CROPS, RECIPES, FISH, BIG_FISH, CAREERS, LICENSES, DRIVING_TEST, JOB_COOLDOWN_MIN, OFFICE_TITLES, OFFICE_WAGE, RIDER, EVENTS,
  VEHICLES, TOOLS, TOOL_PRICES, HOUSE_PRICES, HOUSE_RENT, HOME_TIERS, HOME_STYLES, HOME_FLOORS, HOME_WALLS, FURNITURE, HOUSE_FLOORS, FLOOR_PRICE, floorRoom, BANK, DISEASES, TREATMENTS, NPC_NAMES, ACHIEVEMENTS,
};
