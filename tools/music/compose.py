"""Compose and render the two background-music loops for LIFE TOWN.

  python3 tools/music/compose.py OUT_DIR

Writes day.wav ("Sunny Town", cozy ukulele + marimba, 92 bpm) and
night.wav ("Starry Night", e-piano + music box, 70 bpm). Each file is a
seamless loop: the song is rendered three times back to back (so reverb and note
tails of the end spill into the start) and the middle pass is kept.
Encode with ffmpeg afterwards (see tools/music/build.sh).
"""
import sys, os
import numpy as np
from scipy.signal import lfilter, butter, fftconvolve

SR = 44100
rng = np.random.default_rng(11)
NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def nn(s):
    """'C#5' / 'Bb4' -> midi number"""
    i, acc = 1, 0
    while s[i] in '#b':
        acc += 1 if s[i] == '#' else -1
        i += 1
    return 12 * (int(s[i:]) + 1) + NAMES[s[0]] + acc


def hz(m): return 440.0 * 2 ** ((m - 69) / 12)


def lp(x, f, order=2):
    b, a = butter(order, min(f / (SR / 2), 0.99), 'low')
    return lfilter(b, a, x)


def hp(x, f, order=2):
    b, a = butter(order, f / (SR / 2), 'high')
    return lfilter(b, a, x)


def bp(x, lo, hi):
    b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band')
    return lfilter(b, a, x)


def env(n, attack, tau, release=0.03, hold=None):
    """attack ramp, exponential decay (tau s), and a short release at the end"""
    t = np.arange(n) / SR
    e = np.exp(-t / tau) if tau else np.ones(n)
    a = max(1, int(attack * SR))
    e[:a] *= np.linspace(0, 1, a) ** 1.5
    r = min(n, max(1, int(release * SR)))
    e[-r:] *= np.linspace(1, 0, r)
    return e


# ------------------------------------------------------------------ instruments (mono)
def pluck(m, dur, bright=0.6, decay=0.9965):
    """Karplus-Strong string, exact tuning via a resample (ukulele / nylon guitar)"""
    f = hz(m)
    N = int(np.ceil(SR / f))
    sr_eff = N * f
    total = int(dur * sr_eff) + N + 2
    y = np.zeros(total)
    exc = rng.uniform(-1, 1, N)
    k = max(1, int(round((1 - bright) * 6)) + 1)
    exc = np.convolve(exc, np.ones(k) / k, 'same')
    y[:N] = exc - exc.mean()
    y[N] = y[0] * decay
    pos = N + 1
    while pos < total:
        end = min(pos + N, total)
        y[pos:end] = decay * 0.5 * (y[pos - N:end - N] + y[pos - N - 1:end - N - 1])
        pos = end
    t_out = np.arange(int(dur * SR)) / SR
    out = np.interp(t_out * sr_eff, np.arange(total), y)
    return out * env(len(out), 0.002, None, 0.05)


