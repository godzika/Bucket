"""End-to-end smoke test against the running stack from inside the api container.

Run with:
    docker compose exec api python scripts/smoke_test.py
"""
from __future__ import annotations

import os
import sys
import uuid

import httpx

API = os.environ.get("SMOKE_API", "http://localhost:8000")
EMAIL = f"smoke-{uuid.uuid4().hex[:8]}@example.com"
PASSWORD = "smoketest12345"
PAYLOAD = b"hello world from smoke test!"


def main() -> int:
    with httpx.Client(timeout=30.0) as c:
        r = c.get(f"{API}/health")
        print("health:", r.status_code, r.json())

        r = c.post(f"{API}/api/auth/register", json={"email": EMAIL, "password": PASSWORD})
        print("register:", r.status_code)
        assert r.status_code == 201, r.text

        r = c.post(
            f"{API}/api/auth/login",
            data={"username": EMAIL, "password": PASSWORD},
        )
        print("login:", r.status_code)
        token = r.json()["access_token"]
        auth = {"Authorization": f"Bearer {token}"}

        r = c.post(
            f"{API}/api/files",
            json={
                "filename": "smoke.txt",
                "content_type": "text/plain",
                "size_bytes": len(PAYLOAD),
            },
            headers=auth,
        )
        print("create:", r.status_code)
        assert r.status_code == 201, r.text
        body = r.json()

        put = c.put(
            body["upload_url"],
            content=PAYLOAD,
            headers=body["upload_headers"],
        )
        print("PUT minio:", put.status_code)
        assert put.status_code in (200, 204), put.text

        r = c.post(f"{API}/api/files/{body['file_id']}/complete", headers=auth)
        print("complete:", r.status_code, r.json().get("status"))
        assert r.status_code == 200

        r = c.get(f"{API}/api/files/{body['file_id']}/download", headers=auth)
        print("download url:", r.status_code)
        download_url = r.json()["download_url"]

        got = c.get(download_url)
        print("GET download:", got.status_code, "body=", got.text[:60])
        assert got.content == PAYLOAD

        r = c.post(
            f"{API}/api/files/{body['file_id']}/shares",
            json={"expires_in_seconds": 3600},
            headers=auth,
        )
        print("share create:", r.status_code)
        share_token = r.json()["token"]

        r = c.get(f"{API}/api/public/{share_token}")
        print("share info:", r.status_code, r.json())

        r = c.post(f"{API}/api/public/{share_token}/download", json={})
        print("public download url:", r.status_code)
        public_url = r.json()["download_url"]
        got = c.get(public_url)
        assert got.content == PAYLOAD
        print("public GET:", got.status_code, "body=", got.text[:60])

        r = c.delete(f"{API}/api/files/{body['file_id']}", headers=auth)
        print("delete:", r.status_code)
        assert r.status_code == 204

    print("\nALL SMOKE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
