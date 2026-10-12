"""Private endpoint; safe errors do not expose paths, patient data or tokens."""
import asyncio
import hmac
import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from .runtime import Runtime


def service_token():
    file = os.environ.get("AI_SERVICE_TOKEN_FILE")
    if file:
        if os.environ.get("AI_SERVICE_TOKEN"):
            return ""
        try:
            target = Path(file)
            if not target.is_absolute() or target.is_symlink() or target.stat().st_size > 1024:
                return ""
            value = target.read_text().strip()
            return value if not any(c in value for c in "\r\n\0") else ""
        except (OSError, ValueError):
            return ""
    return os.environ.get("AI_SERVICE_TOKEN", "")


def create_app(runtime_factory=Runtime):
    @asynccontextmanager
    async def lifespan(app):
        app.state.runtime = None
        app.state.lock = asyncio.Lock()
        path = os.environ.get("AI_MODEL_MANIFEST")
        if path and len(service_token()) >= 32:
            try:
                app.state.runtime = await run_in_threadpool(runtime_factory, path)
            except Exception:
                pass
        yield
        app.state.runtime = None

    app = FastAPI(title="DentalAI private experimental inference", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    async def health():
        return {"service": "ai", "status": "ok", "inference_available": app.state.runtime is not None}

    @app.get("/ready")
    async def ready():
        if app.state.runtime is None:
            raise HTTPException(503, "INFERENCE_UNAVAILABLE")
        return {"status": "ready"}

    @app.post("/v1/infer")
    async def infer(request: Request):
        token = service_token()
        if len(token) < 32 or not hmac.compare_digest(request.headers.get("authorization", "").encode('utf-8'), ("Bearer " + token).encode('utf-8')):
            raise HTTPException(401, "UNAUTHORIZED")
        if app.state.runtime is None:
            raise HTTPException(503, "INFERENCE_UNAVAILABLE")
        if request.headers.get("content-type") not in ("image/png", "image/jpeg"):
            raise HTTPException(415, "UNSUPPORTED_IMAGE")
        if app.state.lock.locked():
            raise HTTPException(503, "INFERENCE_BUSY")
        async with app.state.lock:
            data = bytearray()
            try:
                async with asyncio.timeout(15):
                    async for chunk in request.stream():
                        data.extend(chunk)
                        if len(data) > 10 * 1024 * 1024:
                            raise HTTPException(413, "IMAGE_TOO_LARGE")
            except TimeoutError:
                raise HTTPException(408, "UPLOAD_TIMEOUT") from None
            try:
                return await run_in_threadpool(app.state.runtime.infer, bytes(data))
            except Exception:
                raise HTTPException(503, "INFERENCE_FAILED") from None
    return app


app = create_app()