def mallet(m, dur, partials, click=0.0):
    """additive mallet: partials = [(ratio, amp, tau)]"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    out = np.zeros(n)
    for r, a, tau in partials:
        if f * r < SR / 2.2:
            out += a * np.sin(2 * np.pi * f * r * t + rng.uniform(0, 6.28)) * np.exp(-t / tau)
    if click:
        c = int(0.006 * SR)
        out[:c] += click * rng.uniform(-1, 1, c) * np.linspace(1, 0, c)
    return out * env(n, 0.0015, None, 0.04)


def marimba(m, dur): return mallet(m, max(dur, 0.9), [(1, 1, 0.42), (4, 0.22, 0.06), (9.9, 0.05, 0.02)], 0.05)
def kalimba(m, dur): return mallet(m, max(dur, 1.2), [(1, 1, 0.7), (2, 0.08, 0.3), (5.4, 0.14, 0.08)], 0.04)
def glock(m, dur): return mallet(m, max(dur, 1.6), [(1, 1, 1.0), (2.76, 0.35, 0.25), (5.4, 0.12, 0.08)], 0.02)
def musicbox(m, dur): return mallet(m, max(dur, 1.8), [(1, 1, 1.3), (2, 0.12, 0.6), (3.0, 0.1, 0.3), (5.9, 0.06, 0.07)], 0.03)


def epiano(m, dur, vel=1.0):
    """two-op FM electric piano (Rhodes-ish) with soft tremolo"""
    n = int((dur + 0.6) * SR)
    t = np.arange(n) / SR
    f = hz(m)
    idx = (0.6 + 1.6 * vel) * np.exp(-t / 0.35) + 0.25
    mod = np.sin(2 * np.pi * f * t)
    car = np.sin(2 * np.pi * f * t + idx * mod)
    bell = 0.12 * np.sin(2 * np.pi * f * 14 * t) * np.exp(-t / 0.03)
    e = np.exp(-t / 1.8)
    rel = int(dur * SR)
    e[rel:] *= np.exp(-np.arange(n - rel) / SR / 0.15)
    a = int(0.003 * SR)
    e[:a] *= np.linspace(0, 1, a)
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)
    return (car + bell) * e * trem


def flute(m, dur):
    """soft ocarina / whistle lead: sine + a little 3rd harmonic, delayed vibrato, breath"""
    n = int((dur + 0.15) * SR)
    t = np.arange(n) / SR
    f = hz(m)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.18) / 0.25, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    tone = np.sin(ph) + 0.12 * np.sin(3 * ph) + 0.05 * np.sin(2 * ph)
    breath = lp(hp(rng.standard_normal(n), 900), 3500) * 0.05
    e = np.ones(n)
    a = int(0.05 * SR)
    e[:a] = np.linspace(0, 1, a) ** 2
    rel = int(dur * SR)
    e[rel:] *= np.linspace(1, 0, n - rel)
    e *= 1 - 0.15 * np.clip(t / max(dur, 0.1), 0, 1)
    return (tone + breath) * e


def bass(m, dur):
    n = int((dur + 0.08) * SR)
    t = np.arange(n) / SR
    f = hz(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.1 * np.sin(6 * np.pi * f * t)
    x = np.tanh(x * 1.3)
    e = np.exp(-t / 0.9)
    a = int(0.008 * SR)
    e[:a] *= np.linspace(0, 1, a)
    rel = int(dur * SR)
    e[rel:] *= np.linspace(1, 0, n - rel)
    return lp(x * e, 1400)


def pad(ms, dur):
    n = int((dur + 1.2) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in ms:
        for det in (-0.12, 0.0, 0.11):
            f = hz(m + det)
            out += (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) / 3
    e = np.ones(n)
    a = int(0.9 * SR)
    e[:a] = np.linspace(0, 1, a)
    rel = int(dur * SR)
    e[rel:] *= np.linspace(1, 0, n - rel) ** 2
    return lp(out * e, 1800) / len(ms)


def kick():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    f = 48 + 75 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.11)


def rim():
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 1500, 4500) * 0.5 + np.sin(2 * np.pi * 820 * t) * 0.6
    return x * np.exp(-t / 0.012)


def snap():
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 1200, 6000)
    e = np.exp(-t / 0.05) + 0.6 * np.exp(-np.maximum(t - 0.012, 0) / 0.04) * (t > 0.012)
    return x * e * 0.8


def shaker(soft=1.0):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 5000)
    e = np.minimum(t / 0.015, 1) * np.exp(-t / 0.03)
    return x * e * soft


def brush():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 2000, 8000)
    e = np.minimum(t / 0.05, 1) * np.exp(-t / 0.09)
    return x * e


# ------------------------------------------------------------------ song helpers
def parse_bars(text):
    """'A4:2 C5:1 r:1 ... | ...' -> list of bars, each a list of (midi|None, eighths)"""
    bars = []
    for b in text.split('|'):
        notes = []
        for tok in b.split():
            p, d = tok.split(':')
            notes.append((None if p == 'r' else nn(p), float(d)))
        assert abs(sum(d for _, d in notes) - 8) < 1e-6, (b, sum(d for _, d in notes))
        bars.append(notes)
    return bars


class Song:
    def __init__(self, bpm, bars, swing=0.5):
        self.B = 60 / bpm
        self.bars = bars
        self.swing = swing
        self.L = bars * 4 * self.B
        n = int(self.L * 3 * SR) + int(4 * SR)
        self.buses = {}
        self.n = n

    def t(self, bar, eighth):
        """time of an eighth-note position (fractional eighths allowed), with swing"""
        beat, off = divmod(eighth, 2)
        if off >= 1:
            off = self.swing * 2 + (off - 1) * (1 - self.swing) * 2
        else:
            off = off * self.swing * 2
        return bar * 4 * self.B + (beat + off / 2) * self.B

    def add(self, bus, sig, at, gain=1.0, pan=0.0, jitter=0.004):
        """place a mono signal on a stereo bus, at time `at` (seconds), on all three passes"""
        if bus not in self.buses:
            self.buses[bus] = np.zeros((2, self.n))
        lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        jit = rng.uniform(-jitter, jitter)  # same humanising on every pass so the loop is exact
        for k in range(3):
            i = int((at + k * self.L + jit) * SR)
            i = max(i, 0)
            j = min(self.n, i + len(sig))
            if i >= self.n:
                continue
            self.buses[bus][0, i:j] += sig[:j - i] * gain * lg * 1.414
            self.buses[bus][1, i:j] += sig[:j - i] * gain * rg * 1.414

    def melody(self, bus, inst, bars, start_bar, gain, pan=0.0, octave=0, legato=1.0):
        for bi, notes in enumerate(bars):
            e = 0.0
            for m, d in notes:
                if m is not None:
                    dur = d * self.B / 2 * legato
                    v = gain * rng.uniform(0.9, 1.05) * (1.06 if e % 4 == 0 else 1.0)
                    self.add(bus, inst(m + 12 * octave, dur), self.t(start_bar + bi, e), v, pan)
                e += d


def reverb_ir(seconds, damp=4500, seed=0):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        x = r.standard_normal(n) * np.exp(-t / (seconds / 6.5))
        x = lp(x, damp)
        x[:int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        out.append(x / np.sqrt(np.sum(x ** 2)))
    return out


def mixdown(song, sends, levels, name, out_dir, verb_s=2.4):
    n = song.n
    dry = np.zeros((2, n))
    wet_in = np.zeros((2, n))
    for bus, sig in song.buses.items():
        dry += sig * levels.get(bus, 1.0)
        wet_in += sig * levels.get(bus, 1.0) * sends.get(bus, 0.2)
    ir = reverb_ir(verb_s, seed=3)
    wet = np.stack([fftconvolve(wet_in[c], ir[c])[:n] for c in range(2)])
    mix = dry + wet * 0.9
    mix = hp(mix, 35)
    # gentle glue compression (RMS follower) and soft clip
    rms = np.sqrt(lp(np.mean(mix ** 2, axis=0), 6, 1) + 1e-9)
    thr = np.percentile(rms[int(song.L * SR):int(2 * song.L * SR)], 80)
    gain = np.where(rms > thr, (thr / rms) ** 0.35, 1.0)
    mix *= gain
    a, b = int(song.L * SR), int(2 * song.L * SR)
    loop = mix[:, a:b]
    loop = np.tanh(loop / np.max(np.abs(loop)) * 1.15) / np.tanh(1.15)
    loop *= 0.89  # ~ -1 dBFS
    pcm = (loop.T * 32767).astype(np.int16)
    import wave
    path = os.path.join(out_dir, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'wrote {path}  {loop.shape[1] / SR:.1f}s')


# ------------------------------------------------------------------ DAY: "Sunny Town" (C major, 92 bpm, light swing)
def day(out_dir):
    s = Song(92, 32, swing=0.57)
    C = {  # ukulele voicing, bass root
        'F': ([57, 60, 64, 65], 41), 'Em': ([55, 59, 62, 64], 40), 'Dm': ([57, 60, 62, 65], 38),
        'C': ([55, 59, 60, 64], 36), 'A7': ([55, 61, 64, 69], 45), 'G7': ([55, 59, 62, 65], 43),
        'C6': ([55, 57, 60, 64], 36), 'Am': ([55, 57, 60, 64], 45), 'Fm': ([56, 60, 62, 65], 41),
    }
    A_ch = [['F'], ['Em'], ['Dm'], ['C'], ['F'], ['Em', 'A7'], ['Dm', 'G7'], ['C6']]
    B_ch = [['Am'], ['Dm'], ['G7'], ['C'], ['F'], ['Fm'], ['Em', 'A7'], ['Dm', 'G7']]
    A_mel = parse_bars(
        'A4:2 C5:1 E5:2 D5:1 C5:2 | B4:2 G4:1 B4:1 D5:4 | C5:2 A4:1 C5:1 F5:2 E5:1 D5:1 | E5:6 r:2 |'
        'A5:2 G5:1 E5:1 C5:2 A4:2 | G4:1 B4:1 E5:2 C#5:2 E5:2 | F5:2 E5:1 D5:1 B4:2 G4:2 | C5:4 r:4')
    B_mel = parse_bars(
        'E5:1 G5:1 A5:2 G5:1 E5:1 C5:2 | D5:1 F5:1 A5:2 G5:2 F5:2 | B4:2 D5:1 F5:1 E5:2 D5:2 | E5:4 G5:2 r:2 |'
        'A5:2 C6:2 B5:1 A5:1 G5:2 | Ab5:2 F5:2 D5:2 C5:2 | B4:2 E5:2 C#5:2 A4:2 | D5:2 F5:1 E5:1 D5:2 B4:2')
    # A again with a little ending variation so the third section feels new
    A2_mel = A_mel[:7] + parse_bars('C5:2 E5:1 G5:1 C6:3 r:1')
    sections = [('A', A_ch, A_mel), ('B', B_ch, B_mel), ('A2', A_ch, A2_mel), ('B2', B_ch, B_mel)]

    STRUM = [(0, 1.0, 'd'), (2, 0.55, 'd'), (3, 0.45, 'u'), (5, 0.5, 'u'), (6, 0.75, 'd'), (7, 0.45, 'u')]
    for si, (name, chs, mel) in enumerate(sections):
        b0 = si * 8
        for bi, cs in enumerate(chs):
            bar = b0 + bi
            for e, vel, dirn in STRUM if name != 'B2' else [(0, 0.9, 'd'), (5, 0.4, 'u')]:
                cname = cs[0] if (len(cs) == 1 or e < 4) else cs[1]
                notes, _ = C[cname]
                seq = notes if dirn == 'd' else notes[::-1][:3]
                for k, m in enumerate(seq):
                    s.add('uke', pluck(m, 1.6, bright=0.55, decay=0.9955), s.t(bar, e) + k * 0.011,
                          0.33 * vel * (1 - 0.08 * k), pan=-0.25)
            # bass: root on 1, fifth on 3, approach note on the last eighth
            for half, cname in enumerate(cs if len(cs) == 2 else cs * 2):
                root = C[cname][1]
                if half == 0:
                    s.add('bass', bass(root, s.B * 1.4), s.t(bar, 0), 0.75)
                    s.add('bass', bass(root + 7 if cname not in ('Fm',) else root + 7, s.B * 0.9), s.t(bar, 3), 0.45)
                else:
                    s.add('bass', bass(root, s.B * 1.4), s.t(bar, 4), 0.7)
            if name != 'B2':
                s.add('bass', bass(C[cs[-1]][1] + 12, s.B * 0.4), s.t(bar, 7), 0.35)
            # drums
            full = not (name == 'A' and bi < 4) and name != 'B2'
            for e in range(8):
                s.add('perc', shaker(1.0 if e % 2 else 0.6), s.t(bar, e), 0.16 if full else 0.1, pan=0.35)
            if full:
                s.add('drums', kick(), s.t(bar, 0), 0.6)
                s.add('drums', kick(), s.t(bar, 5), 0.35)
                s.add('drums', rim(), s.t(bar, 2), 0.32, pan=0.1)
                s.add('drums', snap(), s.t(bar, 6), 0.22, pan=-0.1)
            elif name == 'B2':
                s.add('drums', rim(), s.t(bar, 2), 0.18, pan=0.1)
                s.add('drums', rim(), s.t(bar, 6), 0.18, pan=0.1)
        # lead instruments per section
        if name == 'A':
            s.melody('lead', marimba, mel, b0, 0.5, pan=0.15)
        elif name == 'B':
            s.melody('lead', glock, mel, b0, 0.34, pan=0.2)
            s.melody('lead2', marimba, mel, b0, 0.18, pan=-0.2, octave=-1)
        elif name == 'A2':
            s.melody('lead', flute, mel, b0, 0.34, pan=0.1)
            # marimba arpeggio counter line on chord tones
            for bi, cs in enumerate(chs):
                for e in range(8):
                    cname = cs[0] if (len(cs) == 1 or e < 4) else cs[1]
                    nts = C[cname][0]
                    m = nts[[0, 2, 1, 3, 2, 1, 3, 2][e]] + 12
                    s.add('lead2', marimba(m, 0.3), s.t(b0 + bi, e), 0.13, pan=-0.3)
        else:
            s.melody('lead', kalimba, mel, b0, 0.42, pan=0.1)
            # sparkle on the last bar leading back to the top
            for k, m in enumerate([nn('G5'), nn('B5'), nn('D6'), nn('F6')]):
                s.add('lead2', glock(m, 0.5), s.t(b0 + 7, 4 + k), 0.12, pan=0.3)
    mixdown(s, sends={'uke': 0.18, 'lead': 0.3, 'lead2': 0.3, 'bass': 0.02, 'drums': 0.08, 'perc': 0.1},
            levels={'uke': 1.0, 'lead': 1.0, 'lead2': 1.0, 'bass': 0.9, 'drums': 0.8, 'perc': 0.7},
            name='day.wav', out_dir=out_dir, verb_s=2.0)


# ------------------------------------------------------------------ NIGHT: "Starry Night" (F major, 70 bpm)
def night(out_dir):
    s = Song(70, 32, swing=0.6)
    C = {
        'Bb': ([57, 62, 65, 70], 46), 'Am': ([55, 60, 64, 69], 45), 'Gm': ([53, 58, 62, 67], 43),
        'F': ([57, 60, 64, 65], 41), 'D7': ([54, 60, 62, 69], 38), 'C7': ([55, 58, 60, 64], 36),
        'Dm': ([53, 57, 60, 62], 38), 'Bbm': ([58, 61, 65, 67], 46),
    }
    A_ch = [['Bb'], ['Am'], ['Gm'], ['F'], ['Bb'], ['Am', 'D7'], ['Gm', 'C7'], ['F']]
    B_ch = [['Dm'], ['Gm'], ['C7'], ['F'], ['Bb'], ['Bbm'], ['Am', 'D7'], ['Gm', 'C7']]
    A_mel = parse_bars(
        'F5:3 D5:1 A4:4 | G5:2 E5:2 C5:4 | F5:2 D5:2 Bb4:2 A4:2 | C5:6 r:2 |'
        'D5:2 F5:2 A5:3 G5:1 | E5:4 F#5:4 | G5:2 F5:2 E5:2 Bb4:2 | A4:6 r:2')
    B_mel = parse_bars(
        'A5:2 F5:2 D5:2 C5:2 | Bb4:2 D5:2 F5:3 E5:1 | E5:4 G5:2 Bb5:2 | A5:6 r:2 |'
        'F5:2 A5:2 D6:2 C6:2 | Db6:4 Bb5:2 G5:2 | C6:2 A5:2 F#5:2 D5:2 | Bb5:2 G5:2 E5:2 C5:2')
    sections = [('A', A_ch, A_mel), ('B', B_ch, B_mel), ('A2', A_ch, A_mel), ('B2', B_ch, B_mel)]
    for si, (name, chs, mel) in enumerate(sections):
        b0 = si * 8
        for bi, cs in enumerate(chs):
            bar = b0 + bi
            halves = cs if len(cs) == 2 else cs * 2
            # e-piano: chord on 1, soft re-strike on the "and" of 2 (or on 3 for split bars)
            if len(cs) == 1:
                notes, _ = C[cs[0]]
                for k, m in enumerate(notes):
                    s.add('keys', epiano(m, s.B * 2.6, 0.8), s.t(bar, 0) + k * 0.012, 0.16, pan=-0.15 + k * 0.1)
                for m in notes[1:]:
                    s.add('keys', epiano(m, s.B * 1.2, 0.5), s.t(bar, 5), 0.09, pan=0.1)
            else:
                for h, cname in enumerate(cs):
                    for k, m in enumerate(C[cname][0]):
                        s.add('keys', epiano(m, s.B * 1.8, 0.7), s.t(bar, 4 * h) + k * 0.012, 0.15, pan=-0.15 + k * 0.1)
            # pad underneath (soft), whole bar
            s.add('pad', pad([m + 12 for m in C[cs[0]][0][1:3]], s.B * 4), s.t(bar, 0), 0.22)
            # bass from section B on
            if name != 'A':
                for h, cname in enumerate(halves):
                    root = C[cname][1]
                    if h == 0:
                        s.add('bass', bass(root, s.B * 1.8), s.t(bar, 0), 0.7)
                    if h == 1 or len(cs) == 1:
                        s.add('bass', bass(root + (7 if h == 0 else 0), s.B * 1.2), s.t(bar, 4 if h == 1 else 5), 0.45)
                # brushes + soft kick
                s.add('drums', kick(), s.t(bar, 0), 0.32)
                for e in (2, 6):
                    s.add('drums', brush(), s.t(bar, e), 0.16, pan=0.2)
                for e in range(8):
                    s.add('perc', shaker(0.7 if e % 2 else 0.4), s.t(bar, e), 0.07, pan=0.4)
        if name == 'A':
            s.melody('lead', musicbox, mel, b0, 0.36, pan=0.15)
        elif name == 'B':
            s.melody('lead', musicbox, mel, b0, 0.3, pan=0.15)
            s.melody('lead2', flute, mel, b0, 0.12, pan=-0.2, octave=-1)
        elif name == 'A2':
            s.melody('lead', flute, mel, b0, 0.3, pan=0.05)
            for bi, cs in enumerate(chs):  # music-box sparkle arpeggio
                for e in range(8):
                    cname = cs[0] if (len(cs) == 1 or e < 4) else cs[1]
                    nts = C[cname][0]
                    s.add('lead2', musicbox(nts[[0, 1, 2, 3, 2, 3, 1, 2][e]] + 24, 0.4), s.t(b0 + bi, e), 0.07, pan=0.35)
        else:
            s.melody('lead', lambda m, d: epiano(m, d, 1.0), mel, b0, 0.22, pan=0.1)
            s.melody('lead2', musicbox, mel, b0, 0.16, pan=-0.25)
    mixdown(s, sends={'keys': 0.3, 'lead': 0.4, 'lead2': 0.45, 'pad': 0.4, 'bass': 0.03, 'drums': 0.15, 'perc': 0.15},
            levels={'keys': 1.0, 'lead': 1.0, 'lead2': 1.0, 'pad': 0.8, 'bass': 0.85, 'drums': 0.8, 'perc': 0.7},
            name='night.wav', out_dir=out_dir, verb_s=3.0)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    which = sys.argv[2:] or ['day', 'night']
    if 'day' in which:
        day(out)
    if 'night' in which:
        night(out)
