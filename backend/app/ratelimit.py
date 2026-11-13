"""Fixed-window rate limiter.

In-process implementation (correct for a single worker). For several workers/hosts, back the same
interface with Redis (INCR + EXPIRE); the call sites do not change.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, tuple[float, int]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window: int) -> int | None:
        """Record one hit. Returns seconds to wait if over the limit, else None."""
        now = time.monotonic()
        with self._lock:
            start, count = self._hits.get(key, (now, 0))
            if now - start >= window:
                start, count = now, 0
            count += 1
            self._hits[key] = (start, count)
            if len(self._hits) > 100_000:  # crude memory guard
                self._hits = {k: v for k, v in self._hits.items() if now - v[0] < window}
            return int(window - (now - start)) + 1 if count > limit else None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    # Behind Nginx/Cloudflare, run uvicorn with --proxy-headers --forwarded-allow-ips=<proxy ip>
    # so request.client is the real client, never trust X-Forwarded-For blindly here.
    return request.client.host if request.client else "unknown"


def enforce(key: str, limit: int, window: int) -> None:
    retry = limiter.hit(key, limit, window)
    if retry is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "too_many_requests"},
            headers={"Retry-After": str(retry)},
        )


def rate_limit(scope: str, limit: int, window: int) -> Callable[[Request], None]:
    """Dependency: limit per client IP for one endpoint scope."""

    def dep(request: Request) -> None:
        enforce(f"{scope}:{client_ip(request)}", limit, window)

    return dep
