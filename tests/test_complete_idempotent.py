"""Unit tests for /complete idempotency without requiring MinIO/Postgres."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.routers.files import complete_upload


def _ready_multipart_record(*, size_bytes: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        status="ready",
        multipart_upload_id=None,
        object_key="users/u/f/big.bin",
        size_bytes=size_bytes,
        original_filename="big.bin",
    )


@pytest.mark.asyncio
async def test_complete_ready_file_is_idempotent_and_does_not_delete():
    """Ready multipart files must short-circuit; never take the single-PUT delete path."""
    large = 6 * 1024 * 1024 * 1024  # above default single_put_max_bytes
    record = _ready_multipart_record(size_bytes=large)
    user = SimpleNamespace(id=uuid.uuid4())
    db = AsyncMock()

    with (
        patch("app.routers.files.get_owned_file", new=AsyncMock(return_value=record)),
        patch("app.routers.files.head_object") as head_object,
        patch("app.routers.files.delete_object") as delete_object,
        patch("app.routers.files.complete_multipart_upload") as complete_mp,
    ):
        result = await complete_upload(
            file_id=record.id,
            payload=SimpleNamespace(parts=None),
            current=user,
            db=db,
        )

    assert result is record
    assert result.status == "ready"
    head_object.assert_not_called()
    delete_object.assert_not_called()
    complete_mp.assert_not_called()
    db.delete.assert_not_called()
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_complete_non_pending_non_ready_rejected():
    record = SimpleNamespace(
        id=uuid.uuid4(),
        status="failed",
        multipart_upload_id=None,
        object_key="users/u/f/x.bin",
        size_bytes=1,
    )
    user = SimpleNamespace(id=uuid.uuid4())
    db = AsyncMock()

    with patch("app.routers.files.get_owned_file", new=AsyncMock(return_value=record)):
        with pytest.raises(HTTPException) as exc:
            await complete_upload(
                file_id=record.id,
                payload=SimpleNamespace(parts=None),
                current=user,
                db=db,
            )

    assert exc.value.status_code == 409
