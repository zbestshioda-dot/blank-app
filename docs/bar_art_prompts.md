# 🍸 รูปที่ต้องใช้สำหรับบาร์ชิลล์ราตรี

ตอนนี้บาร์ใช้ของเก่าในเกมแทนไปก่อน (รูปตึกโรงหนัง เคาน์เตอร์จากคาสิโน ฯลฯ) เล่นได้เลย
ถ้าอยากได้รูปของบาร์เอง ให้สร้างรูป 2 รูปตาม prompt ด้านล่าง (ใช้ ChatGPT / Gemini ก็ได้)
แล้วอัปโหลดไปไว้ที่ `tools/sheets/` ตั้งชื่อไฟล์ให้ตรงตามนี้:

| ไฟล์ | มีอะไร |
|---|---|
| `tools/sheets/bar_bldg.jpg` | ตึกบาร์ 1 หลัง |
| `tools/sheets/bar_props.jpg` | ของในร้าน 15 ชิ้น เรียง 4 แถว (4-4-4-3) |

จากนั้นบอก Claude ว่า **"ใส่รูปบาร์"** แล้ว Claude จะรัน `python3 tools/add_bar.py && node tools/build_snow_atlas.js` และอัปเดตเวอร์ชันรูปให้เอง

**กฎสำคัญ (ไม่งั้นตัดรูปไม่ได้):**
- พื้นหลังต้องเป็น **สีชมพูม่วงล้วน #FF00FF** ห้ามมีลาย ห้ามไล่สี
- ของแต่ละชิ้นต้อง **แยกห่างกัน** ไม่แตะกัน และไม่มีเงาตกบนพื้นหลัง
- จำนวนชิ้นในแต่ละแถวต้องตรงเป๊ะ และเรียงซ้ายไปขวาตามลำดับในรายการ
- ไม่มีตัวหนังสือ ไม่มีลายน้ำ ไม่มีคน

---

## 1) ตึกบาร์ → `bar_bldg.jpg`

```
Cute cozy pixel art game sprite, 3/4 top-down view, same style as a cozy Thai life-sim town (bright colours,
clean dark outlines, soft shading). ONE single building centred on a flat solid magenta #FF00FF background:
a small two-storey night bar / pub with a dark wood and brick front, big warm-lit windows, a glowing neon
cocktail-glass sign above the door (no letters), string lights along the roof edge, a wooden double door
in the middle of the front, two potted plants and a small chalkboard stand by the door, a striped awning.
Front-facing, slightly wider than tall (about 6 : 5.5). No ground, no shadow on the background, no text,
no people, no watermark. Wide margin of magenta around the building.
```

## 2) ของในร้าน → `bar_props.jpg`

```
Cute pixel art game furniture sprite sheet, 3/4 top-down view, clean dark outlines, soft shading, warm
night-bar mood, matching a cozy pixel life-sim game. Flat solid magenta #FF00FF background. 15 separate
objects in 4 neat rows, every object clearly separated from the others with lots of magenta space,
no shadows on the background, no text, no people, no watermark.

Row 1 (4 objects, left to right):
 1. a long wooden bar counter with a polished top, a few glasses and a cocktail shaker on it (wide)
 2. a wall shelf full of colourful liquor bottles with a warm backlight (medium-wide, flat, hangs on a wall)
 3. a tall glass-door drinks fridge with beer bottles inside, glowing
 4. a small beer tap tower with 3 brass taps

Row 2 (4 objects):
 5. one tall round bar stool with a red leather seat and chrome leg (small)
 6. a round wooden pub table with two chairs
 7. a cosy red leather booth sofa (wide, low)
 8. a green felt pool table with balls racked and two cues (wide)

Row 3 (4 objects):
 9. a small low wooden karaoke stage platform with a red carpet top and a row of tiny lights on its front edge (wide, flat)
10. a karaoke microphone on a stand (thin, small)
11. a tall black loudspeaker on a stand
12. a glowing neon sign shaped like a cocktail glass and a music note, pink and cyan (no letters)

Row 4 (3 objects):
13. a round dartboard hanging on a small wooden backboard with darts in it
14. a tall warm floor lamp with a fabric shade
15. a wooden beer barrel standing upright
```

---

### ชื่อที่ใช้ในเกม (สำหรับ Claude)

`b_bar` (ตึก) · `br_counter br_shelf br_fridge br_tap` · `br_stool br_table br_sofa br_pool` ·
`br_stage br_mic br_speaker br_neon` · `br_dart br_lamp br_barrel` — ขนาดแต่ละชิ้นอยู่ใน `tools/add_bar.py`
