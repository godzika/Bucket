import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.filesystem import resolve_parent_folder
from app.models import StoredFile, User
from app.schemas import (
    FileBatchCreateIn,
    FileBatchCreateOut,
    FileCompleteIn,
    FileCreateIn,
    FileCreateOut,
    FileDownloadOut,
    FileOut,
    UploadPartsPresignIn,
    UploadPartsPresignOut,
    UploadPartPresignOut,
)
from app.storage import (
    abort_multipart_upload,
    complete_multipart_upload,
    create_multipart_upload,
    delete_object,
    head_object,
    multipart_part_count,
    presigned_get,
    presigned_put,
    presigned_upload_part,
    resolve_public_endpoint_url,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/files", tags=["files"])


def _build_object_key(user_id: uuid.UUID, file_id: uuid.UUID, filename: str) -> str:
    return f"users/{user_id}/{file_id}/{filename}"


def _uses_multipart(size_bytes: int) -> bool:
    settings = get_settings()
    return size_bytes > settings.single_put_max_bytes


@router.post("", response_model=FileCreateOut, status_code=status.HTTP_201_CREATED)
async def create_file(
    payload: FileCreateIn,
    request: Request,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileCreateOut:
    settings = get_settings()
    if payload.size_bytes > settings.max_file_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum is {settings.max_file_bytes} bytes.",
        )

    multipart = _uses_multipart(payload.size_bytes)
    if multipart:
        part_count = multipart_part_count(payload.size_bytes, settings.multipart_part_size_bytes)
        if part_count > 10000:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="File too large: exceeds S3 multipart limit of 10000 parts.",
            )

    parent_folder = await resolve_parent_folder(db, current, payload.parent_folder_id)

    file_id = uuid.uuid4()
    object_key = _build_object_key(current.id, file_id, payload.filename)

    record = StoredFile(
        id=file_id,
        owner_id=current.id,
        parent_folder_id=parent_folder.id,
        object_key=object_key,
        original_filename=payload.filename,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        status="pending",
    )

    if multipart:
        upload_id = create_multipart_upload(
            object_key=object_key,
            content_type=payload.content_type,
        )
        record.multipart_upload_id = upload_id
        db.add(record)
        await db.commit()
        return FileCreateOut(
            file_id=file_id,
            object_key=object_key,
            upload_method="multipart",
            expires_in=settings.presign_put_ttl_seconds,
            part_size_bytes=settings.multipart_part_size_bytes,
            total_parts=part_count,
        )

    db.add(record)
    await db.commit()

    public_endpoint = resolve_public_endpoint_url(request)
    presigned = presigned_put(
        object_key=object_key,
        content_type=payload.content_type,
        public_endpoint_url=public_endpoint,
    )
    return FileCreateOut(
        file_id=file_id,
        object_key=object_key,
        upload_method="PUT",
        upload_url=presigned["url"],
        upload_headers=presigned["headers"],
        expires_in=presigned["expires_in"],
    )


@router.post("/batch", response_model=FileBatchCreateOut, status_code=status.HTTP_201_CREATED)
async def create_files_batch(
    payload: FileBatchCreateIn,
    request: Request,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileBatchCreateOut:
    settings = get_settings()
    public_endpoint = resolve_public_endpoint_url(request)

    records: list[StoredFile] = []
    multipart_meta: list[tuple[StoredFile, int]] = []
    parent_cache: dict[uuid.UUID | None, uuid.UUID] = {}

    for item in payload.items:
        if item.size_bytes > settings.max_file_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File too large. Maximum is {settings.max_file_bytes} bytes.",
            )

        multipart = _uses_multipart(item.size_bytes)
        part_count: int | None = None
        if multipart:
            part_count = multipart_part_count(item.size_bytes, settings.multipart_part_size_bytes)
            if part_count > 10000:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="File too large: exceeds S3 multipart limit of 10000 parts.",
                )

        cache_key = item.parent_folder_id
        if cache_key not in parent_cache:
            folder = await resolve_parent_folder(db, current, item.parent_folder_id)
            parent_cache[cache_key] = folder.id

        file_id = uuid.uuid4()
        object_key = _build_object_key(current.id, file_id, item.filename)
        record = StoredFile(
            id=file_id,
            owner_id=current.id,
            parent_folder_id=parent_cache[cache_key],
            object_key=object_key,
            original_filename=item.filename,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            status="pending",
        )
        records.append(record)

        if multipart and part_count is not None:
            multipart_meta.append((record, part_count))

    if multipart_meta:

        async def _start_multipart(rec: StoredFile) -> str:
            return await asyncio.to_thread(
                create_multipart_upload,
                object_key=rec.object_key,
                content_type=rec.content_type,
            )

        upload_ids = await asyncio.gather(
            *[_start_multipart(rec) for rec, _ in multipart_meta]
        )
        for (rec, _), upload_id in zip(multipart_meta, upload_ids, strict=True):
            rec.multipart_upload_id = upload_id

    db.add_all(records)
    await db.commit()

    outputs: list[FileCreateOut] = []
    multipart_by_id = {rec.id: part_count for rec, part_count in multipart_meta}

    for record in records:
        if record.multipart_upload_id is not None:
            part_count = multipart_by_id[record.id]
            outputs.append(
                FileCreateOut(
                    file_id=record.id,
                    object_key=record.object_key,
                    upload_method="multipart",
                    expires_in=settings.presign_put_ttl_seconds,
                    part_size_bytes=settings.multipart_part_size_bytes,
                    total_parts=part_count,
                )
            )
            continue

        presigned = presigned_put(
            object_key=record.object_key,
            content_type=record.content_type,
            public_endpoint_url=public_endpoint,
        )
        outputs.append(
            FileCreateOut(
                file_id=record.id,
                object_key=record.object_key,
                upload_method="PUT",
                upload_url=presigned["url"],
                upload_headers=presigned["headers"],
                expires_in=presigned["expires_in"],
            )
        )

    return FileBatchCreateOut(items=outputs)


