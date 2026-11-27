# 🧁 รูปที่ต้องใช้สำหรับร้านเบเกอรี่หวานใจ

ตอนนี้ร้านเปิดเล่นได้แล้ว แต่ใช้รูปเก่าแทนไปก่อน (ตึกหน้าตาเหมือนร้านอาหาร ส่วนของในร้านเอามาจากร้านอาหาร)
ถ้าอยากได้รูปของร้านเอง ให้สร้างรูป 2 รูปตาม prompt ด้านล่าง (ใช้ ChatGPT / Gemini ก็ได้)
แล้วอัปโหลดไปไว้ที่ `tools/sheets/` ตั้งชื่อไฟล์ให้ตรงตามนี้:

| ไฟล์ | มีอะไร |
|---|---|
| `tools/sheets/bakery_bldg.jpg` | ตึกร้านเบเกอรี่ 1 หลัง |
| `tools/sheets/bakery_props.jpg` | ของในร้าน 10 ชิ้น เรียง 3 แถว (3-3-4) |

จากนั้นบอก Claude ว่า **"ใส่รูปเบเกอรี่"** แล้ว Claude จะรัน `python3 tools/add_bakery.py && node tools/build_snow_atlas.js` และอัปเดตเวอร์ชันรูปให้เอง

**กฎสำคัญ (ไม่งั้นตัดรูปไม่ได้):**
- พื้นหลังต้องเป็น **สีชมพูม่วงล้วน #FF00FF** ห้ามมีลาย ห้ามไล่สี
- ของแต่ละชิ้นต้อง **แยกห่างกัน** ไม่แตะกัน และไม่มีเงาตกบนพื้นหลัง
- จำนวนชิ้นในแต่ละแถวต้องตรงเป๊ะ และเรียงซ้ายไปขวาตามลำดับในรายการ
- ไม่มีตัวหนังสือ ไม่มีลายน้ำ ไม่มีคน

---

## 1) ตึกร้าน → `bakery_bldg.jpg`

```
Cute cozy pixel art game sprite, 3/4 top-down view, same style as a cozy Thai life-sim town (bright colours,
clean dark outlines, soft shading). ONE single building centred on a flat solid magenta #FF00FF background:
a small sweet one-storey bakery and cake shop with a pastel pink and cream front, a pink-and-white striped
awning, a big display window showing a tiered cake, cupcakes and bread loaves, a giant cupcake ornament on
the roof, a wooden door with a round window in the middle of the front, flower boxes under the windows and
a small chalkboard stand by the door. Front-facing, a little wider than tall (about 5 : 4.5).
No ground, no shadow on the background, no text, no people, no watermark. Wide margin of magenta around it.
```

## 2) ของในร้าน → `bakery_props.jpg`

```
Cute pixel art game furniture sprite sheet, 3/4 top-down view, clean dark outlines, soft shading, warm
pastel bakery mood, matching a cozy pixel life-sim game. Flat solid magenta #FF00FF background. 10 separate
objects in 3 neat rows, every object clearly separated from the others with lots of magenta space,
no shadows on the background, no text, no people, no watermark.

Row 1 (3 objects, left to right):
 1. a wooden bakery counter with a cash register, a tray of cookies and a cake stand with a glass dome (wide)
 2. a glass cake display case full of cake slices: chocolate, strawberry shortcake, blueberry cheesecake (medium-wide)
 3. a brick bread oven with a warm orange glow inside and a wooden peel leaning on it

Row 2 (3 objects):
 4. a tall wooden bread rack full of baguettes, croissants and round loaves
 5. a small glass-door fridge with milk bottles and drinks inside
 6. a three-tier pastel dessert stand with macarons, donuts and cupcakes on a little table

Row 3 (4 objects):
 7. a round white café table with a pink tablecloth and two cute chairs, a cupcake on top
 8. a small potted plant in a pink pot (small)
 9. a cute hanging wall sign shaped like a cupcake, pastel pink, no letters (flat, wide)
10. a small standing chalkboard menu with cake drawings, no letters (small)
```

---

## 3) (ไม่บังคับ) ไอคอนขนม → `bakery_icons.jpg`

ตอนนี้ขนมในร้านใช้อีโมจิ 🍞🥐🍩🧁🍰🥥🫐🎂 ถ้าอยากได้ไอคอนพิกเซลให้เข้าชุดกับเกม:

```
Cute pixel art game item icon sheet, clean dark outlines, soft shading, bright colours, matching a cozy pixel
life-sim game. Flat solid magenta #FF00FF background. 8 separate icons in 2 rows of 4, same size, evenly
spaced with lots of magenta space, no shadows, no text, no watermark.
Row 1: a loaf of white bread · a butter croissant · a chocolate-glazed donut with sprinkles · a strawberry cupcake
Row 2: a slice of chocolate cake · a slice of white coconut cake with coconut flakes · a slice of blueberry cheesecake · a whole birthday cake with candles
```
