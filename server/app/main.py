from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api import auth, expenses, groups, me, receipts, repayments
from .core import errors
from .core.config import get_settings
from .integrations.google import get_verifier, verify_with_google


def create_app() -> FastAPI:
    settings = get_settings()
    settings.check_production_safety()
    logging.basicConfig(level=logging.INFO)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # People on older app versions have no update card, but they do get push
        # notifications: when this deploy ships a new app_latest_version, every
        # registered phone hears about it once (app_meta remembers who was told).
        from .integrations import push

        push.broadcast_update(settings.app_latest_version)
        yield

    app = FastAPI(
        title="SplitMate API",
        version=__version__,
        description="Expense sharing with exact, explainable money maths. Amounts are integer minor units.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
        lifespan=lifespan,
    )
    errors.install(app)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
            allow_methods=["*"],
            allow_headers=["*"],
        )

    for module in (auth, me, groups, expenses, repayments, receipts):
        app.include_router(module.router, prefix="/api")

    @app.get("/api/health", tags=["meta"])
    def health():
        return {
            "ok": True,
            "version": __version__,
            "features": {
                "google_sign_in": bool(settings.google_client_id_list) or get_verifier() is not verify_with_google,
                # Public OAuth client id (not a secret): the app passes it to Google Sign-In.
                "google_web_client_id": (settings.google_client_id_list or [None])[0],
                "receipt_storage": settings.storage_backend,
                # Receipt text is recognised on the phone (ML Kit); the server only structures it.
                "ocr": "on-device",
            },
            "app": {
                "latest": settings.app_latest_version,
                "apk_url": settings.app_apk_url,
            },
        }

    @app.get("/i/{code}", include_in_schema=False)
    def invite_landing(code: str):
        """Invite links shared on WhatsApp land here: open the app if it's installed, else the Play Store."""
        if not re.fullmatch(r"[A-Za-z0-9]{6,32}", code):
            return HTMLResponse("Invite not found", status_code=404)
        store = f"https://play.google.com/store/apps/details?id={ANDROID_PACKAGE}"
        intent = (
            f"intent://join/{code}#Intent;scheme=splitmate;package={ANDROID_PACKAGE};"
            f"S.browser_fallback_url={quote(store, safe='')};end"
        )
        return HTMLResponse(INVITE_PAGE.format(code=code, intent=intent, store=store, app_link=f"splitmate://join/{code}"))

    return app


ANDROID_PACKAGE = "world.notwork.splitmate"

INVITE_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Join on SplitMate</title>
<style>body{{margin:0;font-family:system-ui,sans-serif;background:#F6F7EC;color:#1A2620;display:flex;
min-height:100vh;align-items:center;justify-content:center}}main{{max-width:360px;padding:24px;text-align:center}}
h1{{font-family:Georgia,serif;font-weight:400;font-size:34px;margin:0 0 8px}}p{{color:#55615A;line-height:1.5}}
a.b{{display:block;padding:16px;border-radius:999px;text-decoration:none;font-weight:600;margin-top:12px}}
.p{{background:#1F3B2D;color:#fff}}.s{{background:#D9E99A;color:#1F3B2D}}code{{font-size:20px;letter-spacing:2px}}</style>
</head><body><main><h1>You're invited to <i>SplitMate</i></h1>
<p>Split bills dish by dish, with GST worked out exactly.</p>
<a class="b p" href="{intent}">Open in SplitMate</a>
<a class="b s" href="{store}">Get the app</a>
<p>After installing and signing up, tap this link again, or enter the code<br><code>{code}</code></p>
</main><script>if(/Android/i.test(navigator.userAgent))location.href="{app_link}";</script></body></html>"""


app = create_app()
