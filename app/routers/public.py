from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import ShareLink, StoredFile
from app.schemas import FileDownloadOut, PublicDownloadIn
from app.security import verify_password
from app.storage import presigned_get

router = APIRouter(prefix="/api/public", tags=["public"])


async def _resolve_share(token: str, db: AsyncSession) -> tuple[ShareLink, StoredFile]:
    result = await db.execute(select(ShareLink).where(ShareLink.token == token))
    share = result.scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")
    if share.expires_at is not None and share.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link expired")
    file_record = await db.get(StoredFile, share.file_id)
    if file_record is None or file_record.status != "ready":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not available")
    return share, file_record


@router.get("/{token}")
async def share_info(token: str, db: AsyncSession = Depends(get_db)) -> dict:
    share, file_record = await _resolve_share(token, db)
    return {
        "filename": file_record.original_filename,
        "content_type": file_record.content_type,
        "size_bytes": file_record.size_bytes,
        "password_protected": share.password_hash is not None,
        "expires_at": share.expires_at,
    }


@router.post("/{token}/download", response_model=FileDownloadOut)
async def share_download(
    token: str,
    payload: PublicDownloadIn | None = None,
    db: AsyncSession = Depends(get_db),
) -> FileDownloadOut:
    share, file_record = await _resolve_share(token, db)
    if share.password_hash is not None:
        provided = (payload.password if payload else None) or ""
        if not verify_password(provided, share.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password"
            )
    presigned = presigned_get(file_record.object_key, download_filename=file_record.original_filename)
    return FileDownloadOut(download_url=presigned["url"], expires_in=presigned["expires_in"])
