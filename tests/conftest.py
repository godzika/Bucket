"""Pytest configuration.

These are integration tests that need a running database and MinIO. The easy
path is to run them inside the api container, after `docker compose up -d`:

    docker compose exec api pytest -q

The fixture below rewrites ``S3_PUBLIC_ENDPOINT_URL`` to the internal endpoint
when we detect a host-style ``localhost:9000`` value; otherwise the in-process
test would try to hit MinIO via localhost which only resolves on the host.
"""
from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import httpx
import pytest


@pytest.fixture(scope="session", autouse=True)
def _override_public_endpoint() -> None:
    """Presigned URLs must be reachable from the test runner (often the API container)."""
    internal = os.environ.get("S3_ENDPOINT_URL")
    public = os.environ.get("S3_PUBLIC_ENDPOINT_URL")
    if internal and public and internal.rstrip("/") != public.rstrip("/"):
        os.environ["S3_PUBLIC_ENDPOINT_URL"] = internal


@pytest.fixture(autouse=True)
async def _reset_db_pool_after_test() -> AsyncIterator[None]:
    yield
    from app.db import engine

    await engine.dispose()


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    from app.config import get_settings
    from app.storage import get_public_s3

    get_settings.cache_clear()
    get_public_s3.cache_clear()
    from app.main import app  # imported lazily so env overrides apply first

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture
def unique_email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.com"
