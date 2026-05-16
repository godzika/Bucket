import pytest


@pytest.mark.asyncio
async def test_register_login_me(client, unique_email):
    password = "supersecret123"

    r = await client.post(
        "/api/auth/register",
        json={"email": unique_email, "password": password},
    )
    assert r.status_code == 201, r.text
    user = r.json()
    assert user["email"] == unique_email

    r = await client.post(
        "/api/auth/login",
        data={"username": unique_email, "password": password},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]

    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["email"] == unique_email


@pytest.mark.asyncio
async def test_register_duplicate(client, unique_email):
    payload = {"email": unique_email, "password": "anothersecret1"}
    r1 = await client.post("/api/auth/register", json=payload)
    assert r1.status_code == 201

    r2 = await client.post("/api/auth/register", json=payload)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_login_invalid(client, unique_email):
    await client.post(
        "/api/auth/register",
        json={"email": unique_email, "password": "thispassword1"},
    )
    r = await client.post(
        "/api/auth/login",
        data={"username": unique_email, "password": "wrongpassword"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_auth(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401
