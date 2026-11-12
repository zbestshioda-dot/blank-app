"""ชีวิตนี้เลือกได้ — multiplayer career life-sim, playable in the browser.

Run:  streamlit run streamlit_app.py
Everyone connected to the same server shares one world.
"""

import time

import pandas as pd
import streamlit as st

from game import (ASSETS, CAREERS, CROPS, DAY_SECONDS, EDU_COST, EDU_NAMES,
                  MARKET_ITEMS, OFFICE_TITLES, STOCKS, World, fmt_money)

st.set_page_config(page_title="ชีวิตนี้เลือกได้", page_icon="🏙️", layout="wide")

st.markdown(
    """
    <style>
    .block-container {padding-top: 2.2rem; max-width: 1300px;}
    .event-box {padding: .6rem 1rem; border-radius: .6rem; background: rgba(255,196,0,.12);
                border: 1px solid rgba(255,196,0,.35); margin-bottom: .4rem;}
    .chat-line {padding: .15rem 0; border-bottom: 1px dashed rgba(128,128,128,.15);}
    .muted {opacity: .65; font-size: .85em;}
    div[data-testid="stMetricValue"] {font-size: 1.35rem;}
    </style>
    """,
    unsafe_allow_html=True,
)

AVATARS = ["🙂", "😎", "🤠", "🧑‍🎤", "👩‍🍳", "🧙", "🐱", "🐶", "🦊", "🐼", "🐸", "🤖"]


@st.cache_resource
def get_world() -> World:
    return World.load()


world = get_world()
world.tick()


def me():
    return world.player_by_token(st.query_params.get("t"))


def act(fn, *args, **kwargs):
    """on_click helper: run a world action and toast its result."""
    p = me()
    if not p:
        return
    resolved = [st.session_state.get(a[1:], None) if isinstance(a, str) and a.startswith("@") else a
                for a in args]
    res = fn(p, *resolved, **kwargs)
    st.toast(res.msg, icon=res.icon)
    world.save()


def bar(label: str, value: float, icon: str):
    st.caption(f"{icon} {label} {value:.0f}/100")
    st.progress(min(1.0, max(0.0, value / 100)))


def career_label(c: str) -> str:
    return f"{CAREERS[c]['icon']} {CAREERS[c]['name']}"


# =========================================================================
# Login / landing
# =========================================================================
def landing():
    st.title("🏙️ ชีวิตนี้เลือกได้")
    st.subheader("เกมใช้ชีวิตออนไลน์ เลือกอาชีพ หาเงิน แข่งกับเพื่อนแบบเรียลไทม์")
    left, right = st.columns([3, 2], gap="large")
    with left:
        st.markdown(
            "ทุกคนอยู่ในเมืองเดียวกัน — ราคาสินค้า หุ้น เหตุการณ์ประจำวัน แชท และอันดับความรวย "
            f"เป็นของจริงที่แชร์กัน ⏱️ 1 วันในเกม = {DAY_SECONDS // 60} นาทีจริง "
            "ทุกวันต้องจ่ายค่ากินอยู่และค่าเช่า ดูแลสุขภาพและความสุขด้วย ไม่งั้นทำงานได้เงินน้อยลง!"
        )
        cols = st.columns(2)
        for i, (key, c) in enumerate(CAREERS.items()):
            with cols[i % 2].container(border=True):
                req = f" · ต้องการวุฒิ {EDU_NAMES[c['edu']]}" if c["edu"] else ""
                st.markdown(f"**{c['icon']} {c['name']}**{req}")
                st.caption(c["desc"])
    with right:
        with st.container(border=True):
            st.markdown("### 🚪 เข้าเมือง")
            st.caption("ผู้เล่นใหม่: ตั้งชื่อและ PIN · ผู้เล่นเดิม: ใส่ชื่อและ PIN เดิมเพื่อเล่นต่อ")
            with st.form("join"):
                name = st.text_input("ชื่อตัวละคร", max_chars=20)
                pin = st.text_input("PIN 4 หลัก", type="password", max_chars=4)
                avatar = st.selectbox("หน้าตา", AVATARS)
                starters = [k for k, c in CAREERS.items() if c["edu"] == 0]
                career = st.selectbox("อาชีพเริ่มต้น", starters, format_func=career_label)
                if st.form_submit_button("เริ่มชีวิตใหม่ / เข้าเล่นต่อ", type="primary", width="stretch"):
                    res, token = world.join(name, pin, avatar, career)
                    if token:
                        st.query_params["t"] = token
                        st.rerun()
                    st.error(res.msg)
        online = world.online()
        st.markdown(f"🟢 ออนไลน์ตอนนี้ **{len(online)}** คน · ประชากรทั้งหมด **{len(world.players)}** คน · วันที่ **{world.day}**")
        for i, (p, nw) in enumerate(world.leaderboard()[:5], 1):
            st.markdown(f"{i}. {p.avatar} **{p.name}** — {career_label(p.career)} · {fmt_money(nw)}")


