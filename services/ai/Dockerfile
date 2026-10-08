FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /service

COPY pyproject.toml uv.lock ./
COPY app ./app

RUN pip install --no-cache-dir uv==0.12.23 && uv sync --frozen --no-dev
RUN useradd --create-home --uid 10001 dentalai
USER dentalai

EXPOSE 8000

CMD ["/service/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
