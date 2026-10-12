# Phase 14 threat model and scoped ASVS review

Checkpoint: `4557897` (Phase 13). No deployment or clinical approval is implied.
Review basis: [OWASP ASVS 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0/5.0),
not an ASVS certification or a complete Level 2 assessment.

Trust boundaries: untrusted browser → HTTPS reverse proxy → Express domain services →
PostgreSQL/private storage; private API → separately authenticated Python inference;
operator-only migration/backup identities → protected host and off-host backup custody.
Authentication identities are global; clinical membership and every resource authorization are
tenant-scoped. Clinical/financial audit evidence is sensitive and is not ordinary application logging.

| Threat                               | Controls and evidence                                                                                                                                                                                                         | Residual risk / release decision                                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant access and IDOR         | Live membership/resource checks, composite tenant FKs, strict contracts; scheduling/clinical/billing/imaging/admin negative integration suites and Phase 14 adversarial requests                                              | Application DB identity can read multiple tenants; this is not per-tenant database RLS. Independent penetration testing remains required before real-patient hosting.                          |
| Account takeover                     | Maintained Better Auth hashing, verification/reset, DB-backed login throttles, opaque sessions, secure cookies, CSRF, revocation and current membership checks                                                                | MFA and local breached/common-password blocklist are not implemented. No ASVS Level 2 authentication claim; real-patient production release blocked pending security-owner review/remediation. |
| Malicious upload / denial of service | Authenticate and tenant-check before decode; MIME/magic/dimension limits, 10 MiB cap, canonical re-encoding, immutable private files; plan storage quota, imaging/API throttles, proxy/Node timeouts, container resource caps | Per-process API limiter is for one replica only. Multi-replica deployment is not approved. Large malicious-image/fuzz campaigns and VPS capacity qualification remain pending.                 |
| Inference abuse                      | No public AI port in pilot overlay; mounted bearer secret, size/time/concurrency limits, CPU/memory caps, missing-model 503                                                                                                   | Runtime inference can finish after an API client disconnects. Do not enable without model provenance/evaluation and clinical authorization.                                                    |
| Audit tampering                      | Append-only triggers, no app ownership/schema CREATE, runtime identity check, explicit revoke UPDATE/DELETE/TRUNCATE on audit/ledger/revisions                                                                                | A DB/host administrator can alter history. Immutable off-host audit custody and retention/legal review remain required; no tamper-proof claim.                                                 |
| Secret/clinical log exposure         | Structured allowlisted operational fields; no URL, query, headers, bodies, exception stacks or patient/tenant IDs; protected monitoring endpoint; log privacy regression test                                                 | Operators must protect Docker/system logs, telemetry access and retention. Support must not request database dumps or images in ordinary tickets.                                              |
| Backup loss or ransom                | AES-256-GCM authenticated encryption, fresh IVs, separate private key file, quiesced DB + object snapshot, authenticated restore before DB writes, session revocation, row/file reconciliation                                | Key custody, off-host encrypted copy, host full-disk encryption and recurring restore scheduling are operator responsibilities. A local fixture drill does not prove a deployed recovery SLA.  |

## ASVS verification checklist (selected controls, not all requirements)

Pass means implementation and local regression evidence, not verified production configuration.
Fail means a known gap; blocked means environment/operator evidence is absent.

| ASVS 5.0.0 area                                 | Status                                                  | Verification / outstanding work                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1/V2: validation, encoding, business integrity | Pass (scoped)                                           | Shared strict Zod contracts, normalized clinical/financial SQL checks, collision exclusion constraints and atomic audit writes; existing unit/database tests                      |
| V3/V4: browser and API protections              | Pass (local); blocked (deployed TLS)                    | Helmet CSP/headers, exact-origin credentialed CORS, CSRF, body limits; reverse proxy forwarding-header replacement and no monitoring proxy                                        |
| V5: file handling                               | Pass (scoped)                                           | Existing malicious-upload/history/private-access tests, canonical checksum validation; no public bucket or static private mount                                                   |
| V6: authentication                              | Partial / fail                                          | `v5.0.0-6.3.1` throttling tested; `6.2.4` common-password list and `6.3.3` MFA absent. See authentication runbook for all supported paths.                                        |
| V7: sessions                                    | Pass (scoped)                                           | Session fixation/logout/reset/revocation integration tests, HttpOnly/Secure/SameSite cookies, no browser session secret; idle-session/step-up policy needs security review        |
| V8: authorization                               | Pass (local); blocked (independent test)                | Server-derived active tenant/roles, patient projection and role-change revocation; resource IDOR and foreign tenant tests                                                         |
| V11/V12: cryptography and communication         | Pass (backup envelope); blocked (host/provider)         | CSPRNG keys/IVs; GCM tampering/wrong-key tests; staging/production HTTPS and implicit-TLS SMTP validation; real certificates, key rotation and at-rest encryption not provisioned |
| V13/V14: configuration/data protection          | Pass (validation); blocked (operations)                 | Separate deployment environments; private secret mounts; non-owner DB runtime assertion; backup/export isolation. Operator ACLs, regional retention and off-host custody pending  |
| V15/V16: architecture/logging/errors            | Pass (local); blocked (external custody/SAST execution) | Safe errors, structured bounded telemetry, outbox retry/lease fencing, CodeQL and Trivy CI gates; protected metrics; no automatic external monitoring service claim               |

Do not relax scanner gates or add blanket exceptions to manufacture a green release.
Any proposed high/critical acceptance needs CVE/advisory, affected deployed artifact, exploit path,
mitigation, accountable security owner, expiry and approval. No such exception is approved here.
The pre-existing four npm **moderate** findings in the Drizzle tooling chain are documented in
the release report; forced breaking upgrades remain prohibited.