# =========================================================================
# In-game panels
# =========================================================================
@st.fragment(run_every=2)
def header():
    world.tick()
    p = me()
    if not p:
        return
    secs = int(world.seconds_to_next_day())
    st.markdown(
        f"<div class='event-box'>📅 <b>วันที่ {world.day}</b> · ⏱️ วันใหม่ในอีก {secs // 60}:{secs % 60:02d} "
        f"· {world.event['text']}</div>",
        unsafe_allow_html=True,
    )
    c = st.columns([1.3, 1, 1, 1, 1, 1.2])
    c[0].markdown(f"### {p.avatar} {p.name}")
    c[0].caption(f"{career_label(p.career)} · Lv.{p.level()} · 🎓 {EDU_NAMES[p.edu]}")
    c[1].metric("💵 เงินสด", fmt_money(p.money))
    c[2].metric("🏦 ทรัพย์สินสุทธิ", fmt_money(world.net_worth(p)))
    with c[3]:
        bar("พลังงาน", p.energy, "⚡")
    with c[4]:
        bar("สุขภาพ", p.health, "❤️")
    with c[5]:
        bar("ความสุข", p.happiness, "😊")
    warn = []
    if p.money < 0:
        warn.append("💸 คุณติดหนี้! ความสุขจะลดลงทุกวัน")
    if p.health < 30:
        warn.append("🤒 สุขภาพแย่ รายได้ลดลง 40% — ไปหาหมอหรือออกกำลังกาย")
    if p.happiness < 20:
        warn.append("😞 เครียดมาก รายได้ลดลง 30% — ไปพักผ่อนหรือเที่ยว")
    if warn:
        st.warning(" · ".join(warn))


def panel_office(p):
    lvl = min(p.level("office"), len(OFFICE_TITLES))
    xp = p.xp.get("office", 0)
    st.markdown(f"**ตำแหน่ง:** {OFFICE_TITLES[lvl - 1]} · ประสบการณ์ {xp % 6}/6 ถึงเลื่อนขั้นถัดไป")
    pay = 450 + 180 * (lvl - 1) + 120 * p.edu
    st.caption(f"เงินเดือนต่อกะ ~{fmt_money(pay)} (เพิ่มตามตำแหน่งและวุฒิการศึกษา)")
    a, b = st.columns(2)
    a.button("💼 ทำงาน (⚡20)", on_click=act, args=(world.office_work,), width="stretch", type="primary")
    b.button("🌙 ทำโอที x1.8 (⚡35, เหนื่อย)", on_click=act, args=(world.office_overtime,), width="stretch")


