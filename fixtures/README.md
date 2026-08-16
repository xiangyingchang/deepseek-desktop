# Regression Fixtures

These directories are reserved for minimal, auditable regression cases. A synthetic fixture is not evidence that the failure occurred in the community; real-world evidence is recorded separately in the milestone report.

Required cases:

```text
healthy-profile
broken-lockfile
missing-package
dangling-bundle
bad-cordis-patch
duplicate-runtime-package
plugin-activation-failure
non-portable-local-link
git-floating-reference
missing-secret
unsupported-platform

Phase 2 real-world fixtures:

phase2-config-only-bundle
phase2-real-lock-proof-activation
phase2-unbuilt-bundle-entry
phase2-workspace-link
phase2-generated-data-exclusion
phase2-user-plugin-preservation
phase2-rebase-conflict
phase2-share-secret-isolation
phase2-atomic-switch
tampered-stack
```

Every negative fixture must assert that Verify does not return a false PASS.
