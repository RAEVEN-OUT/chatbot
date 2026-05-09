from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def slugify(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return cleaned or fallback


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def model_to_dict(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="python")
    return model.dict()


def merge_update(record: BaseModel, patch: BaseModel) -> dict[str, Any]:
    if hasattr(patch, "model_dump"):
        values = patch.model_dump(exclude_unset=True)
    else:
        values = patch.dict(exclude_unset=True)
    data = model_to_dict(record)
    data.update(values)
    data["updated_at"] = now_utc()
    return data