def panel_merchant(p):
    cap = world.merchant_sell_cap(p)
    st.caption(f"ซื้อราคาส่งคงที่ ขายตามราคาตลาดกลางที่ขึ้นลงทุกวัน · ขายได้ครั้งละ {cap} ชิ้น · "
               "ยิ่งขายเยอะราคายิ่งตก (ผู้เล่นอื่นก็กระทบด้วย!)")
    goods = [k for k, v in MARKET_ITEMS.items() if v["kind"] == "goods"]
    for g in goods:
        it = MARKET_ITEMS[g]
        whole = world.wholesale_price(g)
        retail = world.prices[g]
        margin = (retail - whole) / whole * 100
        with st.container(border=True):
            c = st.columns([2, 1.3, 1.3, 1.6, 1.6])
            c[0].markdown(f"**{it['icon']} {it['name']}** · มีอยู่ {p.inventory.get(g, 0)}")
            c[0].caption(f"ส่ง {fmt_money(whole)} → ตลาด {fmt_money(retail)} ({margin:+.0f}%)")
            c[1].number_input("จำนวน", 1, 500, 5, key=f"mq_{g}", label_visibility="collapsed")
            c[2].button("ซื้อเข้าร้าน", key=f"mb_{g}", on_click=act,
                        args=(world.merchant_buy, g, f"@mq_{g}"), width="stretch")
            c[3].button(f"ขาย {min(cap, p.inventory.get(g, 0))} ชิ้น (⚡12)", key=f"ms_{g}", on_click=act,
                        args=(world.sell_item, g, min(cap, p.inventory.get(g, 0))),
                        width="stretch", disabled=p.inventory.get(g, 0) == 0, type="primary")


@st.fragment(run_every=2)
def panel_farmer():
    p = me()
    if not p or p.career != "farmer":
        return
    st.caption("ปลูก → รอ → เก็บเกี่ยว → ขายในตลาดกลาง ราคาพืชผลขึ้นลงตามฤดูกาลและการเทขายของผู้เล่น")
    st.markdown(" · ".join(
        f"{MARKET_ITEMS[k]['icon']} {MARKET_ITEMS[k]['name']}: เมล็ด {fmt_money(c['seed'])}, "
        f"{int(world.grow_time(p, k))} วิ, ~{c['yield']} หน่วย" for k, c in CROPS.items()))
    cols = st.columns(3)
    t = time.time()
    for i, plot in enumerate(p.plots):
        with cols[i % 3].container(border=True):
            st.markdown(f"**แปลงที่ {i + 1}**")
            if not plot:
                st.markdown("🟫 ว่าง")
                crop = st.selectbox("พืช", list(CROPS), key=f"crop_{i}", label_visibility="collapsed",
                                    format_func=lambda k: f"{MARKET_ITEMS[k]['icon']} {MARKET_ITEMS[k]['name']}")
                st.button("🌱 ปลูก (⚡8)", key=f"plant_{i}", on_click=act,
                          args=(world.farm_plant, i, crop), width="stretch")
            else:
                it = MARKET_ITEMS[plot["crop"]]
                left = plot["ready_at"] - t
                if left > 0:
                    total = world.grow_time(p, plot["crop"])
                    st.markdown(f"🌱 {it['name']} กำลังโต")
                    st.progress(max(0.0, min(1.0, 1 - left / max(total, 1))), text=f"อีก {int(left)} วิ")
                else:
                    st.markdown(f"{it['icon']} {it['name']} พร้อมเก็บ!")
                    st.button("🧺 เก็บเกี่ยว (⚡10)", key=f"harv_{i}", on_click=act,
                              args=(world.farm_harvest, i), width="stretch", type="primary")
    if len(p.plots) < p.max_plots():
        st.button(f"➕ ซื้อที่ดินเพิ่ม ({fmt_money(world.plot_price(p))})", on_click=act,
                  args=(world.farm_buy_plot,))
    sell_inventory(p, "crop")


def sell_inventory(p, kind):
    items = [k for k, v in MARKET_ITEMS.items() if v["kind"] == kind and p.inventory.get(k, 0) > 0]
    if not items:
        return
    st.markdown("**🧺 ผลผลิตในยุ้งฉาง**")
    cols = st.columns(len(items))
    for c, k in zip(cols, items):
        it, q = MARKET_ITEMS[k], p.inventory[k]
        c.button(f"ขาย {it['icon']} {it['name']} x{q} (~{fmt_money(world.prices[k] * q * 0.97)})",
                 key=f"sellc_{k}", on_click=act, args=(world.sell_item, k, q), width="stretch")


