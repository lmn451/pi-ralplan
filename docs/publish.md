# Publishing pi-ralplan

## Prerequisites

1. **npm token** stored as `NPM_TOKEN` secret in GitHub repo (Settings → Secrets → Actions → New secret)

## Release Process

### 1. Update Version

Update `version` in `package.json`:

```json
{
  "version": "0.x.0"
}
```

### 2. Create & Push Tag

```bash
git tag v0.x.0 && git push --tags
```

The tag format `v*` triggers the publish workflow.

### 3. Verify

- Check GitHub Actions tab for the workflow run
- Verify tag version matches package.json version (workflow auto-checks this)
- Package appears on npm within minutes

## Workflow Steps

1. Checkout code
2. Setup pnpm
3. Install dependencies
4. Verify tag matches package version
5. Run tests
6. Verify package can be packed
7. Publish to npm with provenance

## Manual Publish (if needed)

```bash
pnpm install
npm publish --access public
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Workflow fails | Check `NODE_AUTH_TOKEN` secret is set |
| Version mismatch | Ensure tag and package.json match |
| Peer deps missing | Install peer deps locally first |
