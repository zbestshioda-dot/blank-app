"""Game engine for "ชีวิตนี้เลือกได้" — a multiplayer career life-sim.

All state lives in a single World object shared by every browser session
(Streamlit keeps it alive with st.cache_resource). Every mutation goes
through World methods that take the lock, so concurrent players are safe.
Time-based things (energy regen, game days, crop growth) are applied
lazily from wall-clock time whenever the world is touched.
"""

from __future__ import annotations

import json
import math
import os
import random
import secrets
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field

# --------------------------------------------------------------------------
# Tuning
# --------------------------------------------------------------------------
DAY_SECONDS = 120          # 1 game day = 2 real minutes
ENERGY_REGEN_SECONDS = 5   # +1 energy every 5 seconds
START_MONEY = 3000
LIVING_COST = 150          # food & bills per day
RENT = 250                 # waived if you own a house
SAVE_PATH = os.environ.get("LIFE_GAME_SAVE", "data/world.json")
ONLINE_WINDOW = 90         # seconds since last action/refresh to count as online

CAREERS = {
    "office": {"name": "พนักงานออฟฟิศ", "icon": "👔", "edu": 0,
               "desc": "รายได้มั่นคง ทำงานสะสมประสบการณ์เพื่อเลื่อนตำแหน่ง เงินเดือนขึ้นตามระดับและวุฒิการศึกษา"},
    "merchant": {"name": "พ่อค้าแม่ค้า", "icon": "🛒", "edu": 0,
                 "desc": "ซื้อสินค้าราคาส่งแล้วขายในตลาดกลาง ราคาขึ้นลงทุกวัน และผู้เล่นที่ขายพร้อมกันจะกดราคาให้ตก"},
    "farmer": {"name": "เกษตรกร", "icon": "🌾", "edu": 0,
               "desc": "ปลูกพืช รอให้โต แล้วเก็บเกี่ยวไปขาย ลงทุนน้อย แต่ต้องรอเวลาและเสี่ยงกับดินฟ้าอากาศ"},
    "fisher": {"name": "ชาวประมง", "icon": "🎣", "edu": 0,
               "desc": "ออกเรือหาปลาแบบเสี่ยงดวง ส่วนใหญ่ได้ปลาเล็ก แต่บางครั้งได้ฉลามหรือหีบสมบัติ"},
    "streamer": {"name": "สตรีมเมอร์", "icon": "🎥", "edu": 0,
                 "desc": "ทำคอนเทนต์เพื่อเพิ่มผู้ติดตาม มีรายได้แฝงทุกวันตามยอดผู้ติดตาม และรับโดเนทจากผู้เล่นอื่นได้"},
    "programmer": {"name": "โปรแกรมเมอร์ฟรีแลนซ์", "icon": "💻", "edu": 1,
                   "desc": "รับงานแก้โจทย์ ตอบถูกได้เงินก้อนใหญ่ ตอบผิดไม่ได้อะไรเลย ต้องใช้ฝีมือ (วุฒิ 1 ขึ้นไป)"},
    "doctor": {"name": "แพทย์", "icon": "🩺", "edu": 3,
               "desc": "เข้าเวรได้ค่าตอบแทนสูง และรักษาผู้เล่นอื่นเพื่อรับค่ารักษาได้ (ต้องมีวุฒิ 3 ขึ้นไป)"},
}

OFFICE_TITLES = ["พนักงานฝึกหัด", "พนักงาน", "พนักงานอาวุโส", "หัวหน้าทีม",
                 "ผู้จัดการ", "ผู้อำนวยการ", "CEO"]

EDU_NAMES = ["ไม่มีวุฒิ", "ม.6", "ปริญญาตรี", "ปริญญาโท", "ปริญญาเอก", "ศาสตราจารย์"]
EDU_COST = [2000, 5000, 9000, 15000, 25000]

# Items traded on the shared market. kind decides who can obtain them.
MARKET_ITEMS = {
    "snack":   {"name": "ขนม", "icon": "🍬", "base": 40, "kind": "goods"},
    "clothes": {"name": "เสื้อผ้า", "icon": "👕", "base": 180, "kind": "goods"},
    "phone":   {"name": "มือถือ", "icon": "📱", "base": 1200, "kind": "goods"},
    "rice":    {"name": "ข้าว", "icon": "🌾", "base": 45, "kind": "crop"},
    "corn":    {"name": "ข้าวโพด", "icon": "🌽", "base": 90, "kind": "crop"},
    "durian":  {"name": "ทุเรียน", "icon": "🍈", "base": 420, "kind": "crop"},
}

CROPS = {  # seed cost, grow seconds, yield units
    "rice":   {"seed": 60,  "grow": 60,  "yield": 5},
    "corn":   {"seed": 150, "grow": 150, "yield": 5},
    "durian": {"seed": 600, "grow": 360, "yield": 4},
}

STOCKS = {
    "TECH": {"name": "ไทยเทค", "base": 120, "vol": 0.08},
    "FOOD": {"name": "อร่อยฟู้ดส์", "base": 60, "vol": 0.03},
    "ENRG": {"name": "พลังไทย", "base": 90, "vol": 0.05},
    "BANK": {"name": "แบงก์สยาม", "base": 150, "vol": 0.02},
}

