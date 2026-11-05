const GRACE_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const DUE_LIMIT = 50;

export interface DeletionJob {
  id: string;
  site_id: string;
  requested_at: string;
  attempt_count: number;
}

export class DeletionJobsRepository {
  constructor(private database: D1Database) {}

  async listDue(now = new Date()): Promise<DeletionJob[]> {
    const cutoff = new Date(now.getTime() - GRACE_MS).toISOString();
    const rows = await this.database
      .prepare(
        `SELECT id, site_id, requested_at, attempt_count
                 FROM site_deletion_jobs
                 WHERE iceberg_status IN ('pending', 'failed')
                     AND attempt_count < ?
                     AND requested_at <= ?
                 ORDER BY requested_at LIMIT ?`,
      )
      .bind(MAX_ATTEMPTS, cutoff, DUE_LIMIT)
      .all<DeletionJob>();
    return rows.results;
  }

  async report(
    id: string,
    status: "completed" | "failed",
    error: string | null,
    now = new Date(),
  ): Promise<{ found: boolean; alreadyCompleted?: boolean; attemptCount?: number }> {
    const current = await this.database
      .prepare("SELECT completed_at, attempt_count FROM site_deletion_jobs WHERE id = ?")
      .bind(id)
      .first<{ completed_at: string | null; attempt_count: number }>();
    if (!current) return { found: false };
    if (current.completed_at !== null) return { found: true, alreadyCompleted: true };
    const iso = now.toISOString();
    await this.database
      .prepare(
        `UPDATE site_deletion_jobs
                 SET iceberg_status = ?, iceberg_updated_at = ?, iceberg_error = ?,
                     attempt_count = attempt_count + 1,
                     completed_at = CASE WHEN ? = 'completed' THEN ? ELSE NULL END
                 WHERE id = ?`,
      )
      .bind(status, iso, error, status, iso, id)
      .run();
    return { found: true, attemptCount: current.attempt_count + 1 };
  }
}
