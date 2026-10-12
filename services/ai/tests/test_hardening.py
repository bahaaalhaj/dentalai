from fastapi.testclient import TestClient
from app.main import create_app, service_token


def test_mounted_token_and_ambiguous_configuration(tmp_path, monkeypatch):
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    target = tmp_path / "token"
    target.write_text("t" * 32)
    monkeypatch.setenv("AI_SERVICE_TOKEN_FILE", str(target))
    assert service_token() == "t" * 32
    monkeypatch.setenv("AI_SERVICE_TOKEN", "other" * 10)
    assert service_token() == ""
    monkeypatch.delenv("AI_SERVICE_TOKEN")
    target.write_text("bad\nmultiline")
    assert service_token() == ""


def test_missing_model_is_live_but_not_ready_and_does_not_fabricate(monkeypatch):
    monkeypatch.delenv("AI_MODEL_MANIFEST", raising=False)
    monkeypatch.delenv("AI_SERVICE_TOKEN_FILE", raising=False)
    monkeypatch.setenv("AI_SERVICE_TOKEN", "t" * 32)
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/health").json()["inference_available"] is False
        assert client.get("/ready").status_code == 503
        response = client.post("/v1/infer", headers={"authorization": "Bearer " + "t" * 32, "content-type": "image/png"}, content=b"synthetic")
        assert response.status_code == 503
        assert "detections" not in response.json()
