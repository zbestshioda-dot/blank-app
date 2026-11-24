# 🧍 รูปตัวละครผู้เล่นใหม่ (ชุด / ลุคใหม่)

ตัวละครผู้เล่น 1 ลุค = รูป 1 ไฟล์ แบ่งเป็นตาราง 3 x 3
- แถว 1 = ด้านหน้า เดิน 3 ท่า
- แถว 2 = ด้านหลัง เดิน 3 ท่า
- แถว 3 = ด้านข้าง เดิน 3 ท่า (หันไปทางเดียวกันทั้งแถว เกมกลับด้านให้เอง)

อัปโหลดไว้ที่ `tools/sheets/fashion_<ชื่อ>.jpg` (ผู้ชาย) และ `tools/sheets/fashion_f<ชื่อ>.jpg` (ผู้หญิง)
แล้วบอก Claude ว่า **"ใส่ชุดใหม่ <ชื่อ>"**

**กฎสำคัญ:** พื้นหลังสีเบจล้วน ไม่มีลาย ไม่มีเงา · ตัวละคร 9 ตัวต้องเป็นคนเดียวกัน ชุดเดียวกัน ขนาดเท่ากัน
· ไม่แตะกัน · ไม่มีตัวหนังสือ · ขนาดประมาณ 2400 x 1792

## Prompt (แก้แค่บรรทัด CHARACTER)

```
Pixel art character sprite sheet for a cozy top-down Thai life-sim game, in the same style as before:
cute chibi proportions (big head, small body, about 2.5 heads tall), clean dark outlines, soft warm shading,
crisp pixels, no blur, no anti-aliasing.
Exactly 9 sprites in a perfect grid of 3 columns x 3 rows, all the same size, evenly spaced,
on a flat plain beige background (#E8D5C4), no shadows on the ground, no text, no watermark.
Row 1: the character facing the viewer (front view), 3 walking frames (left foot forward, standing, right foot forward).
Row 2: the same character seen from behind (back view), 3 walking frames.
Row 3: the same character in side view, all three facing LEFT, 3 walking frames.
The character must look IDENTICAL in all 9 sprites (same face, hair, clothes, colours, size).

CHARACTER: a young Thai man, about 20, messy black hair, a white hoodie with a small yellow star,
light-blue jeans, white sneakers, a small brown crossbody bag.
```

## ตัวอย่างบรรทัด CHARACTER

- **หญิง (คู่กัน):** `a young Thai woman, about 20, long dark brown hair in a low ponytail, a white hoodie with a small yellow star, light-blue jeans, white sneakers, a small brown crossbody bag.`
- **นักเรียน:** `a Thai high-school boy, short neat black hair, white school shirt, navy shorts, white socks, black shoes, a blue backpack.`
- **สาวคาเฟ่:** `a Thai woman, about 22, wavy chestnut bob hair with a pink clip, cream knitted cardigan, pastel pink pleated skirt, brown loafers.`
