# Production deployment

This runbook explains how the noomers CD workflow deploys to production, how to gate deployments with a GitHub environment, and how to roll back safely.

Last reviewed: 2026-08-20.

## How deployments are triggered

The [`cd` workflow](../.github/workflows/cd.yaml) runs after the [`ci` workflow](../.github/workflows/ci.yaml) completes on `main` or `v3`. It deploys **only** when the CI run concluded successfully, checks out the exact commit that passed CI (`github.event.workflow_run.head_sha`), and passes that same SHA to the Worker as `VERSION`.

Because the deploy job is attached to a GitHub `production` environment, repository administrators can require manual approval, wait timers, branch restrictions, or specific actors before the job starts.

## Configure the `production` environment

1. In the repository, go to **Settings** > **Environments** and create an environment named `production`.
2. Add protection rules:
    - **Required reviewers**: add the operators or teams who must approve production deployments.
    - (Optional) **Wait timer**: add a cooling-off delay.
    - (Optional) **Deployment branches**: restrict deployments to `main` and `v3`.
3. Save the rules. The next `cd` run will pause at the `production` environment step until approved.

## Verify the deployed SHA

Before approving a deployment, confirm the commit in the workflow run matches the commit you expect:

1. Open the `cd` workflow run.
2. Check the **Deploy** job logs for the checkout step; the `ref` is `github.event.workflow_run.head_sha`.
3. Compare that SHA to the latest commit on `main` or `v3` and to the commit shown in the triggering `ci` run.
4. After deployment, the `VERSION` environment variable in the Worker equals the same SHA. You can inspect a deployed version's source tag/message with Wrangler:

    ```bash
    cd packages/server
    pnpm exec wrangler versions list
    pnpm exec wrangler versions view <VERSION_ID>
    ```

## Roll back to a known-good version

If a deployment misbehaves, roll the Worker back to a previously published version. Do **not** try to reverse append-only D1 migrations; if a migration caused the problem, fix forward or restore D1 from a backup instead.

1. Identify the version to roll back to:

    ```bash
    cd packages/server
    pnpm exec wrangler versions list
    # or
    pnpm exec wrangler deployments list
    ```

2. Roll back. This creates a new deployment that sends 100% of traffic to the selected version:

    ```bash
    pnpm exec wrangler rollback <VERSION_ID> --message "Rolling back after incident"
    ```

    To roll back to the version immediately before the latest, omit `<VERSION_ID>`.

3. Confirm the rollback:

    ```bash
    pnpm exec wrangler deployments status
    ```

## Post-rollback validation

After rolling back, verify the deployment before closing the incident:

- `wrangler deployments status` shows the expected active version.
- `/api/health` on the deployed Worker returns `200 OK`.
- Dashboard and Stats API smoke tests pass for a representative site.
- Error rates and collection volume return to baseline.
- If the rollback was triggered by a failed migration, confirm the D1 schema version is compatible with the rolled-back code. Do not run down-migrations; forward-fix or restore from backup per the backup/restore runbook.

## Related documents

- [Production readiness](production-readiness.md)
- [Feature implementation roadmap](implementation-roadmap.md) — tracks [OPS-006](implementation-roadmap.md).
