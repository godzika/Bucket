import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    created_at: datetime


class FileCreateIn(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    content_type: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(ge=0)

    @field_validator("filename")
    @classmethod
    def _strip_filename(cls, v: str) -> str:
        v = v.strip().replace("\\", "/").split("/")[-1]
        if not v:
            raise ValueError("filename must not be empty")
        return v


class FileCreateOut(BaseModel):
    file_id: uuid.UUID
    object_key: str
    upload_url: str
    upload_method: str = "PUT"
    upload_headers: dict[str, str] = Field(default_factory=dict)
    expires_in: int


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    original_filename: str
    content_type: str
    size_bytes: int
    status: str
    created_at: datetime
    expires_at: datetime | None


class FileDownloadOut(BaseModel):
    download_url: str
    expires_in: int


class ShareCreateIn(BaseModel):
    expires_in_seconds: int | None = Field(default=None, ge=60, le=60 * 60 * 24 * 30)
    password: str | None = Field(default=None, min_length=4, max_length=128)


class ShareOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    token: str
    file_id: uuid.UUID
    expires_at: datetime | None
    password_protected: bool
    created_at: datetime


class PublicDownloadIn(BaseModel):
    password: str | None = None
