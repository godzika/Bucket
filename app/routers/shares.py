import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user, get_owned_file
from app.models import ShareLink, StoredFile, User
from app.schemas import ShareCreateIn, ShareOut
from app.security import hash_password

router = APIRouter(prefix="/api/files/{file_id}/shares", tags=["shares"])


def _new_token() -> str:
    return secrets.token_urlsafe(24)


def _to_share_out(share: ShareLink) -> ShareOut:
    return ShareOut(
        token=share.token,
        file_id=share.file_id,
        expires_at=share.expires_at,
        password_protected=share.password_hash is not None,
        created_at=share.created_at,
    )



@router.post("", response_model=ShareOut, status_code=status.HTTP_201_CREATED)
async def create_share(
    file_id: uuid.UUID,
    payload: ShareCreateIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ShareOut:
    file_record = await get_owned_file(file_id, current, db)
    if file_record.status != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot share a file that is not ready.",
        )
    expires_at: datetime | None = None
    if payload.expires_in_seconds:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=payload.expires_in_seconds)
    share = ShareLink(
        token=_new_token(),
        file_id=file_record.id,
        expires_at=expires_at,
        password_hash=hash_password(payload.password) if payload.password else None,
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    return _to_share_out(share)


@router.get("", response_model=list[ShareOut])
async def list_shares(
    file_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ShareOut]:
    await get_owned_file(file_id, current, db)
    result = await db.execute(
        select(ShareLink)
        .where(ShareLink.file_id == file_id)
        .order_by(ShareLink.created_at.desc())
    )
    return [_to_share_out(s) for s in result.scalars().all()]


@router.delete("/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_share(
    file_id: uuid.UUID,
    token: str,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await get_owned_file(file_id, current, db)
    result = await db.execute(
        select(ShareLink).where(ShareLink.file_id == file_id, ShareLink.token == token)
    )
    share = result.scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")
    await db.delete(share)
    await db.commit()