def panel_fisher(p):
    st.caption("ออกเรือเสี่ยงดวง! ได้ปลาแล้วขายทันที เลเวลสูงขึ้นเจอขยะน้อยลง · มีเรือใหญ่โอกาสได้ปลาใหญ่มากขึ้น")
    st.markdown("🥫 ขยะ ฿0 · 🐟 ปลาเล็ก ฿60 · 🐠 ปลานิล ฿160 · 🐡 กะพง ฿420 · 🐋 ทูน่า ฿1,200 · "
                "🦈 ฉลาม ฿3,500 · 💎 หีบสมบัติ ฿12,000")
    st.button("🎣 เหวี่ยงเบ็ด (⚡12)", on_click=act, args=(world.fish,), type="primary", width="stretch")


def panel_streamer(p):
    st.markdown(f"👥 ผู้ติดตาม **{p.followers:,}** คน · รายได้แฝงต่อวัน ~{fmt_money(p.followers * 0.25)}")
    st.caption("ยิ่งผู้ติดตามเยอะ ยอดวิวยิ่งสูง มีโอกาสไวรัล · ผู้เล่นคนอื่นโดเนทให้คุณได้จากแท็บเมือง")
    st.button("🎥 ไลฟ์สด / ทำคอนเทนต์ (⚡25)", on_click=act, args=(world.stream,),
              type="primary", width="stretch")


def _submit_code():
    p = me()
    task = st.session_state.get("code_task")
    if not p or not task:
        return
    res = world.submit_code(p, task, str(st.session_state.get("code_answer", "")))
    st.toast(res.msg, icon=res.icon)
    st.session_state["code_task"] = world.new_code_task(p)
    st.session_state["code_answer"] = ""


def panel_programmer(p):
    st.caption("ลูกค้าส่งโค้ดมาให้ตรวจ — บอกว่าโปรแกรมจะพิมพ์ค่าอะไรออกมา ถูกได้เงิน ผิดอดเงิน · ตอบภายใน 20 วิได้โบนัส")
    if "code_task" not in st.session_state:
        st.session_state["code_task"] = world.new_code_task(p)
    task = st.session_state["code_task"]
    st.code(task["code"], language="python")
    c = st.columns([2, 1, 1])
    c[0].text_input("ผลลัพธ์ที่พิมพ์ออกมา", key="code_answer", placeholder="ตอบเป็นตัวเลข")
    c[1].button("📤 ส่งงาน (⚡18)", on_click=_submit_code, type="primary", width="stretch")
    c[2].button("🔄 ขอโจทย์ใหม่", on_click=lambda: st.session_state.update(code_task=world.new_code_task(me())),
                width="stretch")


def panel_doctor(p):
    st.caption("เข้าเวรได้เงินดี หรือรักษาผู้เล่นคนอื่น (หักค่ารักษาจากเขาอัตโนมัติ — ตั้งราคาให้ถูกกว่าโรงพยาบาล ฿1,200 คนจะชอบ!)")
    st.button("🏥 เข้าเวรโรงพยาบาล (⚡30)", on_click=act, args=(world.doctor_shift,),
              type="primary", width="stretch")
    patients = sorted((x for x in world.players.values() if x.id != p.id and x.health < 95),
                      key=lambda x: x.health)
    if not patients:
        st.info("ตอนนี้ยังไม่มีผู้ป่วย ทุกคนแข็งแรงดี")
        return
    st.markdown("**ผู้ป่วยในเมือง**")
    st.number_input("ค่ารักษา (฿)", 0, 2000, 500, step=50, key="heal_fee")
    for x in patients[:8]:
        c = st.columns([3, 1])
        c[0].markdown(f"{x.avatar} {x.name} — ❤️ {x.health:.0f}/100 · เงิน {fmt_money(x.money)}")
        c[1].button("💉 รักษา", key=f"heal_{x.id}", on_click=act,
                    args=(world.doctor_heal, x.id, "@heal_fee"), width="stretch")


