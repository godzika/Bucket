import httpx
import pytest

from app.config import get_settings


async def _register_and_login(client, email: str, password: str = "secret12345") -> str:
    await client.post("/api/auth/register", json={"email": email, "password": password})
    r = await client.post(
        "/api/auth/login",
        data={"username": email, "password": password},
    )
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_full_upload_share_download_flow(client, unique_email):
    token = await _register_and_login(client, unique_email)
    auth = {"Authorization": f"Bearer {token}"}

    payload = b"hello, this is a test file body."
    create = await client.post(
        "/api/files",
        json={
            "filename": "hello.txt",
            "content_type": "text/plain",
            "size_bytes": len(payload),
        },
        headers=auth,
    )
    assert create.status_code == 201, create.text
    body = create.json()

    async with httpx.AsyncClient() as raw:
        put = await raw.put(
            body["upload_url"],
            content=payload,
            headers=body["upload_headers"],
        )
        assert put.status_code in (200, 204), put.text

    complete = await client.post(
        f"/api/files/{body['file_id']}/complete", headers=auth
    )
    assert complete.status_code == 200
    assert complete.json()["status"] == "ready"
    assert complete.json()["size_bytes"] == len(payload)

    dl = await client.get(f"/api/files/{body['file_id']}/download", headers=auth)
    assert dl.status_code == 200
    download_url = dl.json()["download_url"]

    async with httpx.AsyncClient() as raw:
        got = await raw.get(download_url)
        assert got.status_code == 200
        assert got.content == payload

    share = await client.post(
        f"/api/files/{body['file_id']}/shares",
        json={"expires_in_seconds": 3600},
        headers=auth,
    )
    assert share.status_code == 201, share.text
    share_token = share.json()["token"]

    info = await client.get(f"/api/public/{share_token}")
    assert info.status_code == 200
    assert info.json()["filename"] == "hello.txt"

    public_dl = await client.post(f"/api/public/{share_token}/download", json={})
    assert public_dl.status_code == 200

    async with httpx.AsyncClient() as raw:
        got = await raw.get(public_dl.json()["download_url"])
        assert got.status_code == 200
        assert got.content == payload

    delete = await client.delete(f"/api/files/{body['file_id']}", headers=auth)
    assert delete.status_code == 204


@pytest.mark.asyncio
async def test_multipart_upload_flow(client, unique_email, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "single_put_max_bytes", 0)
    # S3/MinIO minimum part size is 5 MiB (except the last part).
    part_size = 5 * 1024 * 1024
    monkeypatch.setattr(settings, "multipart_part_size_bytes", part_size)

    token = await _register_and_login(client, unique_email)
    auth = {"Authorization": f"Bearer {token}"}

    payload = b"x" * (part_size + 1)
    create = await client.post(
        "/api/files",
        json={
            "filename": "big.bin",
            "content_type": "application/octet-stream",
            "size_bytes": len(payload),
        },
        headers=auth,
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["upload_method"] == "multipart"
    assert body["total_parts"] == 2
    assert body["part_size_bytes"] == part_size

    presign = await client.post(
        f"/api/files/{body['file_id']}/upload-parts",
        json={"part_numbers": [1, 2]},
        headers=auth,
    )
    assert presign.status_code == 200, presign.text
    parts_out = presign.json()["parts"]
    assert len(parts_out) == 2

    uploaded: list[dict[str, object]] = []
    async with httpx.AsyncClient() as raw:
        for part in parts_out:
            n = part["part_number"]
            begin = (n - 1) * part_size
            end = min(begin + part_size, len(payload))
            chunk = payload[begin:end]
            put = await raw.put(
                part["upload_url"],
                content=chunk,
                headers=part.get("upload_headers") or {},
            )
            assert put.status_code in (200, 204), put.text
            etag = put.headers.get("etag") or put.headers.get("ETag")
            assert etag
            uploaded.append({"part_number": n, "etag": etag})

    complete = await client.post(
        f"/api/files/{body['file_id']}/complete",
        json={"parts": uploaded},
        headers=auth,
    )
    assert complete.status_code == 200, complete.text
    assert complete.json()["status"] == "ready"
    assert complete.json()["size_bytes"] == len(payload)

    dl = await client.get(f"/api/files/{body['file_id']}/download", headers=auth)
    assert dl.status_code == 200

    async with httpx.AsyncClient() as raw:
        got = await raw.get(dl.json()["download_url"])
        assert got.status_code == 200
        assert got.content == payload


@pytest.mark.asyncio
async def test_other_user_cannot_access(client, unique_email):
    owner_token = await _register_and_login(client, unique_email)
    other_email = unique_email.replace("user-", "other-")
    other_token = await _register_and_login(client, other_email)

    create = await client.post(
        "/api/files",
        json={"filename": "x.bin", "content_type": "application/octet-stream", "size_bytes": 0},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert create.status_code == 201
    file_id = create.json()["file_id"]

    r = await client.get(
        f"/api/files/{file_id}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_batch_create_mixed_put_and_multipart(client, unique_email, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "single_put_max_bytes", 100)
    part_size = 5 * 1024 * 1024
    monkeypatch.setattr(settings, "multipart_part_size_bytes", part_size)

    token = await _register_and_login(client, unique_email)
    auth = {"Authorization": f"Bearer {token}"}

    small_payload = b"small"
    large_size = part_size + 1

    batch = await client.post(
        "/api/files/batch",
        json={
            "items": [
                {
                    "filename": "small.txt",
                    "content_type": "text/plain",
                    "size_bytes": len(small_payload),
                },
                {
                    "filename": "large.bin",
                    "content_type": "application/octet-stream",
                    "size_bytes": large_size,
                },
            ],
        },
        headers=auth,
    )
    assert batch.status_code == 201, batch.text
    items = batch.json()["items"]
    assert len(items) == 2
    assert items[0]["upload_method"] == "PUT"
    assert items[0]["upload_url"]
    assert items[1]["upload_method"] == "multipart"
    assert items[1]["total_parts"] == 2
    assert items[1]["part_size_bytes"] == part_size


@pytest.mark.asyncio
async def test_batch_create_rejects_empty_items(client, unique_email):
    token = await _register_and_login(client, unique_email)
    auth = {"Authorization": f"Bearer {token}"}

    r = await client.post("/api/files/batch", json={"items": []}, headers=auth)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_batch_create_rejects_unsafe_filename(client, unique_email):
    token = await _register_and_login(client, unique_email)
    auth = {"Authorization": f"Bearer {token}"}

    r = await client.post(
        "/api/files/batch",
        json={
            "items": [
                {
                    "filename": "../evil.txt",
                    "content_type": "text/plain",
                    "size_bytes": 1,
                }
            ],
        },
        headers=auth,
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_batch_create_other_user_cannot_access(client, unique_email):
    owner_token = await _register_and_login(client, unique_email)
    other_email = unique_email.replace("user-", "other-batch-")
    other_token = await _register_and_login(client, other_email)

    batch = await client.post(
        "/api/files/batch",
        json={
            "items": [
                {
                    "filename": "owned.txt",
                    "content_type": "text/plain",
                    "size_bytes": 4,
                }
            ],
        },
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert batch.status_code == 201
    file_id = batch.json()["items"][0]["file_id"]

    r = await client.get(
        f"/api/files/{file_id}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert r.status_code == 404
