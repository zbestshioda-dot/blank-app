# 🥚 รูปที่ต้องใช้: มือใหม่ + เทศกาลปีใหม่/ตรุษจีน

ตอนนี้ระบบมือใหม่และเทศกาลใช้อีโมจิแทนไปก่อน (🥚 🎁 🌙 🪙 🧧 🎆) เล่นได้เลย
ถ้าอยากได้รูปสวยตรงสไตล์เกม ให้สร้างรูป 3 รูปตาม prompt ด้านล่าง (ใช้ ChatGPT / Gemini ก็ได้)
แล้วอัปโหลดไปไว้ที่ `tools/sheets/` ตั้งชื่อไฟล์ให้ตรงตามนี้:

| ไฟล์ | มีอะไร | ใช้ตรงไหน |
|---|---|---|
| `tools/sheets/nb_icons.jpg` | ไอคอน 8 ชิ้น เรียง 2 แถว (4-4) | การ์ด "พรุ่งนี้รอคุณอยู่", ช่องไข่ในกระเป๋า, เหรียญลอย, อั่งเปา, ปลาตัวแรก |
| `tools/sheets/ev_newyear.jpg` | ป้ายแบนเนอร์ปีใหม่ แนวนอนกว้าง | แถบ/การ์ดเทศกาลปีใหม่ |
| `tools/sheets/ev_cny.jpg` | ป้ายแบนเนอร์ตรุษจีน แนวนอนกว้าง | แถบ/การ์ดเทศกาลตรุษจีน |

จากนั้นบอก Claude ว่า **"ใส่รูปมือใหม่"** แล้ว Claude จะตัดรูป ใส่เข้าเกม และอัปเดตเวอร์ชันรูปให้เอง

**กฎสำคัญ (ไม่งั้นตัดรูปไม่ได้):**
- รูปไอคอน (`nb_icons.jpg`) พื้นหลังต้องเป็น **สีชมพูม่วงล้วน #FF00FF** ห้ามมีลาย ห้ามไล่สี
- ของแต่ละชิ้นต้อง **แยกห่างกัน** ไม่แตะกัน และไม่มีเงาตกบนพื้นหลัง
- จำนวนชิ้นในแต่ละแถวต้องตรงเป๊ะ และเรียงซ้ายไปขวาตามลำดับในรายการ
- ทุกรูป: ไม่มีตัวหนังสือ ไม่มีลายน้ำ

---

## 1) ไอคอนมือใหม่ → `nb_icons.jpg`

```
Cute pixel art game icon sheet, clean dark outlines, soft shading, bright cozy colours, matching a cozy
Thai pixel life-sim game. Flat solid magenta #FF00FF background. 8 separate icons in 2 neat rows of 4,
every icon about the same size, clearly separated with lots of magenta space, no shadows on the
background, no text, no people, no watermark.
Row 1 (left to right):
1. a mystery pet egg, cream white with pastel pink and blue spots, sitting in a small straw nest
2. the same egg with a glowing golden crack and little sparkles (about to hatch)
3. a gift box wrapped in red paper with a big gold ribbon bow
4. a shiny gold coin seen at a slight angle, with a star stamped in the middle
Row 2 (left to right):
5. a yellow crescent moon with two small twinkling stars and a soft blue night glow
6. a Chinese New Year red envelope (ang pao) with a gold flower pattern, no letters
7. a colourful firework burst (pink, gold and blue sparks)
8. a bamboo fishing rod with a small silver fish hanging on the line, a few water drops
```

## 2) แบนเนอร์ปีใหม่ → `ev_newyear.jpg`

```
Cozy pixel art banner, very wide landscape (about 3 : 1), bright clean pixel style matching a cute Thai
life-sim town game. Night sky over a small Thai town square with a fountain in the middle, big colourful
fireworks bursting in the sky (gold, pink, blue), string lights and paper lanterns, a few cute chibi
townspeople cheering from far away (small, no faces in detail). Warm, happy, festive mood.
Leave the centre-left area of the sky a little calmer (space for a title added later in the game).
No text, no numbers, no letters, no watermark.
```

## 3) แบนเนอร์ตรุษจีน → `ev_cny.jpg`

```
Cozy pixel art banner, very wide landscape (about 3 : 1), bright clean pixel style matching a cute Thai
life-sim town game. A street in a small Thai town decorated for Chinese New Year: rows of red paper
lanterns, red and gold decorations, a small cheerful lion dance in the middle, gold coins and red
envelopes (ang pao) floating, plum blossom branches at the edges. Warm red and gold colours, happy mood.
Leave the centre-left area a little calmer (space for a title added later in the game).
No text, no Chinese characters, no letters, no watermark.
```

---

## 4) แบนเนอร์วาเลนไทน์ → `tools/sheets/ev_valentine.jpg` (เพิ่มทีหลัง)

ตอนนี้การ์ดวาเลนไทน์ใช้อีโมจิ 💘 แทนไปก่อน อัปโหลดรูปนี้แล้วบอก Claude ว่า "ใส่รูปวาเลนไทน์"

```
Cozy pixel art banner, very wide landscape (about 3 : 1), bright clean pixel style matching a cute Thai
life-sim town game. A small Thai town square at golden sunset decorated for Valentine's Day: pink and red
heart garlands, a flower stall full of red roses, heart-shaped balloons, a cute chibi couple sitting on a
bench by the fountain sharing a box of chocolates (small, simple faces), petals floating in the air.
Soft pink, red and warm gold colours, sweet happy mood. Leave the centre-left area a little calmer
(space for a title added later in the game). No text, no letters, no watermark.
```