def tab_work(p):
    st.markdown(f"### {career_label(p.career)} · Lv.{p.level()}")
    st.caption(CAREERS[p.career]["desc"])
    {
        "office": panel_office, "merchant": panel_merchant, "fisher": panel_fisher,
        "streamer": panel_streamer, "programmer": panel_programmer, "doctor": panel_doctor,
    }.get(p.career, lambda _p: panel_farmer())(p)
    if p.career != "farmer":
        sell_inventory(p, "crop")

    with st.expander("🔄 เปลี่ยนอาชีพ / สถิติรายได้"):
        cols = st.columns(4)
        for i, (k, c) in enumerate(CAREERS.items()):
            locked = p.edu < c["edu"]
            label = f"{c['icon']} {c['name']}" + (f" 🔒{EDU_NAMES[c['edu']]}" if locked else "")
            cols[i % 4].button(label, key=f"cc_{k}", on_click=act, args=(world.change_career, k),
                               disabled=locked or k == p.career, width="stretch")
        if p.earned:
            names = {**{k: c["name"] for k, c in CAREERS.items()}, "investor": "ปันผลหุ้น"}
            df = pd.DataFrame([{"แหล่งรายได้": names.get(k, k), "รายได้สะสม": v} for k, v in p.earned.items()])
            st.bar_chart(df, x="แหล่งรายได้", y="รายได้สะสม", horizontal=True)


def tab_life(p):
    st.markdown(f"### 🏠 ชีวิตประจำวัน")
    st.caption(f"ทุกวันจ่ายค่ากินอยู่ {fmt_money(150)}" + ("" if p.has("house") else f" + ค่าเช่า {fmt_money(250)}")
               + " · สุขภาพ -3 และความสุข -4 ต่อวัน")
    acts = [
        ("eat", "🍛 ข้าวมันไก่ ฿60", "⚡+20"),
        ("feast", "🍲 บุฟเฟต์ ฿600", "⚡+40 😊+8"),
        ("rest", "😴 งีบหลับ ฟรี", "⚡+20 (คูลดาวน์ 45 วิ)"),
        ("exercise", "🏃 ออกกำลังกาย", "⚡-15 ❤️+8"),
        ("hospital", "🏥 โรงพยาบาล ฿1,200", "❤️+40"),
        ("movie", "🎬 ดูหนัง ฿300", "😊+10"),
        ("travel", "🏖️ เที่ยวทะเล ฿4,000", "😊+35"),
    ]
    cols = st.columns(4)
    for i, (k, label, hint) in enumerate(acts):
        with cols[i % 4]:
            st.button(label, key=f"life_{k}", on_click=act, args=(world.life_action, k),
                      width="stretch", help=hint)
            st.caption(hint)

    st.markdown("### 🎓 การศึกษา")
    if p.edu < len(EDU_COST):
        st.markdown(f"ปัจจุบัน: **{EDU_NAMES[p.edu]}** → เรียนต่อ **{EDU_NAMES[p.edu + 1]}** "
                    f"ค่าเทอม {fmt_money(EDU_COST[p.edu])} (⚡40)")
        st.caption("วุฒิช่วยเพิ่มเงินเดือนออฟฟิศ/โปรแกรมเมอร์/หมอ · ม.6 ปลดล็อกโปรแกรมเมอร์ · ปริญญาโทปลดล็อกแพทย์")
        st.button("📚 ลงเรียน", on_click=act, args=(world.life_action, "study"))
    else:
        st.success("🎓 คุณจบการศึกษาสูงสุดแล้ว!")

    st.markdown("### 🛍️ ซื้อทรัพย์สิน")
    cols = st.columns(4)
    for i, (k, a) in enumerate(ASSETS.items()):
        with cols[i % 4].container(border=True):
            st.markdown(f"**{a['icon']} {a['name']}**")
            st.caption(a["desc"])
            if p.has(k):
                st.markdown("✅ เป็นเจ้าของแล้ว")
            else:
                st.button(fmt_money(a["price"]), key=f"asset_{k}", on_click=act,
                          args=(world.buy_asset, k), width="stretch")


