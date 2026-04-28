---
title: "Publishing Workflow"
keywords: [publish, release, npm, version, tag, bun, oidc, trusted publisher]
---

# Publishing pi-ralplan

## Trusted Publisher (OIDC)

This package uses **npm trusted publishing** — no tokens needed. The GitHub Actions workflow authenticates via OIDC, which is configured at:

```
https://www.npmjs.com/package/pi-ralplan → Settings → Trusted Publisher
```

The trusted publisher entry authorizes `lmn451/pi-ralplan` with workflow `publish.yml`.

## How It Works

1. Push a `v*` tag → triggers the publish workflow
2. GitHub Actions generates a short-lived OIDC token (`id-token: write`)
3. npm verifies the OIDC claims match the trusted publisher config
4. Package is published with provenance attestation

No `NPM_TOKEN` secret, no token rotation, nothing to leak.

## Release Process

```bash
# 1. Edit version in package.json (e.g., 0.1.0 → 0.1.1)

# 2. Commit, tag, and push
git add package.json
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin master
git push origin vX.Y.Z
```

Or use `npm version`:

```bash
npm version patch   # bumps version, commits, tags
git push origin master --follow-tags
```

## CI/CD

The `Publish` workflow triggers on `v*` tags and:
- Sets up Bun and Node.js 24
- Runs `bun install --frozen-lockfile`
- Verifies tag matches `package.json` version
- Runs `bun test`
- Publishes to npm with provenance via OIDC

Monitor: https://github.com/lmn451/pi-ralplan/actions

## Manual Publish (first time only)

OIDC only works after the package exists on npm. For the initial publish:

```bash
npm login
npm publish --access public
```

After that, configure the trusted publisher and all future releases go through CI.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 404 on publish | Verify trusted publisher config on npmjs.com matches exactly |
| Workflow didn't run | Ensure tag matches `v*` and was pushed to remote |
