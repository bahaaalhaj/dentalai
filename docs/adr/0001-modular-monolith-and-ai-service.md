# ADR 0001: Modular monolith with a separate inference-service boundary

- Status: Accepted
- Date: 2026-10-06

## Context

This context records the Phase 3 baseline at the decision date, not current deployment setup.
See [Phase 12](../phase12-test-data-reset.md) for the completed local-runtime retirement/reset.

DentalAI is currently one small product with tightly related clinic workflows and a direct Supabase
integration. Splitting each capability into a network service now would add deployment, observability,
versioning, authentication, and failure-mode complexity before stable service boundaries exist.

Machine-learning inference has different runtime dependencies, scaling characteristics, artifact
controls, and clinical-validation requirements from the TypeScript application. It needs a clear
boundary even before inference is implemented.

## Decision

Use an npm-workspace modular monolith for the web application, Express API, contracts, domain rules, and
shared UI. Keep dependencies directional and modules independently testable, but deploy the TypeScript
application as one unit for now.

Reserve a separate FastAPI service for future validated inference. In Phase 3 it exposes health only:
there is no model loading, inference endpoint, simulated result, or automatic fallback.

## Consequences

- Local development and deployments remain understandable and inexpensive.
- Domain and transport boundaries can mature before any extraction into services.
- Clinical inference can later use Python tooling and separate operational controls without coupling it
  to the web runtime.
- A network call and a reviewed versioned contract will eventually be required for inference.
- New microservices require a future ADR supported by measured scaling, ownership, security, or
  reliability needs. Redis, Kubernetes, and message brokers are intentionally absent.