def tab_market(p):
    st.markdown("### 🏪 ตลาดกลาง (ราคาแชร์กันทั้งเมือง)")
    rows = []
    for k, it in MARKET_ITEMS.items():
        hist = world.price_hist[k]
        chg = (hist[-1] - hist[-2]) / hist[-2] * 100 if len(hist) > 1 else 0
        rows.append({"สินค้า": f"{it['icon']} {it['name']}", "ราคา": world.prices[k],
                     "เปลี่ยนแปลง %": round(chg, 1), "ราคาฐาน": it["base"],
                     "คุณมี": p.inventory.get(k, 0), "แนวโน้ม": hist})
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch",
                 column_config={"แนวโน้ม": st.column_config.LineChartColumn("แนวโน้ม", width="medium"),
                                "ราคา": st.column_config.NumberColumn(format="฿%.1f"),
                                "ราคาฐาน": st.column_config.NumberColumn(format="฿%d")})

    st.markdown("### 📈 ตลาดหุ้น (ทุกอาชีพลงทุนได้)")
    st.caption("ราคาเปลี่ยนทุกวันตามเหตุการณ์ · BANK และ FOOD จ่ายปันผลรายวัน · ค่าธรรมเนียม 0.25% · "
               "การซื้อขายจำนวนมากขยับราคาได้")
    for k, s in STOCKS.items():
        hist = world.stock_hist[k]
        price = world.stock_prices[k]
        chg = (hist[-1] - hist[-2]) / hist[-2] * 100 if len(hist) > 1 else 0
        with st.container(border=True):
            c = st.columns([2, 2.5, 1, 1, 1])
            c[0].metric(f"{k} · {s['name']}", fmt_money(price) if price >= 100 else f"฿{price:.2f}", f"{chg:+.1f}%")
            c[0].caption(f"ถืออยู่ {p.stocks.get(k, 0)} หุ้น (มูลค่า {fmt_money(p.stocks.get(k, 0) * price)})")
            c[1].line_chart(pd.DataFrame({"ราคา": hist}), height=110)
            c[2].number_input("จำนวนหุ้น", 1, 100000, 10, key=f"sq_{k}")
            c[3].button("ซื้อ", key=f"sb_{k}", on_click=act, args=(world.trade_stock, k, f"@sq_{k}", True),
                        width="stretch", type="primary")
            c[4].button("ขาย", key=f"ss_{k}", on_click=act, args=(world.trade_stock, k, f"@sq_{k}", False),
                        width="stretch", disabled=p.stocks.get(k, 0) == 0)


def _send_chat():
    p = me()
    if p:
        res = world.send_chat(p, st.session_state.get("chat_text", ""))
        if not res.ok:
            st.toast(res.msg, icon=res.icon)
        else:
            st.session_state["chat_text"] = ""


@st.fragment(run_every=3)
def city_live():
    world.tick()
    left, right = st.columns([3, 2], gap="large")
    with left:
        st.markdown("### 💬 แชทเมือง")
        with st.container(height=330):
            if not world.chat:
                st.caption("ยังไม่มีใครคุย ทักทายเลย!")
            for m in world.chat:
                st.markdown(
                    f"<div class='chat-line'>{m['avatar']} <b>{m['name']}</b> "
                    f"<span class='muted'>{CAREERS.get(m['career'], {}).get('icon', '')}</span>: "
                    f"{_escape(m['text'])}</div>", unsafe_allow_html=True)
    with right:
        st.markdown("### 📰 ข่าวในเมือง")
        with st.container(height=330):
            for f in world.feed:
                st.markdown(f"<div class='chat-line'><span class='muted'>วัน {f['day']}</span> {f['text']}</div>",
                            unsafe_allow_html=True)


