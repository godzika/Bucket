import logging
from functools import lru_cache
from typing import Any
from urllib.parse import quote, urlparse

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from starlette.requests import Request

from app.config import get_settings

logger = logging.getLogger(__name__)


def _build_client(endpoint_url: str):
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


@lru_cache(maxsize=1)
def get_internal_s3():
    """S3 client used by the API for server-side ops (HEAD, DELETE, ensure bucket)."""
    return _build_client(get_settings().s3_endpoint_url)


@lru_cache(maxsize=1)
def get_public_s3():
    """S3 client used to generate presigned URLs that browsers/clients can reach."""
    return _build_client(get_settings().s3_public_endpoint_url)


def resolve_public_endpoint_url(request: Request | None = None) -> str:
    """Presigned SigV4 URLs must use the same host the browser will PUT/GET to.

    Prefer the request ``Origin`` (or ``Referer``) so ``localhost:5173`` and a LAN
    IP in ``S3_PUBLIC_ENDPOINT_URL`` both work without manual env changes.
    """
    settings = get_settings()
    if request is not None:
        origin = request.headers.get("origin")
        if not origin:
            referer = request.headers.get("referer")
            if referer:
                parsed = urlparse(referer)
                if parsed.scheme and parsed.netloc:
                    origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin:
            return origin.rstrip("/")
    return settings.s3_public_endpoint_url.rstrip("/")


def _public_s3_for_endpoint(public_endpoint_url: str | None = None):
    endpoint = public_endpoint_url or get_settings().s3_public_endpoint_url
    return _build_client(endpoint)


def ensure_bucket() -> None:
    settings = get_settings()
    s3 = get_internal_s3()
    try:
        s3.head_bucket(Bucket=settings.s3_bucket)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchBucket", "NoSuchBucketPolicy"):
            logger.info("Creating bucket %s", settings.s3_bucket)
            s3.create_bucket(Bucket=settings.s3_bucket)
        else:
            raise


def presigned_put(
    object_key: str,
    content_type: str,
    *,
    public_endpoint_url: str | None = None,
) -> dict[str, Any]:
    """Generate a presigned URL that lets a client PUT a single object.

    The Content-Type header is part of the signature, so the client MUST send
    exactly the same Content-Type. Size is not bound here; we validate it
    server-side via HEAD when the client calls /complete.
    """
    settings = get_settings()
    s3 = _public_s3_for_endpoint(public_endpoint_url)
    params: dict[str, Any] = {
        "Bucket": settings.s3_bucket,
        "Key": object_key,
        "ContentType": content_type,
    }
    url = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params=params,
        ExpiresIn=settings.presign_put_ttl_seconds,
        HttpMethod="PUT",
    )
    headers = {"Content-Type": content_type}
    return {
        "url": url,
        "headers": headers,
        "expires_in": settings.presign_put_ttl_seconds,
    }


def _content_disposition(filename: str) -> str:
    """Build an RFC 5987-compatible Content-Disposition header.

    Falls back to an ASCII-only filename for legacy clients and provides
    ``filename*=UTF-8''<percent-encoded>`` for modern ones.
    """
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or "download"
    ascii_fallback = ascii_fallback.replace('"', "").replace("\\", "")
    encoded = quote(filename.encode("utf-8"), safe="")
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}"


def presigned_get(
    object_key: str,
    download_filename: str | None = None,
    *,
    public_endpoint_url: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    s3 = _public_s3_for_endpoint(public_endpoint_url)
    params: dict[str, Any] = {
        "Bucket": settings.s3_bucket,
        "Key": object_key,
    }
    if download_filename:
        params["ResponseContentDisposition"] = _content_disposition(download_filename)
    url = s3.generate_presigned_url(
        ClientMethod="get_object",
        Params=params,
        ExpiresIn=settings.presign_get_ttl_seconds,
        HttpMethod="GET",
    )
    return {"url": url, "expires_in": settings.presign_get_ttl_seconds}


def head_object(object_key: str) -> dict[str, Any] | None:
    settings = get_settings()
    s3 = get_internal_s3()
    try:
        return s3.head_object(Bucket=settings.s3_bucket, Key=object_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def delete_object(object_key: str) -> None:
    settings = get_settings()
    s3 = get_internal_s3()
    s3.delete_object(Bucket=settings.s3_bucket, Key=object_key)


def multipart_part_count(size_bytes: int, part_size_bytes: int) -> int:
    return (size_bytes + part_size_bytes - 1) // part_size_bytes


def create_multipart_upload(object_key: str, content_type: str) -> str:
    settings = get_settings()
    s3 = get_internal_s3()
    resp = s3.create_multipart_upload(
        Bucket=settings.s3_bucket,
        Key=object_key,
        ContentType=content_type,
    )
    return resp["UploadId"]


def presigned_upload_part(
    object_key: str,
    upload_id: str,
    part_number: int,
    *,
    public_endpoint_url: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    s3 = _public_s3_for_endpoint(public_endpoint_url)
    url = s3.generate_presigned_url(
        ClientMethod="upload_part",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": object_key,
            "UploadId": upload_id,
            "PartNumber": part_number,
        },
        ExpiresIn=settings.presign_put_ttl_seconds,
        HttpMethod="PUT",
    )
    return {
        "part_number": part_number,
        "url": url,
        "headers": {},
        "expires_in": settings.presign_put_ttl_seconds,
    }


def complete_multipart_upload(
    object_key: str,
    upload_id: str,
    parts: list[dict[str, Any]],
) -> None:
    settings = get_settings()
    s3 = get_internal_s3()
    s3.complete_multipart_upload(
        Bucket=settings.s3_bucket,
        Key=object_key,
        UploadId=upload_id,
        MultipartUpload={"Parts": sorted(parts, key=lambda p: p["PartNumber"])},
    )


def abort_multipart_upload(object_key: str, upload_id: str) -> None:
    settings = get_settings()
    s3 = get_internal_s3()
    try:
        s3.abort_multipart_upload(
            Bucket=settings.s3_bucket,
            Key=object_key,
            UploadId=upload_id,
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code not in ("NoSuchUpload", "404"):
            raise
