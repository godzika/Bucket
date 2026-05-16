import httpx
import pytest


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
