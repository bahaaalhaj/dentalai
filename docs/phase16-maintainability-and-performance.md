# Measured quality budgets

The 400-line requirement applies to handwritten production TS/TSX/Python and operator JavaScript modules. Tests and the reproducible i18n inventory are explicit exceptions, not production business logic exclusions. SQL migrations/generated ORM snapshots are schema artifacts reviewed through migration/constraint tests. `npm run source:check` fails new violations.

The former 918-line appointment page is now a state hook, page, dialog and settings component. Repository capability layers group authorization/transaction primitives, projections, read queries, catalog/settings, and mutations. Protected guards are inherited and not duplicated in tests. The public domain facade/API signatures remain stable. No SQL locking or transaction scope was intentionally shortened. Development seed identities/clinical-ledger fixtures and schema encounter/history versus odontogram/plans are separate cohesive modules.

Frontend original JPEGs are retained in `apps/web/assets/clinic-originals`; `scripts/optimize-clinic-images.mjs` deterministically makes 320/640 WebP variants (quality 78). Source/output hashes, dimensions and sizes are in the generated manifest. The banner's 256-pixel cards use srcset/sizes, dimensions, below-fold lazy loading and async decoding. No actual LCP photographic image is delayed: the hero remains text/animation. The animation player is a separate lazy landing-only chunk with a fixed aspect-ratio placeholder; route splitting remains in place.

Baseline frontend: **17,848,747 bytes / 39 files**. First optimized build: **3,324,067 bytes / 49 files**; final measured candidate may differ with translations and tests (see the final report). Derived clinic variants total **239,160 bytes**. Budgets after build: total 5 MB, JS chunk 750 KB, WASM 2 MB, other asset 500 KB. The retained locally hosted Lottie WASM is a documented 1.69 MB exception with its own ceiling, not excluded from total size. Run `npm run bundle:check` for exact JSON measurements. These are byte budgets, not measured LCP/FPS/availability promises.

## Coverage

V8 coverage includes web/UI modules and API/domain logic, including actual database integration tests. Generated inventory, declarations and test code are excluded; difficult business logic is not. CLI/infrastructure glue remains included, making untested operational paths visible. JSON, JSON summary, HTML and LCOV reports are stored under `coverage/web` and `coverage/api` and uploaded by CI.

Measured accepted floors: web statements **36.27%**, branches **38.49%**, functions **25.66%**, lines **36.76%**; API statements **84.48%**, branches **76.77%**, functions **88.65%**, lines **86.14%**. Vitest fails regression below each floor. Frontend coverage is limited and must not be described as comprehensive. New behavior still requires focused regression tests independently of the global percentage. Do not decrease a floor to hide a failing test; update after a reviewed expansion with complete evidence.

## Localization boundary

Interface labels are manually translated into Arabic, not machine-translated clinical content. Extraction handles JSX, confirmation/action labels and success messages; Arabic checks verify all extracted/explicit keys and interpolation consistency. Technical/brand identifiers have a short enumerated exception set. Machine-readable codes and clinician-entered records remain unchanged. Generic safe error messages are localized; backend debug details are not shown. Clinical terminology and translations still require qualified professional review. These checks do not prove all dynamically supplied strings are translated.
