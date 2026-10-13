# ML data and model governance — release blocked

No dataset, weights, runs, or Git history were deleted or rewritten in Phase 16. See [inventory](ml-inventory.json) for reproducible aggregate counts (`node scripts/inventory-ml.mjs`). Hash duplication and metadata checks cannot establish lawful use or de-identification. No patient identifiers are printed by the inventory tool.

| Mandatory decision                              | Current evidence          |
| ----------------------------------------------- | ------------------------- |
| Dataset source and owner                        | UNKNOWN — RELEASE BLOCKER |
| Dataset license and permitted purpose           | UNKNOWN — RELEASE BLOCKER |
| Public redistribution rights                    | UNKNOWN — RELEASE BLOCKER |
| Patient consent / lawful processing basis       | UNKNOWN — RELEASE BLOCKER |
| De-identification method and independent review | UNKNOWN — RELEASE BLOCKER |
| Annotators and annotation process               | UNKNOWN — RELEASE BLOCKER |
| Patient-level train/validation/test separation  | UNKNOWN — RELEASE BLOCKER |
| Real-world evaluation and external validation   | UNKNOWN — RELEASE BLOCKER |
| Model-weight license and redistribution         | UNKNOWN — RELEASE BLOCKER |
| Application repository license                  | UNKNOWN — RELEASE BLOCKER |

The application currently has no approved clinical performance claim. Nonclinical pipeline fixtures do not establish accuracy, sensitivity, specificity, or clinical suitability. Anesthesia recommendations remain disabled without approved references.

## Owner decisions

Confirm whether existing data may legally remain public; select a project license after reviewing third-party rights; decide whether history cleanup is necessary; confirm whether weights may be redistributed. These decisions require evidence, not a developer inference. Removal/history rewriting, if approved later, requires a retained private backup, coordinated consumer migration, and explicit authority.

## Proposed artifact migration

Use a dedicated access-controlled ML repository for reproducible training configuration and annotation definitions. Put datasets, splits and weights in a private versioned artifact store, with immutable checksums, access logs, deletion/retention decisions and the reviewed cards. Preserve existing content until a destination, ownership and verified copy are approved. Git LFS is not a privacy boundary.

`dental_data.yaml` uses a relative dataset root. Training scripts require externally configured directories and reviewed licensing; do not run training inside the application repository. New datasets, caches and weights are ignored and the artifact gate rejects tracked additions/updates. Public/production release governance checks fail while any mandatory field remains unresolved. Internal technical verification does not waive this gate.
