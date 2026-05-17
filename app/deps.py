import uuid

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import StoredFile, User
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=True)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        sub = payload.get("sub")
        if not sub:
            raise credentials_exception
        user_id = uuid.UUID(sub)
    except (jwt.PyJWTError, ValueError):
        raise credentials_exception

    user = await db.get(User, user_id)
    if user is None:
        raise credentials_exception
    return user


async def get_owned_file(
    file_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> StoredFile:
    """Fetch a file record and verify ownership. Shared across routers."""
    record = await db.get(StoredFile, file_id)
    if record is None or record.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return record


async def _user_or_none(token: str | None, db: AsyncSession) -> User | None:
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        sub = payload.get("sub")
        if not sub:
            return None
        return await db.get(User, uuid.UUID(sub))
    except Exception:
        return None
