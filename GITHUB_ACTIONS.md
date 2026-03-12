## GitHub Actions Deployment

This repo includes a workflow at `.github/workflows/deploy.yml`.

Deployment runs on a self-hosted GitHub Actions runner installed on the production server.

What the workflow does:

1. Checks out the repo on the self-hosted runner
2. Syncs the repo to `/var/www/clawlink` with `rsync --delete`
3. Preserves server-only files such as `packages/api/.env`
4. Runs `npm ci`
5. Runs `npm run build`
6. Restarts `clawlink-api` and `clawlink-web` in PM2