async def _get_owned_file(file_id: uuid.UUID, user: User, db: AsyncSession) -> StoredFile:
    record = await db.get(StoredFile, file_id)
    if record is None or record.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return record


@router.post("/{file_id}/upload-parts", response_model=UploadPartsPresignOut)
async def presign_upload_parts(
    file_id: uuid.UUID,
    payload: UploadPartsPresignIn,
    request: Request,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UploadPartsPresignOut:
    settings = get_settings()
    record = await _get_owned_file(file_id, current, db)
    if record.multipart_upload_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="File upload is not multipart.",
        )
    if record.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Upload is no longer pending.",
        )
    if len(payload.part_numbers) > settings.multipart_part_presign_batch:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"At most {settings.multipart_part_presign_batch} part_numbers per request.",
        )

    expected_parts = multipart_part_count(record.size_bytes, settings.multipart_part_size_bytes)
    for part_number in payload.part_numbers:
        if part_number > expected_parts:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"part_number {part_number} exceeds total_parts ({expected_parts}).",
            )

    public_endpoint = resolve_public_endpoint_url(request)
    parts: list[UploadPartPresignOut] = []
    for part_number in sorted(payload.part_numbers):
        presigned = presigned_upload_part(
            object_key=record.object_key,
            upload_id=record.multipart_upload_id,
            part_number=part_number,
            public_endpoint_url=public_endpoint,
        )
        parts.append(
            UploadPartPresignOut(
                part_number=presigned["part_number"],
                upload_url=presigned["url"],
                upload_headers=presigned["headers"],
            )
        )
    return UploadPartsPresignOut(parts=parts, expires_in=settings.presign_put_ttl_seconds)


def _normalize_etag(etag: str) -> str:
    etag = etag.strip().strip('"')
    return f'"{etag}"'


def _validate_multipart_parts(record: StoredFile, parts: list) -> list[dict[str, object]]:
    settings = get_settings()
    expected = multipart_part_count(record.size_bytes, settings.multipart_part_size_bytes)
    if len(parts) != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Expected {expected} parts, got {len(parts)}.",
        )
    seen: set[int] = set()
    s3_parts: list[dict[str, object]] = []
    for part in parts:
        if part.part_number in seen:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Duplicate part_number in completion payload.",
            )
        seen.add(part.part_number)
        s3_parts.append(
            {
                "PartNumber": part.part_number,
                "ETag": _normalize_etag(part.etag),
            }
        )
    if seen != set(range(1, expected + 1)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="part_numbers must be exactly 1..total_parts.",
        )
    return s3_parts


@router.post("/{file_id}/complete", response_model=FileOut)
async def complete_upload(
    file_id: uuid.UUID,
    payload: FileCompleteIn = FileCompleteIn(),
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StoredFile:
    record = await _get_owned_file(file_id, current, db)
    settings = get_settings()

    if record.multipart_upload_id is not None:
        if not payload.parts:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Multipart uploads require a parts list with ETags.",
            )
        s3_parts = _validate_multipart_parts(record, payload.parts)
        upload_id = record.multipart_upload_id
        try:
            complete_multipart_upload(
                object_key=record.object_key,
                upload_id=upload_id,
                parts=s3_parts,
            )
        except Exception:
            try:
                abort_multipart_upload(record.object_key, upload_id)
            except Exception as abort_exc:  # pragma: no cover
                logger.warning("Failed to abort multipart upload %s: %s", upload_id, abort_exc)
            raise
        record.multipart_upload_id = None
    else:
        head = head_object(record.object_key)
        if head is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Upload not found in storage. Did the PUT succeed?",
            )
        actual_size = int(head.get("ContentLength", 0))
        if actual_size > settings.single_put_max_bytes:
            delete_object(record.object_key)
            await db.delete(record)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    f"Uploaded object exceeds single PUT limit ({settings.single_put_max_bytes} bytes). "
                    "Use multipart upload for larger files."
                ),
            )
        record.size_bytes = actual_size

    head = head_object(record.object_key)
    if head is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Upload not found in storage after completion.",
        )
    actual_size = int(head.get("ContentLength", 0))
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
    request: Request,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileDownloadOut:
    record = await _get_owned_file(file_id, current, db)
    if record.status != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="File is not ready yet. Call /complete after uploading.",
        )
    presigned = presigned_get(
        record.object_key,
        download_filename=record.original_filename,
        public_endpoint_url=resolve_public_endpoint_url(request),
    )
    return FileDownloadOut(download_url=presigned["url"], expires_in=presigned["expires_in"])


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    record = await _get_owned_file(file_id, current, db)
    object_key = record.object_key
    multipart_upload_id = record.multipart_upload_id

    await db.delete(record)
    await db.commit()

    if multipart_upload_id:
        try:
            abort_multipart_upload(object_key, multipart_upload_id)
        except Exception as exc:  # pragma: no cover
            logger.warning("Failed to abort multipart upload %s: %s", multipart_upload_id, exc)
        return

    try:
        delete_object(object_key)
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to delete object %s: %s", object_key, exc)
