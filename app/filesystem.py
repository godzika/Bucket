"""Folder hierarchy helpers (Drive-style parent-folder model)."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Folder, StoredFile, User
from app.storage import abort_multipart_upload, delete_object

ROOT_DISPLAY_NAME = "My files"


def normalize_folder_name(name: str) -> str:
    name = name.strip()
    if not name or name in (".", ".."):
        raise ValueError("invalid folder name")
    if "/" in name or "\\" in name:
        raise ValueError("folder name cannot contain path separators")
    return name


def normalize_basename(filename: str) -> str:
    filename = filename.strip().replace("\\", "/").lstrip("/")
    if not filename or ".." in filename.split("/"):
        raise ValueError("filename must be a safe basename")
    if "/" in filename:
        raise ValueError("filename must be a single name, not a path")
    return filename


def folder_path_key(segments: Sequence[str]) -> str:
    return "/".join(normalize_folder_name(s) for s in segments)


async def get_user_root(db: AsyncSession, user_id: uuid.UUID) -> Folder:
    result = await db.execute(
        select(Folder).where(Folder.owner_id == user_id, Folder.is_root.is_(True))
    )
    root = result.scalar_one_or_none()
    if root is None:
        root = Folder(
            owner_id=user_id,
            parent_id=None,
            name=ROOT_DISPLAY_NAME,
            name_lower="",
            is_root=True,
        )
        db.add(root)
        await db.flush()
    return root


async def create_user_root(db: AsyncSession, user_id: uuid.UUID) -> Folder:
    root = Folder(
        owner_id=user_id,
        parent_id=None,
        name=ROOT_DISPLAY_NAME,
        name_lower="",
        is_root=True,
    )
    db.add(root)
    await db.flush()
    return root


async def get_owned_folder(
    db: AsyncSession,
    folder_id: uuid.UUID,
    user: User,
) -> Folder:
    folder = await db.get(Folder, folder_id)
    if folder is None or folder.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    return folder


async def resolve_parent_folder(
    db: AsyncSession,
    user: User,
    parent_folder_id: uuid.UUID | None,
) -> Folder:
    if parent_folder_id is None:
        return await get_user_root(db, user.id)
    return await get_owned_folder(db, parent_folder_id, user)


async def get_or_create_child(
    db: AsyncSession,
    owner_id: uuid.UUID,
    parent: Folder,
    name: str,
) -> Folder:
    if parent.is_root is False and parent.parent_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent folder")

    safe_name = normalize_folder_name(name)
    name_lower = safe_name.casefold()
    result = await db.execute(
        select(Folder).where(
            Folder.owner_id == owner_id,
            Folder.parent_id == parent.id,
            Folder.name_lower == name_lower,
            Folder.is_root.is_(False),
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing

    child = Folder(
        owner_id=owner_id,
        parent_id=parent.id,
        name=safe_name,
        name_lower=name_lower,
        is_root=False,
    )
    db.add(child)
    try:
        await db.flush()
    except IntegrityError:
        result = await db.execute(
            select(Folder).where(
                Folder.owner_id == owner_id,
                Folder.parent_id == parent.id,
                Folder.name_lower == name_lower,
                Folder.is_root.is_(False),
            )
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            return existing
        raise
    return child


async def ensure_folder_segments(
    db: AsyncSession,
    user: User,
    base_folder: Folder,
    segments: Sequence[str],
    cache: dict[tuple[uuid.UUID, str], uuid.UUID],
) -> uuid.UUID:
    current = base_folder
    for segment in segments:
        key = (current.id, normalize_folder_name(segment).casefold())
        cached_id = cache.get(key)
        if cached_id is not None:
            current = await get_owned_folder(db, cached_id, user)
            continue
        child = await get_or_create_child(db, user.id, current, segment)
        cache[key] = child.id
        current = child
    return current.id


async def ensure_folder_paths(
    db: AsyncSession,
    user: User,
    parent_folder_id: uuid.UUID | None,
    paths: list[list[str]],
) -> list[uuid.UUID]:
    base = await resolve_parent_folder(db, user, parent_folder_id)
    cache: dict[tuple[uuid.UUID, str], uuid.UUID] = {}
    folder_ids: list[uuid.UUID] = []
    for segments in paths:
        folder_ids.append(
            await ensure_folder_segments(db, user, base, segments, cache)
            if segments
            else base.id
        )
    await db.commit()
    return folder_ids


async def build_breadcrumbs(db: AsyncSession, folder: Folder) -> list[Folder]:
    chain: list[Folder] = []
    current: Folder | None = folder
    while current is not None:
        chain.append(current)
        if current.parent_id is None:
            break
        current = await db.get(Folder, current.parent_id)
    chain.reverse()
    return chain


async def is_descendant_folder(
    db: AsyncSession,
    ancestor_id: uuid.UUID,
    candidate_id: uuid.UUID,
) -> bool:
    current_id: uuid.UUID | None = candidate_id
    while current_id is not None:
        if current_id == ancestor_id:
            return True
        folder = await db.get(Folder, current_id)
        if folder is None:
            return False
        current_id = folder.parent_id
    return False


async def delete_folder_tree(db: AsyncSession, folder: Folder) -> None:
    if folder.is_root:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the root folder.",
        )

    folder_ids: list[uuid.UUID] = []

    async def collect(folder_id: uuid.UUID) -> None:
        folder_ids.append(folder_id)
        result = await db.execute(select(Folder.id).where(Folder.parent_id == folder_id))
        for child_id in result.scalars().all():
            await collect(child_id)

    await collect(folder.id)

    files_result = await db.execute(
        select(StoredFile).where(StoredFile.parent_folder_id.in_(folder_ids))
    )
    files = list(files_result.scalars().all())

    for record in files:
        object_key = record.object_key
        multipart_upload_id = record.multipart_upload_id
        await db.delete(record)
        if multipart_upload_id:
            try:
                abort_multipart_upload(object_key, multipart_upload_id)
            except Exception:
                pass
        else:
            try:
                delete_object(object_key)
            except Exception:
                pass

    await db.execute(delete(Folder).where(Folder.id.in_(folder_ids)))
    await db.commit()


async def count_folder_children(db: AsyncSession, folder_id: uuid.UUID) -> tuple[int, int]:
    subfolders = await db.scalar(
        select(func.count()).select_from(Folder).where(Folder.parent_id == folder_id)
    )
    files = await db.scalar(
        select(func.count()).select_from(StoredFile).where(StoredFile.parent_folder_id == folder_id)
    )
    return int(subfolders or 0), int(files or 0)
