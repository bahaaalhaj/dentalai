# DentalAI AI service

This FastAPI application reserves a separately deployable boundary for future validated inference.
It exposes only `GET /health`, which explicitly reports `inference_available: false`.

There is no inference endpoint, model loading, random output, or patient-care functionality in Phase 3.

For local development, create a Python 3.12+ environment, install this directory, and run the root
`npm run dev:ai` command.
