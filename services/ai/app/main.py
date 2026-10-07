from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel


class HealthResponse(BaseModel):
    service: Literal["ai"] = "ai"
    status: Literal["ok"] = "ok"
    inference_available: Literal[False] = False


app = FastAPI(
    title="DentalAI AI Service",
    description="Reserved service boundary. No inference endpoint is available.",
    version="0.0.0",
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()
