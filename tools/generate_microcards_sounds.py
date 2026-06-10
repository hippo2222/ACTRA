"""Bake the microcards UI sound set into small WAV files.

The live Web Audio oscillator bips sounded synthetic; these samples are
pre-rendered with proper envelopes, harmonic stacks, slight detune and
filtered noise so they read as warm "UI thock/pluck" sounds instead of
beeps. Authored by this script (no third-party assets, no license risk).

Output: frontend/assets/sounds/mc/*.wav (44.1 kHz, 16-bit mono, ~0.1-1.0 s).
Re-run after tweaking: python tools/generate_microcards_sounds.py
The runtime (frontend/Microcards/microcards.js, DopamineAudio) prefers these
samples and falls back to the live synth if they fail to load.
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

SR = 44100
OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "assets" / "sounds" / "mc"


def buf(seconds: float) -> list[float]:
    return [0.0] * int(SR * seconds)


def add_pluck(b: list[float], t0: float, freq: float, dur: float, vol: float,
              harmonics=((1, 1.0), (2, 0.45), (3, 0.18), (4, 0.08)),
              attack: float = 0.004, detune_cents: float = 4.0,
              vibrato_hz: float = 0.0, vibrato_depth: float = 0.0) -> None:
    """A warm marimba-ish pluck: detuned harmonic stack with exponential decay."""
    start = int(t0 * SR)
    n = int(dur * SR)
    det = 2 ** (detune_cents / 1200.0)
    for i in range(n):
        if start + i >= len(b):
            break
        t = i / SR
        # Envelope: fast soft attack, exponential decay tuned to the duration.
        env = min(1.0, t / attack) * math.exp(-5.2 * t / dur)
        f = freq
        if vibrato_hz:
            f *= 1.0 + vibrato_depth * math.sin(2 * math.pi * vibrato_hz * t)
        s = 0.0
        for mult, amp in harmonics:
            # Higher harmonics die out faster — that's what reads as "wood".
            h_env = math.exp(-3.0 * (mult - 1) * t / dur)
            s += amp * h_env * math.sin(2 * math.pi * f * mult * t)
            s += amp * h_env * 0.5 * math.sin(2 * math.pi * f * det * mult * t)
        b[start + i] += vol * env * s


def add_noise(b: list[float], t0: float, dur: float, vol: float,
              lp: float = 0.25, rise: bool = True, pitch: float = 1.0) -> None:
    """A soft filtered-noise whoosh (one-pole lowpass), rising or falling."""
    rng = random.Random(42)
    start = int(t0 * SR)
    n = int(dur * SR)
    y = 0.0
    for i in range(n):
        if start + i >= len(b):
            break
        t = i / n
        # Envelope shaped like a swipe: quick swell, longer release.
        env = math.sin(math.pi * min(1.0, t)) ** 2
        # Filter opens (rise) or closes (fall) across the gesture.
        k = lp * (0.3 + 0.7 * (t if rise else (1.0 - t))) * pitch
        y += k * (rng.uniform(-1, 1) - y)
        b[start + i] += vol * env * y


def add_thump(b: list[float], t0: float, freq: float, dur: float, vol: float) -> None:
    """A low soft thump (sine with falling pitch) — card landing."""
    start = int(t0 * SR)
    n = int(dur * SR)
    for i in range(n):
        if start + i >= len(b):
            break
        t = i / SR
        env = min(1.0, t / 0.003) * math.exp(-9.0 * t / dur)
        f = freq * (1.0 - 0.35 * (t / dur))
        b[start + i] += vol * env * math.sin(2 * math.pi * f * t)


def write_wav(name: str, b: list[float]) -> None:
    # Normalize to a safe peak, then soft-clip stragglers.
    peak = max(1e-6, max(abs(x) for x in b))
    scale = 0.88 / peak
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for x in b:
            v = math.tanh(x * scale * 1.1) * 0.95
            frames += struct.pack("<h", int(v * 32767))
        w.writeframes(bytes(frames))
    print(f"  {path.name:18s} {path.stat().st_size // 1024:4d} KB")


C5, E5, G5, C6 = 523.25, 659.25, 783.99, 1046.50


def main() -> None:
    print(f"Baking microcards sounds -> {OUT_DIR}")

    # Correct answer: two warm plucks, C5 → E5 (same melody as the old synth).
    b = buf(0.55)
    add_pluck(b, 0.00, C5, 0.30, 0.9)
    add_pluck(b, 0.085, E5, 0.40, 0.8)
    write_wav("correct", b)

    # Combo boost: ascending C-major arpeggio with a sparkle on top.
    b = buf(0.95)
    for i, f in enumerate((C5, E5, G5)):
        add_pluck(b, i * 0.075, f, 0.28, 0.75)
    add_pluck(b, 0.225, C6, 0.55, 0.9)
    add_pluck(b, 0.30, C6 * 2, 0.30, 0.18)  # shimmer octave
    write_wav("boost", b)

    # Near miss: a single muted wobbling note — tension, not punishment.
    b = buf(0.40)
    add_pluck(b, 0.0, 440.0, 0.38, 0.85,
              harmonics=((1, 1.0), (2, 0.25)), vibrato_hz=9.0, vibrato_depth=0.012)
    write_wav("near_miss", b)

    # Recovery (saved the combo): G5 → C6, brighter than 'correct'.
    b = buf(0.60)
    add_pluck(b, 0.00, G5, 0.26, 0.8)
    add_pluck(b, 0.09, C6, 0.45, 0.9)
    write_wav("recovery", b)

    # Combo lost: G4 → Eb4, darker timbre (fewer harmonics, slower attack).
    b = buf(0.65)
    add_pluck(b, 0.00, 392.00, 0.28, 0.8, harmonics=((1, 1.0), (2, 0.2)), attack=0.012)
    add_pluck(b, 0.10, 311.13, 0.50, 0.85, harmonics=((1, 1.0), (2, 0.15)), attack=0.014)
    write_wav("combo_lost", b)

    # Card flip: a tiny paper tick — noise click + low tap.
    b = buf(0.13)
    add_noise(b, 0.0, 0.05, 0.7, lp=0.5, rise=False)
    add_thump(b, 0.012, 190.0, 0.09, 0.5)
    write_wav("card_flip", b)

    # Swipe yes: rising whoosh + a high soft pluck.
    b = buf(0.30)
    add_noise(b, 0.0, 0.20, 0.6, lp=0.35, rise=True)
    add_pluck(b, 0.10, G5, 0.18, 0.35, harmonics=((1, 1.0), (2, 0.3)))
    write_wav("swipe_yes", b)

    # Swipe no: falling whoosh + a low soft thud.
    b = buf(0.30)
    add_noise(b, 0.0, 0.20, 0.6, lp=0.35, rise=False)
    add_thump(b, 0.10, 165.0, 0.16, 0.55)
    write_wav("swipe_no", b)

    # Combo level-up: one bright pluck; runtime pitch-shifts it per combo.
    b = buf(0.32)
    add_pluck(b, 0.0, C5, 0.22, 0.8)
    add_pluck(b, 0.04, C5 * 1.5, 0.24, 0.5)
    write_wav("combo_up", b)

    # Session finish: a rolled C-major chord with shimmer — the victory lap.
    b = buf(1.15)
    for i, f in enumerate((C5, E5, G5, C6)):
        add_pluck(b, i * 0.085, f, 0.65, 0.7)
    add_pluck(b, 0.40, C6 * 2, 0.45, 0.15)
    write_wav("finish", b)

    print("Done.")


if __name__ == "__main__":
    main()
