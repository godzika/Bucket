import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.models import StoredFile, User
from app.schemas import FileCreateIn, FileCreateOut, FileDownloadOut, FileOut
from app.storage import delete_object, head_object, presigned_get, presigned_put

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/files", tags=["files"])


def _build_object_key(user_id: uuid.UUID, file_id: uuid.UUID, filename: str) -> str:
    return f"users/{user_id}/{file_id}/{filename}"


@router.post("", response_model=FileCreateOut, status_code=status.HTTP_201_CREATED)
async def create_file(
    payload: FileCreateIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileCreateOut:
    settings = get_settings()
    if payload.size_bytes > settings.max_file_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum is {settings.max_file_bytes} bytes.",
        )

    file_id = uuid.uuid4()
    object_key = _build_object_key(current.id, file_id, payload.filename)

    record = StoredFile(
        id=file_id,
        owner_id=current.id,
        object_key=object_key,
        original_filename=payload.filename,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        status="pending",
    )
    db.add(record)
    await db.commit()

    presigned = presigned_put(
        object_key=object_key,
        content_type=payload.content_type,
    )
    return FileCreateOut(
        file_id=file_id,
        object_key=object_key,
        upload_url=presigned["url"],
        upload_headers=presigned["headers"],
        expires_in=presigned["expires_in"],
    )


async def _get_owned_file(file_id: uuid.UUID, user: User, db: AsyncSession) -> StoredFile:
    record = await db.get(StoredFile, file_id)
    if record is None or record.owner_id != user.id:
        # Hide existence from non-owners.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return record


@router.post("/{file_id}/complete", response_model=FileOut)
async def complete_upload(
    file_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StoredFile:
    record = await _get_owned_file(file_id, current, db)
    head = head_object(record.object_key)
    if head is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Upload not found in storage. Did the PUT succeed?",
        )
    actual_size = int(head.get("ContentLength", 0))
    settings = get_settings()
    if actual_size > settings.max_file_bytes:
        delete_object(record.object_key)
        await db.delete(record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Uploaded object exceeds the configured size limit.",
        )
    record.size_bytes = actual_size
    record.status = "ready"
    await db.commit()
    await db.refresh(record)
    return record


@router.get("", response_model=list[FileOut])
async def list_files(
    limit: int = 50,
    offset: int = 0,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[StoredFile]:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    result = await db.execute(
        select(StoredFile)
        .where(StoredFile.owner_id == current.id)
        .order_by(StoredFile.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


@router.get("/{file_id}", response_model=FileOut)
async def get_file(
    file_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StoredFile:
    return await _get_owned_file(file_id, current, db)


@router.get("/{file_id}/download", response_model=FileDownloadOut)
async def download_file(
    file_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileDownloadOut:
    record = await _get_owned_file(file_id, current, db)
    if record.status != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="File is not ready yet. Call /complete after uploading.",
        )
    presigned = presigned_get(record.object_key, download_filename=record.original_filename)
    return FileDownloadOut(download_url=presigned["url"], expires_in=presigned["expires_in"])


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    record = await _get_owned_file(file_id, current, db)
    object_key = record.object_key

    # Delete the DB row first so a failed S3 delete leaves at most an orphan
    # object (recoverable via background sweep) rather than an orphan DB row
    # pointing at nothing.
    await db.delete(record)
    await db.commit()

    try:
        delete_object(object_key)
    except Exception as exc:  # pragma: no cover - best-effort cleanup
        logger.warning("Failed to delete object %s: %s", object_key, exc)
