"""Filename / Content-Disposition sanitization (no live MinIO required)."""

import pytest
from pydantic import ValidationError

from app.schemas import FileCreateIn
from app.storage import _content_disposition


def _minimal_file(**overrides) -> FileCreateIn:
    payload = {
        "filename": "ok.txt",
        "content_type": "text/plain",
        "size_bytes": 1,
    }
    payload.update(overrides)
    return FileCreateIn(**payload)


def test_content_disposition_strips_embedded_crlf() -> None:
    header = _content_disposition("report\r\n.html")
    assert "\r" not in header
    assert "\n" not in header
    assert header.startswith("attachment;")
    assert 'filename="report.html"' in header


def test_content_disposition_strips_nul_and_quotes() -> None:
    header = _content_disposition('evil\x00"name".txt')
    assert "\x00" not in header
    assert 'filename="evilname.txt"' in header
    assert header.startswith("attachment;")


def test_content_disposition_control_only_filename_falls_back() -> None:
    header = _content_disposition("\n\r")
    assert header.startswith("attachment;")
    assert 'filename="download"' in header
    assert "\r" not in header and "\n" not in header


def test_file_create_rejects_embedded_newline() -> None:
    with pytest.raises(ValidationError):
        _minimal_file(filename="photo\n.html", content_type="text/html")


def test_file_create_rejects_embedded_cr() -> None:
    with pytest.raises(ValidationError):
        _minimal_file(filename="photo\r.html")


def test_file_create_rejects_nul() -> None:
    with pytest.raises(ValidationError):
        _minimal_file(filename="photo\x00.html")


def test_file_create_accepts_normal_unicode_filename() -> None:
    created = _minimal_file(filename="фото.png")
    assert created.filename == "фото.png"
