"""FSRS-4.5 scheduler implementation in pure Python.

Implements the DSR (Difficulty, Stability, Retrievability) model and equations
for card state updates after reviews.
"""

import math
from datetime import datetime, timedelta, timezone
from enum import IntEnum
from typing import Any, Dict, Optional, Tuple


class Rating(IntEnum):
    AGAIN = 1
    HARD = 2
    GOOD = 3
    EASY = 4


class State(IntEnum):
    NEW = 0
    LEARNING = 1
    REVIEW = 2
    RELEARNING = 3


# Default FSRS-4.5 parameters
DEFAULT_W = [
    0.4025,  # w[0] - Initial stability for Again
    1.1838,  # w[1] - Initial stability for Hard
    3.173,   # w[2] - Initial stability for Good
    12.58,   # w[3] - Initial stability for Easy
    4.9135,  # w[4] - Initial difficulty for Good
    1.0922,  # w[5] - Initial difficulty multiplier
    0.9942,  # w[6] - Next difficulty multiplier
    0.0024,  # w[7] - Mean reversion weight
    1.6705,  # w[8] - Stability recall factor
    0.1709,  # w[9] - Stability difficulty exponent
    0.9248,  # w[10] - Stability recall retrievability factor
    2.0517,  # w[11] - Forget stability factor
    0.0747,  # w[12] - Forget stability difficulty exponent
    0.3025,  # w[13] - Forget stability previous stability exponent
    1.395,   # w[14] - Forget stability retrievability exponent
    0.4965,  # w[15] - Hard penalty factor
    2.3785,  # w[16] - Easy bonus factor
]


class FSRS:
    def __init__(self, w: Optional[list] = None, desired_retention: float = 0.9, maximum_interval: int = 36500) -> None:
        self.w = list(w) if w is not None else list(DEFAULT_W)
        self.desired_retention = desired_retention
        self.maximum_interval = maximum_interval

    def init_stability(self, rating: Rating) -> float:
        # Initial stability: S0 = w[rating - 1]
        val = self.w[int(rating) - 1]
        return max(0.1, val)

    def init_difficulty(self, rating: Rating) -> float:
        # Initial difficulty: D0 = w[4] - w[5] * (rating - 3)
        # Clamped to [1.0, 10.0]
        val = self.w[4] - self.w[5] * (int(rating) - 3)
        return max(1.0, min(10.0, val))

    def next_difficulty(self, d: float, rating: Rating) -> float:
        # Next difficulty: D_new = d - w[6] * (rating - 3)
        # Apply mean reversion to w[4]
        d_new = d - self.w[6] * (int(rating) - 3)
        d_new = self.w[7] * self.w[4] + (1 - self.w[7]) * d_new
        return max(1.0, min(10.0, d_new))

    def retrievability(self, t: float, s: float) -> float:
        # R(t, S) = (1 + 19 * t / (9 * S))^(-0.1)
        if s <= 0:
            return 0.0
        return (1.0 + 19.0 * t / (9.0 * s)) ** -0.1

    def next_recall_stability(self, d: float, s: float, r: float, rating: Rating) -> float:
        # Stability increase: SInc = exp(w[8]) * (11 - d) * s^(-w[9]) * (exp((1 - r) * w[10]) - 1)
        # Apply modifier for Hard (w[15]) or Easy (w[16])
        s_inc = math.exp(self.w[8]) * (11.0 - d) * (s ** -self.w[9]) * (math.exp((1.0 - r) * self.w[10]) - 1.0)
        
        modifier = 1.0
        if rating == Rating.HARD:
            modifier = self.w[15]
        elif rating == Rating.EASY:
            modifier = self.w[16]
            
        s_new = s * (1.0 + s_inc * modifier)
        return max(0.1, min(s_new, float(self.maximum_interval)))

    def next_forget_stability(self, d: float, s: float, r: float) -> float:
        # Forget stability: w[11] * d^(-w[12]) * ((s + 1)^w[13] - 1) * exp((1 - r) * w[14])
        # Clamped to not exceed previous stability s
        s_forget = self.w[11] * (d ** -self.w[12]) * ((s + 1.0) ** self.w[13] - 1.0) * math.exp((1.0 - r) * self.w[14])
        s_new = min(s_forget, s)
        return max(0.1, s_new)

    def next_interval(self, s: float) -> int:
        # Interval: I = 9 * S * (R_target^(-10) - 1) / 19
        # Clamped to maximum_interval and minimum of 1 day
        if s <= 0:
            return 1
        i = 9.0 * s * (self.desired_retention ** -10 - 1.0) / 19.0
        return max(1, min(round(i), self.maximum_interval))

    def step(self, state: Dict[str, Any], rating: Rating, elapsed_days: float) -> Dict[str, Any]:
        """Process a card review and advance FSRS state.

        state contains keys: 'stability', 'difficulty', 'state', 'due_at'
        rating is Rating enum
        elapsed_days is float representing days since last review
        """
        stability = float(state.get("stability", 0.0))
        difficulty = float(state.get("difficulty", 0.0))
        card_state = State(state.get("state", State.NEW))

        if card_state == State.NEW or stability <= 0 or difficulty <= 0:
            # First review
            new_s = self.init_stability(rating)
            new_d = self.init_difficulty(rating)
            new_state = State.REVIEW if rating != Rating.AGAIN else State.LEARNING
        else:
            # Subsequent review
            r = self.retrievability(elapsed_days, stability)
            new_d = self.next_difficulty(difficulty, rating)
            if rating == Rating.AGAIN:
                new_s = self.next_forget_stability(new_d, stability, r)
                new_state = State.RELEARNING
            else:
                new_s = self.next_recall_stability(new_d, stability, r, rating)
                new_state = State.REVIEW

        # Calculate next review interval in days
        interval = self.next_interval(new_s)
        
        # In learning or relearning state (if Again was pressed), interval is 1 day or minutes.
        # But for scheduler intervals we store it in days.
        return {
            "stability": round(new_s, 4),
            "difficulty": round(new_d, 4),
            "state": int(new_state),
            "interval_days": interval
        }
