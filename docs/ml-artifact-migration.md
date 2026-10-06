# ML Artifact Migration Proposal

## Current inventory

The application repository currently contains:

| Category                   | Path                                                        |                     Inventory |
| -------------------------- | ----------------------------------------------------------- | ----------------------------: |
| Primary YOLO dataset       | `dataset_yolo/`                                             | 2,540 files; 21,086,666 bytes |
| Converted/training dataset | `scripts/dataset/`                                          | 1,272 files; 20,990,711 bytes |
| Training outputs           | `runs/`                                                     |     8 files; 50,368,777 bytes |
| Base model weight          | `yolov8n.pt`                                                |               6,549,796 bytes |
| Best trained weight        | `runs/detect/dental_training/dental_ai_run/weights/best.pt` |              24,459,926 bytes |
| Last trained weight        | `runs/detect/dental_training/dental_ai_run/weights/last.pt` |              24,460,310 bytes |

The two dataset trees appear to represent source/export and converted training forms. Their relationship must be verified by manifest and content hashes before either copy is removed. No dataset, run output, or weight is deleted in Phase 2.

## Proposed destination

Use a dedicated private ML repository for training code and lightweight manifests, plus a versioned artifact store for binary content. Suitable stores include an access-controlled S3-compatible bucket, DVC remote, or a model registry that provides immutable versions and checksums.

Recommended layout:

```text
dentalai-ml/
  datasets/<dataset-name>/<semantic-version>/manifest.json
  training/
  models/<model-name>/<semantic-version>/model-card.md
artifact-store://dentalai/
  datasets/<dataset-name>/<version>/...
  runs/<run-id>/...
  models/<model-name>/<version>/{best,last}.pt
```

## Safe migration sequence

1. Assign owners and confirm the data classification, licensing, consent, and retention requirements for every dataset.
2. Generate SHA-256 manifests containing relative path, byte length, checksum, source, and split for all files.
3. Upload immutable dataset/model versions to the approved private store with encryption and least-privilege access.
4. Restore the artifacts into a clean temporary directory and verify every checksum and expected file count.
5. Record training metadata, code revision, dependency environment, metrics, and a model card for each retained weight.
6. Update training scripts to accept external dataset/output locations; never default training output into this application repository.
7. In a separate reviewed change, remove tracked artifacts from the application repository. Preserve Git history unless repository owners explicitly approve a coordinated history rewrite and backup.
8. Verify the application build and tests from a clean clone after removal.

The updated `.gitignore` blocks new datasets, training runs, Python caches, and common model formats from being accidentally added while this migration is pending.
