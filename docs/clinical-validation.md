# Experimental Clinical Modules

The X-ray analysis and anesthetic decision-support modules are experimental. They have not completed technical or clinical validation and must not be used to diagnose, recommend treatment, calculate a patient dose, or make any other patient-care decision.

Both modules are disabled by default. Development or demonstration access requires `VITE_CLINICAL_ENV` to be explicitly set to `development` or `demo` and the module's individual flag to be set to `true`:

- `VITE_ENABLE_XRAY_ANALYSIS`
- `VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT`

The X-ray module has no real inference runtime. Enabling its flag does not generate findings; the previous randomized simulation has been removed. Anesthetic output, when explicitly enabled for development or demonstration, remains unvalidated and is for software evaluation only.
