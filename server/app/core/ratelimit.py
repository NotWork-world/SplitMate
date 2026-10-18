"""Small in-process sliding-window rate limiter (one Render instance; swap for Redis if scaled out)."""

from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import Request

from .config import get_settings
from .errors import ApiError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window: float = 60.0) -> None:
        if limit <= 0:
            return
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                retry = int(window - (now - q[0])) + 1
                raise ApiError(429, "rate_limited", f"Too many attempts. Try again in {retry} seconds.")
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    # Render's proxy appends the address it saw; earlier entries are client-supplied and spoofable.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def auth_limit(request: Request) -> None:
    limiter.check(f"auth:{client_ip(request)}", get_settings().auth_rate_limit_per_minute)


def write_limit(request: Request) -> None:
    limiter.check(f"write:{client_ip(request)}", get_settings().rate_limit_per_minute)
