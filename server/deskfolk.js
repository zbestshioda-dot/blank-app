'use strict';
// 💞 staff and shopkeepers you can befriend too (they stay at their counter): same friendship as the walking townsfolk.
// [id, name (as the game shows it), stations they stand at, favourite item, liked items, about]
const ROWS = [
  ['d_monk', 'หลวงพ่อเย็น (เจ้าอาวาส)', ['staff_monk'], 'offering', ['malai', 'water', 'kanomthai'], 'เจ้าอาวาสใจเย็น สอนธรรมะด้วยมุกตลก'],
  ['d_templeboy', 'พี่ตุ๋ย (เด็กวัดรุ่นพี่)', ['staff_templeboy'], 'kanomkrok', ['soda', 'luukchup', 'kanomthai'], 'เด็กวัดขยัน แอบกินขนมหลังวัดประจำ'],
  ['d_undertaker', 'ลุงสัป (สัปเหร่อประจำวัด)', ['staff_undertaker'], 'thaitea', ['coffee', 'malai', 'khaotom'], 'ดูน่ากลัวแต่ใจดีที่สุดในวัด'],
  ['d_mechanic', 'ช่างเปี๊ยก (อู่หน้าโชว์รูม)', ['staff_mechanic', 'toolshop'], 'drink', ['coffee', 'sausage', 'kaprao'], 'ซ่อมได้ทุกอย่าง ยกเว้นหัวใจตัวเอง'],
  ['d_thug', 'เสี่ยเสือ (ลูกพี่ประจำตลาด)', ['staff_thug'], 'shabu', ['meatball', 'soda', 'sausage'], 'หน้าโหด ใจนุ่ม คุมตลาดมาสิบปี'],
  ['d_detective', 'ผู้กองเดช (สำนักงานนักสืบ)', ['staff_detective'], 'coffee', ['bread', 'choco', 'hotdog'], 'นักสืบเก่า ไม่เคยปิดคดีที่ค้างในใจได้สักคดี'],
  ['d_photographer', 'พี่โฟกัส (สตูดิโอถ่ายภาพ)', ['staff_photographer'], 'thaitea', ['cottoncandy', 'coconutice', 'popcorn'], 'ช่างภาพอารมณ์ศิลปิน ชอบแสงตอนเย็น'],
  ['d_courier', 'พี่ด่วน (หัวหน้าส่งพัสดุ)', ['staff_courier'], 'bento', ['drink', 'water', 'bread'], 'พูดเร็ว เดินเร็ว กินข้าวเร็ว'],
  ['d_office', 'คุณนภา (ฝ่ายบุคคล)', ['staff_office'], 'choco', ['coffee', 'thaitea', 'luukchup'], 'ฝ่ายบุคคลสายเป๊ะ จำวันเกิดพนักงานได้ทุกคน'],
  ['d_fishing', 'น้าเล็ก (สมาคมประมง)', ['staff_fishing'], 'grilled_fish', ['somtam', 'sausage', 'water'], 'นักตกปลารุ่นเก๋า เล่าเรื่องปลาได้ทั้งวัน'],
  ['d_merchant', 'เฮียชัย (เจ้าของโรงประมูล)', ['staff_merchant'], 'durian', ['durian_sweet', 'tomyum', 'thaitea'], 'พ่อค้าตาถึง รู้ราคาของทุกอย่างในเมือง'],
  ['d_doctor', 'หมอแพร (ผอ.โรงพยาบาล)', ['staff_doctor'], 'watermelon', ['water', 'tomato', 'corn_soup'], 'หมอใจดี ห่วงสุขภาพทุกคนยกเว้นตัวเอง'],
  ['d_chef', 'เชฟหมี (หัวหน้าครัวใหญ่)', ['staff_chef'], 'pumpkin', ['tomato', 'corn', 'durian'], 'เชฟตัวใหญ่ เสียงดัง รักวัตถุดิบสด'],
  ['d_rider', 'พี่ต่อ (หัวหน้าไรเดอร์)', ['staff_rider'], 'kaprao', ['drink', 'coffee', 'soda'], 'ไรเดอร์รุ่นแรกของเมือง รู้ทางลัดทุกซอย'],
  ['d_police', 'ผู้กองเอก (สถานีตำรวจ)', ['staff_police'], 'fried_rice', ['coffee', 'meatball', 'water'], 'ตำรวจหนุ่มจริงจัง แต่แพ้ทางลูกแมว'],
  ['d_bartender', 'เจ๊แอน (เจ้าของบาร์)', ['staff_bartender'], 'namlamyai', ['coconutice', 'popcorn', 'choco'], 'เจ้าของบาร์ปากจัด รับฟังทุกเรื่องของลูกค้า'],
  ['d_cashier', 'พี่แนน (ผู้จัดการร้าน)', ['staff_cashier'], 'icecream', ['snack', 'soda', 'bento'], 'ผู้จัดการร้านสะดวกซื้อ ยิ้มเก่งแม้กะดึก'],
  ['d_beggar', 'ลุงจุก (ศาลาประชาคม)', ['staff_beggar'], 'bento', ['bread', 'water', 'khaotom'], 'ลุงขอทานอารมณ์ดี รู้ข่าวทุกเรื่องในเมือง'],
  ['d_guide', 'พี่ฟ้า (จุดแนะนำเมือง)', ['guide'], 'cottoncandy', ['thaitea', 'luukchup', 'malai'], 'คนแรกที่ทักทายทุกคนที่มาถึงเมือง'],
  ['d_workshop', 'ช่างโต (โรงช่างคราฟ)', ['workshop'], 'sausage', ['coffee', 'drink', 'meatball'], 'ช่างไม้มือหนัก ทำของได้ทุกอย่างจากเศษไม้'],
  ['d_balloon', 'ลุงโป่ง (ร้านลูกโป่ง)', ['balloon'], 'popcorn', ['cottoncandy', 'soda', 'icecream'], 'นักมายากลเกษียณ ขายลูกโป่งให้เด็ก ๆ'],
  ['d_fortune', 'แม่หมอจันทรา (แม่หมอพยากรณ์)', ['fortune'], 'malai', ['offering', 'thaitea', 'kanomthai'], 'ทายแม่นจนน่ากลัว แต่ไม่เคยทายเรื่องตัวเอง'],
  ['d_pet1', 'น้องมะลิ (ร้านสัตว์เลี้ยง)', ['petshop1'], 'coconutice', ['luukchup', 'cottoncandy', 'icecream'], 'รักสัตว์ทุกชนิด ตั้งชื่อให้นกพิราบทุกตัวในเมือง'],
  ['d_pet2', 'พี่ภูผา (ร้านสัตว์เลี้ยง สาขา 2)', ['petshop2'], 'hotdog', ['sausage', 'soda', 'meatball'], 'ตัวโต ใจดี หมาทุกตัววิ่งเข้าหา'],
  ['d_restaurant', 'ป้าแดง (เจ้าของร้านอาหาร)', ['restaurant'], 'somtam', ['corn', 'tomato', 'pumpkin'], 'แม่ครัวมือหนัก ตักข้าวให้พูนจาน'],
  ['d_barber', 'ช่างโอ๋ (ช่างทำผม)', ['barber'], 'thaitea', ['luukchup', 'choco', 'coffee'], 'ช่างผมช่างเม้าท์ รู้ทุกเรื่องในเมืองจากเก้าอี้ตัดผม'],
  ['d_plant', 'ป้าสายใจ (ร้านต้นไม้)', ['plantshop'], 'watermelon', ['corn', 'pumpkin', 'tomato'], 'คุยกับต้นไม้ทุกเช้า และต้นไม้ก็โตดีจริง ๆ'],
  ['d_furn', 'น้องเก่ง (ร้านเฟอร์นิเจอร์)', ['furnshop'], 'noodle', ['soda', 'snack', 'popcorn'], 'นักออกแบบหนุ่ม ฝันอยากแต่งบ้านทั้งเมือง'],
  ['d_policedesk', 'ดาบหญิงสมศรี (เวรประจำโต๊ะ)', ['police'], 'kanomkrok', ['coffee', 'thaitea', 'khaotom'], 'เวรประจำโต๊ะสายแม่ ดุแต่ห่วงทุกคน'],
  ['d_school', 'ผอ.ประเสริฐ (ผู้อำนวยการ)', ['school'], 'coffee', ['kanomthai', 'namlamyai', 'bread'], 'ผู้อำนวยการใจดี ชอบเล่าเรื่องสมัยหนุ่ม'],
  ['d_cstore1', 'น้องฝน (พนักงานร้าน)', ['cstore'], 'icecream', ['snack', 'choco', 'soda'], 'พนักงานร้านยิ้มหวาน จำเมนูประจำของลูกค้าได้'],
  ['d_cstore2', 'น้องภูมิ (พนักงานร้านเบเกอรี่ · นักศึกษา)', ['bakery'], 'bk_croissant', ['coffee', 'bk_donut', 'drink'], 'นักศึกษาทำงานพิเศษ ง่วงตลอดเวลา'],
  ['d_cstore3', 'น้องแพร (พนักงานร้าน)', ['cstore3'], 'choco', ['cottoncandy', 'thaitea', 'icecream'], 'สาวขี้อาย ชอบวาดรูปบนกระดาษใบเสร็จ'],
  ['d_cstore4', 'ยายบุญ (เจ้าของร้าน สาขาหมู่บ้าน)', ['cstore4'], 'kanomthai', ['khaotom', 'namlamyai', 'luukchup'], 'ยายใจดีที่ให้เด็ก ๆ ติดหนี้ค่าขนมได้'],
  ['d_market', 'เจ๊ศรี (ผู้ดูแลตลาดกลาง)', ['market'], 'durian_sweet', ['durian', 'somtam', 'tomyum'], 'เจ๊ใหญ่ประจำตลาด ต่อราคาไม่เคยแพ้ใคร'],
  ['d_estate', 'คุณจิ๋ม (นายหน้าอสังหาฯ)', ['estate'], 'choco', ['coffee', 'coconutice', 'luukchup'], 'นายหน้าพูดเก่ง ขายบ้านได้แม้แต่ให้คนที่ไม่ได้อยากซื้อ'],
  ['d_pr', 'คุณแพรว (ประชาสัมพันธ์บริษัท)', ['office'], 'luukchup', ['thaitea', 'cottoncandy', 'choco'], 'ประชาสัมพันธ์สายสดใส ทักทายทุกคนด้วยชื่อ'],
  ['d_fashion', 'น้องมุก (ร้านแฟชั่น)', ['fashion'], 'cottoncandy', ['coconutice', 'icecream', 'choco'], 'แฟชั่นนิสต้าประจำเมือง เปลี่ยนชุดวันละสามรอบ'],
  ['d_riderdesk', 'พี่แบงค์ (เคาน์เตอร์ศูนย์ไรเดอร์)', ['rider'], 'noodle', ['drink', 'kaprao', 'soda'], 'คุมเคาน์เตอร์ไรเดอร์ จำเลขทะเบียนรถได้ทุกคัน'],
  ['d_dealer', 'คุณโอม (พนักงานขายรถ)', ['dealer'], 'coffee', ['sausage', 'hotdog', 'drink'], 'เซลส์ขายรถยิ้มกว้าง ฝันอยากขับซูเปอร์คาร์'],
  ['d_bank', 'คุณนิด (พนักงานธนาคาร)', ['bank'], 'thaitea', ['kanomthai', 'luukchup', 'coffee'], 'พนักงานธนาคารละเอียดยิบ นับเงินเร็วที่สุดในเมือง'],
];
let h = 7;
module.exports = ROWS.map(([id, name, sts, love, likes, about]) => {
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;   // a fixed birthday per person
  return { id, name, sts, love, likes, about, desk: 1, bday: [1 + h % 12, 1 + (h >>> 5) % 28] };
});
