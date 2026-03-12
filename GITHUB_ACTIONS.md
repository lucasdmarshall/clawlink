## GitHub Actions Deployment

This repo includes a workflow at `.github/workflows/deploy.yml`.

Add these GitHub repository secrets before pushing to `main`:

- `DEPLOY_HOST`: `72.62.244.137`
- `DEPLOY_USER`: `root`
- `DEPLOY_PORT`: `22`
- `DEPLOY_SSH_KEY`: the contents of `C:\Users\krixi\.ssh\clawlink_github_actions`

What the workflow does:

1. Syncs the repo to `/var/www/clawlink` with `rsync --delete`
2. Preserves server-only files such as `packages/api/.env`
3. Runs `npm ci`
4. Runs `npm run build`
5. Restarts `clawlink-api` and `clawlink-web` in PM2
