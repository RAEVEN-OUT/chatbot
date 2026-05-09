from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api import admin, chat
from app.core.config import ROOT_DIR, settings


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(admin.router)

admin_static = Path(__file__).resolve().parent / "static" / "admin"
widget_static = ROOT_DIR / "widget"

app.mount("/admin", StaticFiles(directory=admin_static, html=True), name="admin")
app.mount("/widget", StaticFiles(directory=widget_static), name="widget")


@app.get("/")
def index():
    return RedirectResponse(url="/admin/")


@app.get("/health")
def health():
    return {
        "ok": True,
        "storageBackend": settings.storage_backend,
        "llmEnabled": bool(settings.gemini_api_key),
    }
