from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api import admin, chat, handoff
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
app.include_router(handoff.router)

admin_static  = Path(__file__).resolve().parent / "static" / "admin"
portal_static = Path(__file__).resolve().parent / "static" / "portal"
widget_static = ROOT_DIR / "widget"

app.mount("/admin",  StaticFiles(directory=admin_static,  html=True), name="admin")
app.mount("/portal", StaticFiles(directory=portal_static, html=True), name="portal")
app.mount("/widget", StaticFiles(directory=widget_static),             name="widget")


@app.get("/")
def index():
    return RedirectResponse(url="/admin/")


@app.get("/portal")
def portal_redirect():
    return RedirectResponse(url="/portal/")


@app.get("/debug-portal")
def debug_portal():
    import os
    p = Path(__file__).resolve().parent / "static" / "portal"
    return {
        "path": str(p),
        "exists": p.exists(),
        "files": [f.name for f in p.glob("*")] if p.exists() else [],
        "current_file": __file__
    }

@app.get("/health")
def health():
    return {
        "ok": True,
        "storageBackend": settings.storage_backend,
        "llmEnabled": bool(settings.gemini_api_key),
    }
