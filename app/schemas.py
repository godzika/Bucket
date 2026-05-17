import uuid
from datetime import datetime
from typing import Literal

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
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(ge=0)
    parent_folder_id: uuid.UUID | None = None

    @field_validator("filename")
    @classmethod
    def _normalize_filename(cls, v: str) -> str:
        v = v.strip().replace("\\", "/").lstrip("/")
        if not v or ".." in v.split("/"):
            raise ValueError("filename must be a safe basename")
        if "/" in v:
            raise ValueError("filename must be a single name, not a path")
        return v


class FileCreateOut(BaseModel):
    file_id: uuid.UUID
    object_key: str
    upload_method: Literal["PUT", "multipart"] = "PUT"
    upload_url: str = ""
    upload_headers: dict[str, str] = Field(default_factory=dict)
    expires_in: int
    part_size_bytes: int | None = None
    total_parts: int | None = None


class FileBatchCreateIn(BaseModel):
    items: list[FileCreateIn] = Field(min_length=1, max_length=50)


class FileBatchCreateOut(BaseModel):
    items: list[FileCreateOut]


class MultipartPartIn(BaseModel):
    part_number: int = Field(ge=1, le=10000)
    etag: str = Field(min_length=1, max_length=255)


class FileCompleteIn(BaseModel):
    parts: list[MultipartPartIn] = Field(default_factory=list)


class UploadPartsPresignIn(BaseModel):
    part_numbers: list[int] = Field(min_length=1)

    @field_validator("part_numbers")
    @classmethod
    def _validate_part_numbers(cls, values: list[int]) -> list[int]:
        if len(values) != len(set(values)):
            raise ValueError("part_numbers must be unique")
        for n in values:
            if n < 1 or n > 10000:
                raise ValueError("part_numbers must be between 1 and 10000")
        return values


class UploadPartPresignOut(BaseModel):
    part_number: int
    upload_url: str
    upload_headers: dict[str, str] = Field(default_factory=dict)


class UploadPartsPresignOut(BaseModel):
    parts: list[UploadPartPresignOut]
    expires_in: int


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    parent_folder_id: uuid.UUID | None
    original_filename: str
    content_type: str
    size_bytes: int
    status: str
    created_at: datetime
    expires_at: datetime | None


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    is_root: bool
    created_at: datetime


class BreadcrumbOut(BaseModel):
    id: uuid.UUID
    name: str
    is_root: bool


class FilesystemListOut(BaseModel):
    folder_id: uuid.UUID
    root_folder_id: uuid.UUID
    parent_folder_id: uuid.UUID | None
    breadcrumbs: list[BreadcrumbOut]
    folders: list[FolderOut]
    files: list[FileOut]


class FolderCreateIn(BaseModel):
    parent_folder_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v or v in (".", ".."):
            raise ValueError("invalid folder name")
        if "/" in v or "\\" in v:
            raise ValueError("folder name cannot contain path separators")
        return v


class FolderUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_folder_id: uuid.UUID | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v or v in (".", ".."):
            raise ValueError("invalid folder name")
        if "/" in v or "\\" in v:
            raise ValueError("folder name cannot contain path separators")
        return v


class FolderEnsurePathsIn(BaseModel):
    parent_folder_id: uuid.UUID | None = None
    paths: list[list[str]] = Field(min_length=1, max_length=200)

    @field_validator("paths")
    @classmethod
    def _validate_paths(cls, values: list[list[str]]) -> list[list[str]]:
        for segments in values:
            for segment in segments:
                normalize = segment.strip()
                if not normalize or normalize in (".", ".."):
                    raise ValueError("invalid path segment")
                if "/" in normalize or "\\" in normalize:
                    raise ValueError("path segments cannot contain separators")
        return values


class FolderEnsurePathsOut(BaseModel):
    folder_ids: list[uuid.UUID]


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
