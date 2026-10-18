from __future__ import annotations

import logging

from fastapi import FastAPI
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

    app = FastAPI(
        title="SplitMate API",
        version=__version__,
        description="Expense sharing with exact, explainable money maths. Amounts are integer minor units.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
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
        }

    return app


app = create_app()
