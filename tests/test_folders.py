import uuid

import pytest

from app import filesystem as filesystem_module
from app.models import Folder, StoredFile


class _ScalarResult:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class _Result:
    def __init__(self, *, scalars=None, rows=None):
        self._scalars = scalars or []
        self._rows = rows or []

    def scalars(self):
        return _ScalarResult(self._scalars)

    def all(self):
        return self._rows


class _CommitFailingDb:
    def __init__(self, files):
        self.files = files
        self.deleted = []
        self.execute_count = 0

    async def execute(self, _stmt):
        self.execute_count += 1
        if self.execute_count == 1:
            return _Result(scalars=self.files)
        return _Result()

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        raise RuntimeError("commit failed")


async def _register_and_login(client, email: str, password: str = "secret12345") -> str:
    await client.post("/api/auth/register", json={"email": email, "password": password})
    r = await client.post(
        "/api/auth/login",
        data={"username": email, "password": password},
    )
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_delete_folder_tree_does_not_delete_storage_before_commit(monkeypatch):
    owner_id = uuid.uuid4()
    folder_id = uuid.uuid4()
    folder = Folder(
        id=folder_id,
        owner_id=owner_id,
        parent_id=uuid.uuid4(),
        name="temp",
        name_lower="temp",
        is_root=False,
    )
    file_record = StoredFile(
        id=uuid.uuid4(),
        owner_id=owner_id,
        parent_folder_id=folder_id,
        object_key="users/test/file.txt",
        original_filename="file.txt",
        content_type="text/plain",
        size_bytes=1,
        status="ready",
    )
    db = _CommitFailingDb([file_record])
    deleted_objects = []

    async def collect_folder_ids(_db, root_id):
        return [root_id]

    def delete_object(object_key):
        deleted_objects.append(object_key)

    monkeypatch.setattr(filesystem_module, "_collect_folder_ids_cte", collect_folder_ids)
    monkeypatch.setattr(filesystem_module, "delete_object", delete_object)

    with pytest.raises(RuntimeError, match="commit failed"):
        await filesystem_module.delete_folder_tree(db, folder)

    assert db.deleted == [file_record]
    assert deleted_objects == []


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
