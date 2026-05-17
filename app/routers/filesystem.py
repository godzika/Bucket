import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.filesystem import (
    ROOT_DISPLAY_NAME,
    build_breadcrumbs,
    delete_folder_tree,
    ensure_folder_paths,
    get_owned_folder,
    get_user_root,
    is_descendant_folder,
    normalize_folder_name,
    resolve_parent_folder,
)
from app.models import Folder, StoredFile, User
from app.schemas import (
    BreadcrumbOut,
    FilesystemListOut,
    FileOut,
    FolderCreateIn,
    FolderEnsurePathsIn,
    FolderEnsurePathsOut,
    FolderOut,
    FolderUpdateIn,
)

router = APIRouter(prefix="/api/filesystem", tags=["filesystem"])


def _folder_out(folder: Folder) -> FolderOut:
    return FolderOut(
        id=folder.id,
        parent_id=folder.parent_id,
        name=ROOT_DISPLAY_NAME if folder.is_root else folder.name,
        is_root=folder.is_root,
        created_at=folder.created_at,
    )


@router.get("", response_model=FilesystemListOut)
async def list_filesystem(
    folder_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FilesystemListOut:
    root = await get_user_root(db, current.id)
    current_folder = await resolve_parent_folder(db, current, folder_id)

    folders_result = await db.execute(
        select(Folder)
        .where(Folder.owner_id == current.id, Folder.parent_id == current_folder.id)
        .order_by(Folder.is_root.desc(), Folder.name_lower.asc())
        .limit(limit)
    )
    child_folders = [f for f in folders_result.scalars().all() if not f.is_root]

    files_result = await db.execute(
        select(StoredFile)
        .where(
            StoredFile.owner_id == current.id,
            StoredFile.parent_folder_id == current_folder.id,
        )
        .order_by(StoredFile.created_at.desc())
        .limit(limit)
    )
    files = list(files_result.scalars().all())

    crumbs = await build_breadcrumbs(db, current_folder)
    parent_id = None if current_folder.is_root else current_folder.parent_id

    return FilesystemListOut(
        folder_id=current_folder.id,
        root_folder_id=root.id,
        parent_folder_id=parent_id,
        breadcrumbs=[
            BreadcrumbOut(
                id=f.id,
                name=ROOT_DISPLAY_NAME if f.is_root else f.name,
                is_root=f.is_root,
            )
            for f in crumbs
        ],
        folders=[_folder_out(f) for f in child_folders],
        files=list(files),
    )


@router.get("/root", response_model=FolderOut)
async def get_root_folder(
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Folder:
    return await get_user_root(db, current.id)


@router.post("/folders", response_model=FolderOut, status_code=status.HTTP_201_CREATED)
async def create_folder(
    payload: FolderCreateIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Folder:
    parent = await resolve_parent_folder(db, current, payload.parent_folder_id)
    safe_name = normalize_folder_name(payload.name)
    name_lower = safe_name.casefold()
    existing = await db.execute(
        select(Folder).where(
            Folder.owner_id == current.id,
            Folder.parent_id == parent.id,
            Folder.name_lower == name_lower,
            Folder.is_root.is_(False),
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A folder named '{safe_name}' already exists here.",
        )

    folder = Folder(
        owner_id=current.id,
        parent_id=parent.id,
        name=safe_name,
        name_lower=name_lower,
        is_root=False,
    )
    db.add(folder)
    try:
        await db.commit()
        await db.refresh(folder)
        return folder
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A folder named '{safe_name}' already exists here.",
        ) from exc


@router.patch("/folders/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: uuid.UUID,
    payload: FolderUpdateIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Folder:
    folder = await get_owned_folder(db, folder_id, current)
    if folder.is_root:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify the root folder.",
        )

    if payload.name is not None:
        folder.name = normalize_folder_name(payload.name)
        folder.name_lower = folder.name.casefold()

    if payload.parent_folder_id is not None:
        if payload.parent_folder_id == folder.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder cannot be its own parent.",
            )
        if await is_descendant_folder(db, folder.id, payload.parent_folder_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot move a folder into its own descendant.",
            )
        new_parent = await get_owned_folder(db, payload.parent_folder_id, current)
        folder.parent_id = new_parent.id

    try:
        await db.commit()
        await db.refresh(folder)
        return folder
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A folder with that name already exists in the destination.",
        ) from exc


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    folder = await get_owned_folder(db, folder_id, current)
    await delete_folder_tree(db, folder)


@router.post("/folders/ensure-paths", response_model=FolderEnsurePathsOut)
async def ensure_paths(
    payload: FolderEnsurePathsIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderEnsurePathsOut:
    folder_ids = await ensure_folder_paths(
        db, current, payload.parent_folder_id, payload.paths
    )
    return FolderEnsurePathsOut(folder_ids=folder_ids)
