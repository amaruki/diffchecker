## Summary

<!-- Briefly describe what this PR changes and why. -->

## Related Issue

<!-- Link any related issue, e.g., Closes #123 -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Performance / hardening improvement
- [ ] Documentation / tooling

## Verification Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun test` passes (and new tests cover the change)
- [ ] `bun run test:smoke` passes (production CSP + E2E smoke test)
- [ ] No external network calls or inline scripts introduced (preserves strict CSP and local-only guarantee)