ASSETS = {
    "house":    {"name": "บ้าน", "icon": "🏠", "price": 60000,
                 "desc": "ไม่ต้องจ่ายค่าเช่า และนอนพักฟื้นพลังงานได้มากขึ้น"},
    "car":      {"name": "รถยนต์", "icon": "🚗", "price": 25000,
                 "desc": "ทุกงานใช้พลังงานน้อยลง 20%"},
    "pc":       {"name": "คอมสเปคเทพ", "icon": "🖥️", "price": 15000,
                 "desc": "สตรีมเมอร์และโปรแกรมเมอร์ได้เงินเพิ่ม 30%"},
    "boat":     {"name": "เรือประมงใหญ่", "icon": "🚤", "price": 18000,
                 "desc": "ชาวประมงมีโอกาสได้ปลาใหญ่มากขึ้น"},
    "tractor":  {"name": "รถไถ", "icon": "🚜", "price": 20000,
                 "desc": "เกษตรกรได้แปลงเพิ่ม 2 แปลง และพืชโตเร็วขึ้น 30%"},
    "shop":     {"name": "หน้าร้าน", "icon": "🏪", "price": 22000,
                 "desc": "พ่อค้าขายได้ครั้งละมากขึ้นและได้ราคาดีขึ้น 10%"},
    "clinic":   {"name": "คลินิกส่วนตัว", "icon": "🏥", "price": 40000,
                 "desc": "แพทย์ได้ค่าเวรเพิ่ม 40%"},
}

FISH_TABLE = [  # name, icon, value, weight (normal), weight (with boat)
    ("ขยะทะเล", "🥫", 0, 22, 10),
    ("ปลาเล็ก", "🐟", 60, 40, 32),
    ("ปลานิล", "🐠", 160, 22, 28),
    ("ปลากะพง", "🐡", 420, 11, 18),
    ("ปลาทูน่า", "🐋", 1200, 4, 9),
    ("ฉลาม", "🦈", 3500, 0.8, 2.5),
    ("หีบสมบัติ", "💎", 12000, 0.2, 0.5),
]

EVENTS = [
    {"id": "normal", "text": "วันธรรมดา ไม่มีอะไรพิเศษ", "w": 6},
    {"id": "boom", "text": "📈 เศรษฐกิจบูม! เงินเดือนและงานประจำ +25%, หุ้นขาขึ้น", "w": 1},
    {"id": "recession", "text": "📉 เศรษฐกิจถดถอย งานประจำ -20%, หุ้นขาลง", "w": 1},
    {"id": "rain", "text": "🌧️ ฝนตกชุก พืชโตเร็วขึ้น 50% แต่ออกเรือยาก", "w": 1},
    {"id": "drought", "text": "☀️ ภัยแล้ง! พืชโตช้าลงครึ่งหนึ่ง ราคาพืชผลพุ่ง", "w": 1},
    {"id": "fish", "text": "🐟 ปลาชุกชุม! ชาวประมงได้ปลามากขึ้น", "w": 1},
    {"id": "festival", "text": "🎉 เทศกาลช้อปปิ้ง! ราคาสินค้าในตลาดสูงขึ้น ทุกคนสุขขึ้น", "w": 1},
    {"id": "viral", "text": "🔥 โซเชียลคึกคัก! คอนเทนต์มีโอกาสไวรัลมากขึ้น", "w": 1},
    {"id": "flu", "text": "🤧 ไข้หวัดระบาด! สุขภาพทุกคนลดลง หมอมีงานล้นมือ", "w": 1},
    {"id": "tech", "text": "💻 บริษัทเทคแห่จ้างงาน! โปรแกรมเมอร์ได้ค่าจ้าง +50%", "w": 1},
]


def now() -> float:
    return time.time()


def fmt_money(x: float) -> str:
    return f"฿{x:,.0f}"


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------
@dataclass
class Player:
    id: str
    name: str
    pin: str
    career: str = "office"
    avatar: str = "🙂"
    money: float = START_MONEY
    energy: float = 100
    health: float = 100
    happiness: float = 80
    edu: int = 0
    xp: dict = field(default_factory=dict)          # career -> xp
    followers: int = 0
    inventory: dict = field(default_factory=dict)   # item -> qty
    stocks: dict = field(default_factory=dict)      # ticker -> qty
    plots: list = field(default_factory=list)       # [{crop, ready_at}] or None
    assets: list = field(default_factory=list)
    earned: dict = field(default_factory=dict)      # career -> money earned
    cooldowns: dict = field(default_factory=dict)   # action -> ready_at
    last_regen: float = field(default_factory=now)
    last_seen: float = field(default_factory=now)
    joined_day: int = 1

    def has(self, asset: str) -> bool:
        return asset in self.assets

    def level(self, career: str | None = None) -> int:
        c = career or self.career
        return 1 + int(self.xp.get(c, 0)) // 6

    def max_plots(self) -> int:
        return 6 if self.has("tractor") else 4


@dataclass
class ActionResult:
    ok: bool
    msg: str
    icon: str = "✅"


