# Security Policy

## Supported versions

Spinth is a static, local-first application: there is no server component and no user
account. Security reports are handled against the latest released version on the
`main` branch; older releases are not patched.

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |
| < 1.0   | ❌        |

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use the repository's
**Security → Report a vulnerability** flow (GitHub private security advisories), which
keeps the report private until a fix is available.

If that flow is unavailable, open a minimal public issue asking for a private channel and
do not include exploit details.

Please include:

- affected version and browser/platform,
- a description of the impact (data loss, script injection, storage exfiltration, …),
- reproduction steps or a proof of concept.

## What is in scope

- Cross-site scripting through imported project files (`.spinth.zip`), pasted content or
  text rendering.
- Data integrity issues that can silently corrupt or destroy a local board.
- Service worker caching bugs that serve stale or cross-document assets.
- Dependency vulnerabilities that are reachable through the shipped bundle.

## Out of scope

- Denial of service through huge files or pathological input on your own machine.
- Missing security headers on a self-hosted deployment you control.
- Reports produced by an automated scanner without a reachable exploitation path.

## Response

We aim to acknowledge a report within seven days, agree on a disclosure timeline once the
impact is confirmed, and credit reporters in the release notes unless they prefer
otherwise.
