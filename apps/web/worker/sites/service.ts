import { SitesRepository } from "./repository";

/**
 * Tombstone a site, drop its registry rows, record a deletion job, and purge
 * the realtime buffer. Shared by the Sites API DELETE and the dashboard
 * delete — both keep the same failure semantics (tombstone always wins over
 * purge errors).
 */
export async function deleteSite(
  env: Env,
  domain: string,
): Promise<{ deleted: false } | { deleted: true; purgeFailed: boolean }> {
  const deleted = await new SitesRepository(env.DB).delete(domain);
  if (!deleted) return { deleted: false };

  const namespace = env.SITE_EVENTS;
  if (namespace) {
    try {
      await namespace.get(namespace.idFromName(domain)).purge();
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "site events purge failed",
          error: String(error),
        }),
      );
      return { deleted: true, purgeFailed: true };
    }
  }
  return { deleted: true, purgeFailed: false };
}