def _escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def tab_city(p):
    city_live()
    c = st.columns([4, 1])
    c[0].text_input("ข้อความ", key="chat_text", placeholder="พิมพ์แล้วกด Enter...", label_visibility="collapsed",
                    on_change=_send_chat)
    c[1].button("ส่ง", on_click=_send_chat, width="stretch")

    others = [x for x in world.players.values() if x.id != p.id]
    if not others:
        st.info("ยังไม่มีผู้เล่นคนอื่น ส่งลิงก์ให้เพื่อนมาเล่นด้วยกัน!")
        return
    st.markdown("### 🤝 ปฏิสัมพันธ์")
    fmt = lambda pid: f"{world.players[pid].avatar} {world.players[pid].name} ({career_label(world.players[pid].career)})"
    ids = [x.id for x in others]
    a, b, c = st.columns(3)
    with a.container(border=True):
        st.markdown("**💸 โอนเงิน**")
        st.selectbox("ผู้รับ", ids, format_func=fmt, key="tr_to")
        st.number_input("จำนวน", 1, 10_000_000, 500, key="tr_amt")
        st.button("โอน", on_click=act, args=(world.transfer, "@tr_to", "@tr_amt"), width="stretch")
    with b.container(border=True):
        st.markdown("**💝 โดเนทสตรีมเมอร์**")
        streamers = [x.id for x in others if x.career == "streamer"]
        if streamers:
            st.selectbox("สตรีมเมอร์", streamers, format_func=fmt, key="dn_to")
            st.number_input("จำนวน", 10, 1_000_000, 100, key="dn_amt")
            st.button("โดเนท", on_click=act, args=(world.transfer, "@dn_to", "@dn_amt", "donate"),
                      width="stretch")
        else:
            st.caption("ยังไม่มีสตรีมเมอร์ในเมือง")
    with c.container(border=True):
        st.markdown("**🎁 ส่งของขวัญ**")
        items = [k for k, q in p.inventory.items() if q > 0]
        if items:
            st.selectbox("ผู้รับ", ids, format_func=fmt, key="gf_to")
            st.selectbox("ของ", items, key="gf_item",
                         format_func=lambda k: f"{MARKET_ITEMS[k]['icon']} {MARKET_ITEMS[k]['name']} (มี {p.inventory[k]})")
            st.number_input("จำนวน", 1, 10000, 1, key="gf_qty")
            st.button("ส่ง", key="gf_btn", on_click=act, args=(world.gift_item, "@gf_to", "@gf_item", "@gf_qty"),
                      width="stretch")
        else:
            st.caption("คุณยังไม่มีของในคลัง")


@st.fragment(run_every=5)
def sidebar_live():
    world.tick()
    p = me()
    online = {x.id for x in world.online()}
    st.markdown(f"### 🏆 อันดับเศรษฐี")
    st.caption(f"🟢 ออนไลน์ {len(online)} · 👥 ทั้งหมด {len(world.players)}")
    for i, (x, nw) in enumerate(world.leaderboard()[:15], 1):
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(i, f"{i}.")
        dot = "🟢" if x.id in online else "⚪"
        you = " **(คุณ)**" if p and x.id == p.id else ""
        st.markdown(f"{medal} {dot} {x.avatar} {x.name}{you}  \n"
                    f"<span class='muted'>{CAREERS[x.career]['icon']} {fmt_money(nw)}</span>",
                    unsafe_allow_html=True)


def game(p):
    header()
    tabs = st.tabs(["💼 งาน", "🏠 ชีวิต", "📈 ตลาด & หุ้น", "🏙️ เมือง"])
    with tabs[0]:
        tab_work(p)
    with tabs[1]:
        tab_life(p)
    with tabs[2]:
        tab_market(p)
    with tabs[3]:
        tab_city(p)
    with st.sidebar:
        sidebar_live()
        st.divider()
        if p.assets:
            st.caption("ทรัพย์สิน: " + " ".join(ASSETS[a]["icon"] for a in p.assets))
        inv = [f"{MARKET_ITEMS[k]['icon']}{q}" for k, q in p.inventory.items() if q]
        if inv:
            st.caption("คลัง: " + " ".join(inv))
        st.caption("🔗 แชร์ลิงก์หน้านี้ (ไม่มี ?t=) ให้เพื่อนเข้ามาเล่นในเมืองเดียวกัน")
        if st.button("🚪 ออกจากระบบ"):
            world.logout(st.query_params.get("t", ""))
            st.query_params.clear()
            st.rerun()


player = me()
if player:
    game(player)
else:
    if "t" in st.query_params:
        st.query_params.clear()
    landing()
