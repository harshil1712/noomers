export const SINGLE_ORGANIZATION = {
  id: "default",
  name: "Default",
  api_available: true,
} as const;

export function validateTeamId(teamId?: string | null): void {
  if (teamId && teamId !== SINGLE_ORGANIZATION.id) {
    throw new Error(`team_id must be ${SINGLE_ORGANIZATION.id}.`);
  }
}
