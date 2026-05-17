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
async def test_filesystem_list_root_and_create_folder(client, unique_email):
    token = await _register_and_login(client, unique_email)
    auth = {"Authorization": f"Bearer {token}"}

    root = await client.get("/api/filesystem/root", headers=auth)
    assert root.status_code == 200, root.text
    root_id = root.json()["id"]
    assert root.json()["is_root"] is True

    listing = await client.get("/api/filesystem", headers=auth)
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert body["folder_id"] == root_id
    assert body["root_folder_id"] == root_id
    assert len(body["breadcrumbs"]) == 1

    create = await client.post(
        "/api/filesystem/folders",
        json={"parent_folder_id": root_id, "name": "Projects"},
        headers=auth,
    )
    assert create.status_code == 201, create.text
    folder_id = create.json()["id"]

    listing2 = await client.get("/api/filesystem", params={"folder_id": root_id}, headers=auth)
    assert listing2.status_code == 200
    assert len(listing2.json()["folders"]) == 1
    assert listing2.json()["folders"][0]["name"] == "Projects"

    nested = await client.get(
        "/api/filesystem", params={"folder_id": folder_id}, headers=auth
    )
    assert nested.status_code == 200
    assert nested.json()["parent_folder_id"] == root_id


@pytest.mark.asyncio
async def test_ensure_paths_and_batch_upload_placement(client, unique_email):
    token = await _register_and_login(client, unique_email)
    auth = {"Authorization": f"Bearer {token}"}

    root = await client.get("/api/filesystem/root", headers=auth)
    root_id = root.json()["id"]

    ensure = await client.post(
        "/api/filesystem/folders/ensure-paths",
        json={"parent_folder_id": root_id, "paths": [["docs"], []]},
        headers=auth,
    )
    assert ensure.status_code == 200, ensure.text
    folder_ids = ensure.json()["folder_ids"]
    assert len(folder_ids) == 2

    batch = await client.post(
        "/api/files/batch",
        json={
            "items": [
                {
                    "filename": "readme.txt",
                    "parent_folder_id": folder_ids[0],
                    "content_type": "text/plain",
                    "size_bytes": 5,
                },
                {
                    "filename": "root.txt",
                    "parent_folder_id": folder_ids[1],
                    "content_type": "text/plain",
                    "size_bytes": 4,
                },
            ],
        },
        headers=auth,
    )
    assert batch.status_code == 201, batch.text

    docs_listing = await client.get(
        "/api/filesystem", params={"folder_id": folder_ids[0]}, headers=auth
    )
    assert docs_listing.status_code == 200
    assert len(docs_listing.json()["files"]) == 1
    assert docs_listing.json()["files"][0]["original_filename"] == "readme.txt"
    assert "/" not in docs_listing.json()["files"][0]["original_filename"]


@pytest.mark.asyncio
async def test_folder_name_collision(client, unique_email):
    token = await _register_and_login(client, unique_email)
    auth = {"Authorization": f"Bearer {token}"}
    root_id = (await client.get("/api/filesystem/root", headers=auth)).json()["id"]

    first = await client.post(
        "/api/filesystem/folders",
        json={"parent_folder_id": root_id, "name": "dup"},
        headers=auth,
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/filesystem/folders",
        json={"parent_folder_id": root_id, "name": "dup"},
        headers=auth,
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_other_user_cannot_list_folder(client, unique_email):
    owner_token = await _register_and_login(client, unique_email)
    other_email = unique_email.replace("user-", "other-fs-")
    other_token = await _register_and_login(client, other_email)

    create = await client.post(
        "/api/filesystem/folders",
        json={"name": "private"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert create.status_code == 201
    folder_id = create.json()["id"]

    r = await client.get(
        "/api/filesystem",
        params={"folder_id": folder_id},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_folder_cascade(client, unique_email):
    token = await _register_and_login(client, unique_email)
    auth = {"Authorization": f"Bearer {token}"}
    root_id = (await client.get("/api/filesystem/root", headers=auth)).json()["id"]

    folder = await client.post(
        "/api/filesystem/folders",
        json={"parent_folder_id": root_id, "name": "temp"},
        headers=auth,
    )
    folder_id = folder.json()["id"]

    create = await client.post(
        "/api/files",
        json={
            "filename": "x.txt",
            "parent_folder_id": folder_id,
            "content_type": "text/plain",
            "size_bytes": 1,
        },
        headers=auth,
    )
    assert create.status_code == 201

    delete = await client.delete(f"/api/filesystem/folders/{folder_id}", headers=auth)
    assert delete.status_code == 204

    listing = await client.get(
        "/api/filesystem", params={"folder_id": folder_id}, headers=auth
    )
    assert listing.status_code == 404
