"""Service-to-service routes called by Express (re-index hooks)."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/internal")