class World:
    def __init__(self):
        self.lock = threading.RLock()
        self.players: dict[str, Player] = {}
        self.tokens: dict[str, str] = {}  # session token -> player id
        self.day = 1
        self.day_started = now()
        self.event = EVENTS[0]
        self.prices = {k: float(v["base"]) for k, v in MARKET_ITEMS.items()}
        self.price_hist = {k: [float(v["base"])] for k, v in MARKET_ITEMS.items()}
        self.stock_prices = {k: float(v["base"]) for k, v in STOCKS.items()}
        self.stock_hist = {k: [float(v["base"])] for k, v in STOCKS.items()}
        self.feed: deque = deque(maxlen=60)
        self.chat: deque = deque(maxlen=80)
        self._last_save = 0.0

    # ------------------------------------------------------------ persistence
    def to_dict(self) -> dict:
        return {
            "players": {k: asdict(p) for k, p in self.players.items()},
            "tokens": self.tokens,
            "day": self.day,
            "day_started": self.day_started,
            "event": self.event["id"],
            "prices": self.prices,
            "price_hist": self.price_hist,
            "stock_prices": self.stock_prices,
            "stock_hist": self.stock_hist,
            "feed": list(self.feed),
            "chat": list(self.chat),
        }

    @classmethod
    def load(cls, path: str = SAVE_PATH) -> "World":
        w = cls()
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            return w
        try:
            w.players = {k: Player(**v) for k, v in d.get("players", {}).items()}
            w.tokens = d.get("tokens", {})
            w.day = d.get("day", 1)
            w.day_started = d.get("day_started", now())
            w.event = next((e for e in EVENTS if e["id"] == d.get("event")), EVENTS[0])
            for k in MARKET_ITEMS:
                w.prices[k] = d.get("prices", {}).get(k, w.prices[k])
                w.price_hist[k] = d.get("price_hist", {}).get(k, w.price_hist[k])
            for k in STOCKS:
                w.stock_prices[k] = d.get("stock_prices", {}).get(k, w.stock_prices[k])
                w.stock_hist[k] = d.get("stock_hist", {}).get(k, w.stock_hist[k])
            w.feed.extend(d.get("feed", []))
            w.chat.extend(d.get("chat", []))
        except TypeError:
            return cls()
        return w

    def save(self, force: bool = False, path: str = SAVE_PATH):
        t = now()
        if not force and t - self._last_save < 10:
            return
        self._last_save = t
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.to_dict(), f, ensure_ascii=False)
            os.replace(tmp, path)
        except OSError:
            pass

    # ------------------------------------------------------------ helpers
    def log(self, text: str):
        self.feed.appendleft({"t": now(), "day": self.day, "text": text})

    def ev(self, eid: str) -> bool:
        return self.event["id"] == eid

    def seconds_to_next_day(self) -> float:
        return max(0.0, DAY_SECONDS - (now() - self.day_started))

    def online(self) -> list[Player]:
        t = now()
        return [p for p in self.players.values() if t - p.last_seen < ONLINE_WINDOW]

    def net_worth(self, p: Player) -> float:
        inv = sum(self.prices.get(k, 0) * q for k, q in p.inventory.items())
        stk = sum(self.stock_prices.get(k, 0) * q for k, q in p.stocks.items())
        ast = sum(ASSETS[a]["price"] * 0.8 for a in p.assets if a in ASSETS)
        return p.money + inv + stk + ast

    def leaderboard(self) -> list[tuple[Player, float]]:
        rows = [(p, self.net_worth(p)) for p in self.players.values()]
        return sorted(rows, key=lambda r: r[1], reverse=True)

    def multiplier(self, p: Player) -> float:
        """Income multiplier from wellbeing."""
        m = 1.0
        if p.health < 30:
            m *= 0.6
        if p.happiness < 20:
            m *= 0.7
        elif p.happiness > 80:
            m *= 1.1
        return m

    def energy_cost(self, p: Player, base: float) -> float:
        return round(base * (0.8 if p.has("car") else 1.0))

    def _earn(self, p: Player, amount: float, career: str | None = None) -> float:
        amount = round(amount)
        p.money += amount
        c = career or p.career
        p.earned[c] = p.earned.get(c, 0) + amount
        return amount

    def _spend_energy(self, p: Player, base: float) -> ActionResult | None:
        cost = self.energy_cost(p, base)
        if p.energy < cost:
            return ActionResult(False, f"พลังงานไม่พอ (ต้องใช้ {cost}) ลองกินข้าวหรือพักผ่อนก่อน", "😴")
        p.energy -= cost
        return None

    def _cooldown(self, p: Player, key: str, seconds: float) -> ActionResult | None:
        ready = p.cooldowns.get(key, 0)
        if now() < ready:
            return ActionResult(False, f"รออีก {math.ceil(ready - now())} วินาที", "⏳")
        p.cooldowns[key] = now() + seconds
        return None

    def _require_career(self, p: Player, career: str) -> ActionResult | None:
        if p.career != career:
            return ActionResult(False, f"ต้องเป็น{CAREERS[career]['name']}ก่อน", "🚫")
        return None

    # ------------------------------------------------------------ time
    def tick(self):
        """Apply elapsed real time: new days and energy regen."""
        with self.lock:
            t = now()
            days = 0
            while t - self.day_started >= DAY_SECONDS and days < 30:
                self.day_started += DAY_SECONDS
                self._new_day()
                days += 1
            if t - self.day_started >= DAY_SECONDS:  # server slept for ages
                self.day_started = t
            for p in self.players.values():
                gained = int((t - p.last_regen) // ENERGY_REGEN_SECONDS)
                if gained > 0:
                    p.energy = min(100, p.energy + gained)
                    p.last_regen += gained * ENERGY_REGEN_SECONDS
                if p.energy >= 100:
                    p.last_regen = t
            if days:
                self.save(force=True)

    def _new_day(self):
        self.day += 1
        evs = EVENTS
        self.event = random.choices(evs, weights=[e["w"] for e in evs])[0]
        self.log(f"🌅 เริ่มวันที่ {self.day}: {self.event['text']}")

        # market prices: mean reversion + noise + events
        for k, it in MARKET_ITEMS.items():
            base = it["base"]
            price = self.prices[k]
            price += (base - price) * 0.25
            price *= 1 + random.gauss(0, 0.12)
            if self.ev("festival") and it["kind"] == "goods":
                price *= 1.25
            if self.ev("drought") and it["kind"] == "crop":
                price *= 1.4
            if self.ev("rain") and it["kind"] == "crop":
                price *= 0.9
            price = max(base * 0.35, min(base * 2.5, price))
            self.prices[k] = round(price, 1)
            self.price_hist[k] = (self.price_hist[k] + [self.prices[k]])[-40:]

        # stocks: random walk with drift from events
        drift = 0.03 if self.ev("boom") else -0.035 if self.ev("recession") else 0.004
        for k, s in STOCKS.items():
            d = drift + random.gauss(0, s["vol"])
            if k == "TECH" and self.ev("tech"):
                d += 0.08
            if k == "FOOD" and self.ev("drought"):
                d -= 0.05
            if k == "ENRG" and self.ev("rain"):
                d += 0.03
            self.stock_prices[k] = round(max(3.0, self.stock_prices[k] * (1 + d)), 2)
            self.stock_hist[k] = (self.stock_hist[k] + [self.stock_prices[k]])[-40:]

        # players' daily life
        for p in self.players.values():
            bills = LIVING_COST + (0 if p.has("house") else RENT)
            p.money -= bills
            p.health = max(0, p.health - (12 if self.ev("flu") else 3))
            p.happiness = max(0, min(100, p.happiness - 4 + (10 if self.ev("festival") else 0)))
            if p.money < 0:
                p.happiness = max(0, p.happiness - 8)
            if p.has("house"):
                p.happiness = min(100, p.happiness + 2)
            # passive income for streamers (any career, but fans fade when not streaming)
            if p.followers:
                passive = p.followers * 0.25
                if p.career != "streamer":
                    p.followers = int(p.followers * 0.95)
                    passive *= 0.5
                self._earn(p, passive, "streamer")
            # dividends
            for tk, q in p.stocks.items():
                if q and tk in ("BANK", "FOOD"):
                    self._earn(p, self.stock_prices[tk] * q * 0.004, "investor")
            if p.health <= 0:
                bill = 3000
                p.money -= bill
                p.health = 50
                p.energy = 20
                self.log(f"🚑 {p.name} ล้มป่วยหนัก ถูกหามส่งโรงพยาบาล เสียค่ารักษา {fmt_money(bill)}")
            # weather on crops
            if self.ev("drought"):
                for plot in p.plots:
                    if plot and plot["ready_at"] > now():
                        plot["ready_at"] += 60

    # ------------------------------------------------------------ accounts
    def join(self, name: str, pin: str, avatar: str, career: str) -> tuple[ActionResult, str | None]:
        name = name.strip()[:20]
        if not name:
            return ActionResult(False, "กรุณาใส่ชื่อ", "⚠️"), None
        if not (pin.isdigit() and len(pin) == 4):
            return ActionResult(False, "PIN ต้องเป็นตัวเลข 4 หลัก", "⚠️"), None
        with self.lock:
            existing = next((p for p in self.players.values() if p.name.lower() == name.lower()), None)
            if existing:
                if existing.pin != pin:
                    return ActionResult(False, "ชื่อนี้มีผู้ใช้แล้ว หรือ PIN ไม่ถูกต้อง", "🔒"), None
                p = existing
                msg = f"ยินดีต้อนรับกลับ {p.name}!"
            else:
                if career not in CAREERS or CAREERS[career]["edu"] > 0:
                    career = "office"
                pid = secrets.token_hex(4)
                p = Player(id=pid, name=name, pin=pin, avatar=avatar, career=career,
                           plots=[None, None], joined_day=self.day)
                self.players[pid] = p
                self.log(f"👋 {avatar} {name} เข้าสู่เมืองในฐานะ{CAREERS[career]['name']}")
                msg = f"ยินดีต้อนรับสู่เมือง {name}!"
            token = secrets.token_urlsafe(12)
            self.tokens[token] = p.id
            p.last_seen = now()
            self.save(force=True)
            return ActionResult(True, msg, "🎉"), token

    def player_by_token(self, token: str | None) -> Player | None:
        if not token:
            return None
        with self.lock:
            pid = self.tokens.get(token)
            p = self.players.get(pid) if pid else None
            if p:
                p.last_seen = now()
            return p

    def logout(self, token: str):
        with self.lock:
            self.tokens.pop(token, None)

    def change_career(self, p: Player, career: str) -> ActionResult:
        with self.lock:
            if career not in CAREERS:
                return ActionResult(False, "ไม่มีอาชีพนี้", "⚠️")
            c = CAREERS[career]
            if p.edu < c["edu"]:
                return ActionResult(False, f"ต้องมีวุฒิ {EDU_NAMES[c['edu']]} ขึ้นไป", "🎓")
            if p.career == career:
                return ActionResult(False, "คุณทำอาชีพนี้อยู่แล้ว", "ℹ️")
            p.career = career
            if career == "farmer" and not p.plots:
                p.plots = [None, None]
            p.happiness = max(0, p.happiness - 5)
            self.log(f"🔄 {p.avatar} {p.name} เปลี่ยนอาชีพเป็น{c['icon']} {c['name']}")
            return ActionResult(True, f"เปลี่ยนอาชีพเป็น {c['name']} แล้ว", c["icon"])

    # ------------------------------------------------------------ careers
    def office_work(self, p: Player) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "office"):
                return r
            if r := self._spend_energy(p, 20):
                return r
            lvl = min(p.level("office"), len(OFFICE_TITLES))
            pay = 450 + 180 * (lvl - 1) + 120 * p.edu
            if self.ev("boom"):
                pay *= 1.25
            if self.ev("recession"):
                pay *= 0.8
            pay = self._earn(p, pay * self.multiplier(p))
            p.happiness = max(0, p.happiness - 2)
            old = p.level("office")
            p.xp["office"] = p.xp.get("office", 0) + 1
            msg = f"ทำงานเสร็จ ได้เงินเดือน {fmt_money(pay)}"
            if p.level("office") > old and p.level("office") <= len(OFFICE_TITLES):
                title = OFFICE_TITLES[p.level("office") - 1]
                msg += f" — 🎊 เลื่อนตำแหน่งเป็น {title}!"
                self.log(f"🎊 {p.name} ได้เลื่อนตำแหน่งเป็น{title}")
            return ActionResult(True, msg, "👔")

    def office_overtime(self, p: Player) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "office"):
                return r
            if r := self._spend_energy(p, 35):
                return r
            lvl = min(p.level("office"), len(OFFICE_TITLES))
            pay = (450 + 180 * (lvl - 1) + 120 * p.edu) * 1.8 * self.multiplier(p)
            pay = self._earn(p, pay)
            p.happiness = max(0, p.happiness - 8)
            p.health = max(0, p.health - 4)
            p.xp["office"] = p.xp.get("office", 0) + 1
            return ActionResult(True, f"ทำโอทีจนดึก ได้ {fmt_money(pay)} แต่เหนื่อยมาก", "🌙")

    def merchant_buy(self, p: Player, item: str, qty: int) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "merchant"):
                return r
            if item not in MARKET_ITEMS or MARKET_ITEMS[item]["kind"] != "goods" or qty <= 0:
                return ActionResult(False, "สินค้าไม่ถูกต้อง", "⚠️")
            unit = self.wholesale_price(item)
            cost = unit * qty
            if p.money < cost:
                return ActionResult(False, f"เงินไม่พอ ต้องใช้ {fmt_money(cost)}", "💸")
            if r := self._spend_energy(p, 5):
                return r
            p.money -= cost
            p.inventory[item] = p.inventory.get(item, 0) + qty
            return ActionResult(True, f"ซื้อ{MARKET_ITEMS[item]['name']} {qty} ชิ้น ราคาส่ง {fmt_money(cost)}", "📦")

    def wholesale_price(self, item: str) -> float:
        # wholesale follows the base price, not the current retail price,
        # so merchants profit by selling when retail is high.
        return round(MARKET_ITEMS[item]["base"] * 0.85, 1)

    def merchant_sell_cap(self, p: Player) -> int:
        return 8 + 2 * p.level("merchant") + (8 if p.has("shop") else 0)

    def sell_item(self, p: Player, item: str, qty: int) -> ActionResult:
        """Anyone can sell inventory to the market. Merchants sell goods with a bonus."""
        with self.lock:
            have = p.inventory.get(item, 0)
            if item not in MARKET_ITEMS or qty <= 0:
                return ActionResult(False, "สินค้าไม่ถูกต้อง", "⚠️")
            if have < qty:
                return ActionResult(False, f"มีของไม่พอ (มี {have})", "⚠️")
            kind = MARKET_ITEMS[item]["kind"]
            bonus = 1.0
            if kind == "goods":
                if p.career != "merchant":
                    return ActionResult(False, "สินค้าค้าปลีกต้องขายโดยพ่อค้าแม่ค้า", "🚫")
                cap = self.merchant_sell_cap(p)
                if qty > cap:
                    return ActionResult(False, f"ขายได้ครั้งละไม่เกิน {cap} ชิ้น (อัปเลเวลหรือซื้อหน้าร้าน)", "⚠️")
                bonus = 1 + 0.03 * p.level("merchant") + (0.1 if p.has("shop") else 0)
                if r := self._spend_energy(p, 12):
                    return r
            else:
                if r := self._spend_energy(p, 3):
                    return r
            total = 0.0
            price = self.prices[item]
            for _ in range(qty):  # each unit sold pushes the shared price down
                total += price * bonus
                price *= 0.98
            self.prices[item] = round(max(MARKET_ITEMS[item]["base"] * 0.35, price), 1)
            p.inventory[item] = have - qty
            career = "merchant" if kind == "goods" else "farmer"
            earned = self._earn(p, total * (self.multiplier(p) if kind == "goods" else 1), career)
            if kind == "goods":
                p.xp["merchant"] = p.xp.get("merchant", 0) + 1
            if earned >= 5000:
                self.log(f"💰 {p.name} ขาย{MARKET_ITEMS[item]['name']}ล็อตใหญ่ได้ {fmt_money(earned)}")
            return ActionResult(True, f"ขาย{MARKET_ITEMS[item]['name']} {qty} หน่วย ได้ {fmt_money(earned)}", "💰")

    def grow_time(self, p: Player, crop: str) -> float:
        t = CROPS[crop]["grow"]
        if p.has("tractor"):
            t *= 0.7
        if self.ev("rain"):
            t *= 0.5
        if self.ev("drought"):
            t *= 1.5
        return t

    def farm_buy_plot(self, p: Player) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "farmer"):
                return r
            if len(p.plots) >= p.max_plots():
                return ActionResult(False, "แปลงเต็มแล้ว (ซื้อรถไถเพื่อขยายได้อีก)", "⚠️")
            cost = self.plot_price(p)
            if p.money < cost:
                return ActionResult(False, f"เงินไม่พอ ต้องใช้ {fmt_money(cost)}", "💸")
            p.money -= cost
            p.plots.append(None)
            return ActionResult(True, f"ซื้อที่ดินเพิ่ม 1 แปลง ({fmt_money(cost)})", "🟫")

    def plot_price(self, p: Player) -> int:
        return 3000 * (len(p.plots) - 1)

    def farm_plant(self, p: Player, idx: int, crop: str) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "farmer"):
                return r
            if not (0 <= idx < len(p.plots)) or crop not in CROPS:
                return ActionResult(False, "ข้อมูลไม่ถูกต้อง", "⚠️")
            if p.plots[idx]:
                return ActionResult(False, "แปลงนี้ปลูกอยู่แล้ว", "⚠️")
            seed = CROPS[crop]["seed"]
            if p.money < seed:
                return ActionResult(False, "เงินไม่พอซื้อเมล็ดพันธุ์", "💸")
            if r := self._spend_energy(p, 8):
                return r
            p.money -= seed
            p.plots[idx] = {"crop": crop, "ready_at": now() + self.grow_time(p, crop)}
            return ActionResult(True, f"ปลูก{MARKET_ITEMS[crop]['name']}แล้ว", "🌱")

    def farm_harvest(self, p: Player, idx: int) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "farmer"):
                return r
            if not (0 <= idx < len(p.plots)) or not p.plots[idx]:
                return ActionResult(False, "แปลงว่าง", "⚠️")
            plot = p.plots[idx]
            if plot["ready_at"] > now():
                return ActionResult(False, "พืชยังไม่โต", "🌱")
            if r := self._spend_energy(p, 10):
                return r
            crop = plot["crop"]
            amount = CROPS[crop]["yield"] + p.level("farmer") // 2 + random.randint(0, 2)
            p.inventory[crop] = p.inventory.get(crop, 0) + amount
            p.plots[idx] = None
            p.xp["farmer"] = p.xp.get("farmer", 0) + 1
            p.happiness = min(100, p.happiness + 2)
            return ActionResult(True, f"เก็บเกี่ยว{MARKET_ITEMS[crop]['name']}ได้ {amount} หน่วย", "🧺")

    def fish(self, p: Player) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "fisher"):
                return r
            if r := self._cooldown(p, "fish", 3):
                return r
            if r := self._spend_energy(p, 12):
                return r
            col = 4 if p.has("boat") else 3
            weights = [row[col] for row in FISH_TABLE]
            if self.ev("fish"):
                weights[0] *= 0.4
                weights = [w * (1.6 if i >= 3 else 1) for i, w in enumerate(weights)]
            if self.ev("rain"):
                weights[0] *= 2
            weights[0] = max(0.5, weights[0] - p.level("fisher"))
            name, icon, value, *_ = random.choices(FISH_TABLE, weights=weights)[0]
            p.xp["fisher"] = p.xp.get("fisher", 0) + 1
            if value == 0:
                return ActionResult(True, f"ได้{name}... ไม่มีราคา", icon)
            got = self._earn(p, value * self.multiplier(p))
            p.happiness = min(100, p.happiness + (5 if value >= 1000 else 1))
            if value >= 3000:
                self.log(f"{icon} {p.name} ตก{name}ได้! ขายได้ {fmt_money(got)}")
            return ActionResult(True, f"ได้{name} ขายได้ {fmt_money(got)}", icon)

    def stream(self, p: Player) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "streamer"):
                return r
            if r := self._spend_energy(p, 25):
                return r
            base = 150 + p.followers * 0.6
            views = int(base * random.lognormvariate(0, 0.6))
            viral_chance = 0.12 if self.ev("viral") else 0.04
            viral = random.random() < viral_chance
            if viral:
                views *= random.randint(8, 20)
            mult = self.multiplier(p) * (1.3 if p.has("pc") else 1)
            income = self._earn(p, views * 0.9 * mult)
            new_f = int(views * random.uniform(0.04, 0.08))
            p.followers += new_f
            p.xp["streamer"] = p.xp.get("streamer", 0) + 1
            p.happiness = min(100, p.happiness + 3)
            if viral:
                self.log(f"🔥 คลิปของ {p.name} ไวรัล! ยอดวิว {views:,} ผู้ติดตามเพิ่ม {new_f:,}")
                return ActionResult(True, f"ไวรัล!! {views:,} วิว ได้ {fmt_money(income)} ผู้ติดตาม +{new_f:,}", "🔥")
            return ActionResult(True, f"ไลฟ์จบ {views:,} วิว ได้ {fmt_money(income)} ผู้ติดตาม +{new_f:,}", "🎥")

    def new_code_task(self, p: Player) -> dict:
        lvl = p.level("programmer")
        a, b, c = random.randint(3, 9 + lvl * 3), random.randint(2, 9 + lvl * 2), random.randint(1, 50)
        kind = random.choice(["mul_add", "loop", "mod"])
        if kind == "mul_add":
            q = f"x = {a} * {b} + {c}\nprint(x)"
            ans = a * b + c
        elif kind == "loop":
            n = random.randint(3, 6 + lvl)
            q = f"s = 0\nfor i in range({n}):\n    s += i * {b}\nprint(s)"
            ans = sum(i * b for i in range(n))
        else:
            q = f"print(({a * b + c}) % {b})"
            ans = (a * b + c) % b
        return {"code": q, "answer": ans, "created": now()}

    def submit_code(self, p: Player, task: dict, answer: str) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "programmer"):
                return r
            if r := self._spend_energy(p, 18):
                return r
            try:
                correct = int(answer.strip()) == task["answer"]
            except ValueError:
                correct = False
            if not correct:
                p.happiness = max(0, p.happiness - 3)
                return ActionResult(False, f"โค้ดมีบั๊ก! คำตอบที่ถูกคือ {task['answer']} ลูกค้าไม่จ่ายเงิน", "🐛")
            fast = now() - task["created"] < 20
            pay = (700 + 250 * p.level("programmer") + 150 * p.edu)
            pay *= 1.5 if self.ev("tech") else 1
            pay *= 1.3 if p.has("pc") else 1
            pay *= 1.2 if fast else 1
            got = self._earn(p, pay * self.multiplier(p))
            p.xp["programmer"] = p.xp.get("programmer", 0) + 1
            return ActionResult(True, f"ส่งงานผ่าน! ได้ค่าจ้าง {fmt_money(got)}" + (" (โบนัสส่งไว)" if fast else ""), "💻")

    def doctor_shift(self, p: Player) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "doctor"):
                return r
            if r := self._spend_energy(p, 30):
                return r
            pay = (1600 + 300 * p.level("doctor") + 200 * (p.edu - 3))
            pay *= 1.4 if p.has("clinic") else 1
            pay *= 1.3 if self.ev("flu") else 1
            got = self._earn(p, pay * self.multiplier(p))
            p.health = max(0, p.health - 3)
            p.xp["doctor"] = p.xp.get("doctor", 0) + 1
            return ActionResult(True, f"เข้าเวรเสร็จ ได้ค่าตอบแทน {fmt_money(got)}", "🩺")

    def doctor_heal(self, p: Player, target_id: str, fee: int) -> ActionResult:
        with self.lock:
            if r := self._require_career(p, "doctor"):
                return r
            t = self.players.get(target_id)
            if not t or t.id == p.id:
                return ActionResult(False, "เลือกผู้ป่วยไม่ถูกต้อง", "⚠️")
            fee = max(0, min(int(fee), 2000))
            if t.health >= 95:
                return ActionResult(False, f"{t.name} สุขภาพดีอยู่แล้ว", "ℹ️")
            if t.money < fee:
                return ActionResult(False, f"{t.name} มีเงินไม่พอจ่ายค่ารักษา", "💸")
            if r := self._spend_energy(p, 15):
                return r
            heal = 35 + 5 * p.level("doctor")
            t.health = min(100, t.health + heal)
            t.money -= fee
            self._earn(p, fee)
            p.xp["doctor"] = p.xp.get("doctor", 0) + 2
            p.happiness = min(100, p.happiness + 4)
            self.log(f"🩺 หมอ{p.name} รักษา {t.name} สุขภาพ +{heal} (ค่ารักษา {fmt_money(fee)})")
            return ActionResult(True, f"รักษา {t.name} สำเร็จ ได้ค่ารักษา {fmt_money(fee)}", "💉")

    # ------------------------------------------------------------ life
    def life_action(self, p: Player, action: str) -> ActionResult:
        with self.lock:
            if action == "eat":
                if p.money < 60:
                    return ActionResult(False, "เงินไม่พอ", "💸")
                p.money -= 60
                p.energy = min(100, p.energy + 20)
                p.health = min(100, p.health + 1)
                return ActionResult(True, "กินข้าวมันไก่ อิ่มแล้ว! พลังงาน +20", "🍛")
            if action == "feast":
                if p.money < 600:
                    return ActionResult(False, "เงินไม่พอ", "💸")
                p.money -= 600
                p.energy = min(100, p.energy + 40)
                p.happiness = min(100, p.happiness + 8)
                p.health = min(100, p.health + 3)
                return ActionResult(True, "บุฟเฟต์ชาบู! พลังงาน +40 ความสุข +8", "🍲")
            if action == "rest":
                if r := self._cooldown(p, "rest", 45):
                    return r
                gain = 35 if p.has("house") else 20
                p.energy = min(100, p.energy + gain)
                p.happiness = min(100, p.happiness + 2)
                return ActionResult(True, f"งีบหลับ พลังงาน +{gain}", "😴")
            if action == "exercise":
                if r := self._spend_energy(p, 15):
                    return r
                p.health = min(100, p.health + 8)
                p.happiness = min(100, p.happiness + 2)
                return ActionResult(True, "ออกกำลังกาย สุขภาพ +8", "🏃")
            if action == "hospital":
                if p.money < 1200:
                    return ActionResult(False, "เงินไม่พอ (฿1,200)", "💸")
                p.money -= 1200
                p.health = min(100, p.health + 40)
                return ActionResult(True, "ไปโรงพยาบาล สุขภาพ +40 (ถ้าหาหมอในเกมอาจถูกกว่า)", "🏥")
            if action == "movie":
                if p.money < 300:
                    return ActionResult(False, "เงินไม่พอ", "💸")
                p.money -= 300
                p.happiness = min(100, p.happiness + 10)
                return ActionResult(True, "ดูหนังสนุกมาก ความสุข +10", "🎬")
            if action == "travel":
                if p.money < 4000:
                    return ActionResult(False, "เงินไม่พอ (฿4,000)", "💸")
                if r := self._cooldown(p, "travel", 120):
                    return r
                p.money -= 4000
                p.happiness = min(100, p.happiness + 35)
                p.health = min(100, p.health + 5)
                self.log(f"✈️ {p.name} ไปเที่ยวทะเลมา")
                return ActionResult(True, "ไปเที่ยวทะเล! ความสุข +35", "🏖️")
            if action == "study":
                if p.edu >= len(EDU_COST):
                    return ActionResult(False, "คุณจบสูงสุดแล้ว", "🎓")
                cost = EDU_COST[p.edu]
                if p.money < cost:
                    return ActionResult(False, f"ค่าเทอมไม่พอ ({fmt_money(cost)})", "💸")
                if r := self._spend_energy(p, 40):
                    return r
                p.money -= cost
                p.edu += 1
                p.happiness = max(0, p.happiness - 5)
                self.log(f"🎓 {p.name} สำเร็จการศึกษา {EDU_NAMES[p.edu]}")
                return ActionResult(True, f"เรียนจบ {EDU_NAMES[p.edu]}!", "🎓")
            return ActionResult(False, "ไม่รู้จักกิจกรรมนี้", "⚠️")

    def buy_asset(self, p: Player, asset: str) -> ActionResult:
        with self.lock:
            if asset not in ASSETS:
                return ActionResult(False, "ไม่มีสินค้านี้", "⚠️")
            if p.has(asset):
                return ActionResult(False, "คุณมีอยู่แล้ว", "ℹ️")
            a = ASSETS[asset]
            if p.money < a["price"]:
                return ActionResult(False, f"เงินไม่พอ ต้องใช้ {fmt_money(a['price'])}", "💸")
            p.money -= a["price"]
            p.assets.append(asset)
            p.happiness = min(100, p.happiness + 15)
            if asset == "tractor":
                pass
            self.log(f"{a['icon']} {p.name} ซื้อ{a['name']}!")
            return ActionResult(True, f"ซื้อ{a['name']}แล้ว!", a["icon"])

    # ------------------------------------------------------------ stocks
    def trade_stock(self, p: Player, ticker: str, qty: int, buy: bool) -> ActionResult:
        with self.lock:
            if ticker not in STOCKS or qty <= 0:
                return ActionResult(False, "คำสั่งไม่ถูกต้อง", "⚠️")
            price = self.stock_prices[ticker]
            fee = 0.0025
            if buy:
                cost = price * qty * (1 + fee)
                if p.money < cost:
                    return ActionResult(False, f"เงินไม่พอ ต้องใช้ {fmt_money(cost)}", "💸")
                p.money -= cost
                p.stocks[ticker] = p.stocks.get(ticker, 0) + qty
                self.stock_prices[ticker] = round(price * (1 + 0.0004 * qty), 2)
                return ActionResult(True, f"ซื้อ {ticker} {qty} หุ้น ราคา {fmt_money(cost)}", "📈")
            have = p.stocks.get(ticker, 0)
            if have < qty:
                return ActionResult(False, f"มีหุ้นไม่พอ (มี {have})", "⚠️")
            got = price * qty * (1 - fee)
            p.money += got
            p.stocks[ticker] = have - qty
            self.stock_prices[ticker] = round(max(3.0, price * (1 - 0.0004 * qty)), 2)
            return ActionResult(True, f"ขาย {ticker} {qty} หุ้น ได้ {fmt_money(got)}", "📉")

    # ------------------------------------------------------------ social
    def send_chat(self, p: Player, text: str) -> ActionResult:
        text = text.strip()[:200]
        if not text:
            return ActionResult(False, "พิมพ์ข้อความก่อน", "⚠️")
        with self.lock:
            if r := self._cooldown(p, "chat", 1.5):
                return r
            self.chat.appendleft({"t": now(), "name": p.name, "avatar": p.avatar,
                                  "career": p.career, "text": text})
            return ActionResult(True, "ส่งแล้ว", "💬")

    def transfer(self, p: Player, target_id: str, amount: int, kind: str = "transfer") -> ActionResult:
        with self.lock:
            t = self.players.get(target_id)
            amount = int(amount)
            if not t or t.id == p.id or amount <= 0:
                return ActionResult(False, "ข้อมูลไม่ถูกต้อง", "⚠️")
            if p.money < amount:
                return ActionResult(False, "เงินไม่พอ", "💸")
            p.money -= amount
            if kind == "donate":
                if t.career != "streamer":
                    p.money += amount
                    return ActionResult(False, f"{t.name} ไม่ได้เป็นสตรีมเมอร์", "⚠️")
                self._earn(t, amount, "streamer")
                t.followers += max(1, amount // 50)
                t.happiness = min(100, t.happiness + 3)
                p.happiness = min(100, p.happiness + 2)
                self.log(f"💝 {p.name} โดเนท {fmt_money(amount)} ให้สตรีมเมอร์ {t.name}")
                return ActionResult(True, f"โดเนทให้ {t.name} แล้ว", "💝")
            t.money += amount
            self.log(f"💸 {p.name} โอนเงิน {fmt_money(amount)} ให้ {t.name}")
            return ActionResult(True, f"โอนเงินให้ {t.name} แล้ว", "💸")

    def gift_item(self, p: Player, target_id: str, item: str, qty: int) -> ActionResult:
        with self.lock:
            t = self.players.get(target_id)
            if not t or t.id == p.id or qty <= 0 or p.inventory.get(item, 0) < qty:
                return ActionResult(False, "ข้อมูลไม่ถูกต้องหรือของไม่พอ", "⚠️")
            p.inventory[item] -= qty
            t.inventory[item] = t.inventory.get(item, 0) + qty
            self.log(f"🎁 {p.name} ส่ง{MARKET_ITEMS[item]['name']} {qty} หน่วยให้ {t.name}")
            return ActionResult(True, f"ส่งของให้ {t.name} แล้ว", "🎁")
