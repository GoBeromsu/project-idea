from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["service"] == "project-idea"
    assert res.json()["model"] == "gemini-4-argon"

def test_get_state():
    res = client.get("/api/state")
    assert res.status_code == 200
    data = res.json()
    assert "concepts" in data
    assert len(data["concepts"]) >= 5
    assert "relations" in data

def test_approve_reject_flow():
    # Reset
    res = client.post("/api/reset")
    assert res.status_code == 200

    # Non-existent changeset
    res = client.post("/api/changesets/nonexistent/approve")
    assert res.status_code == 404
