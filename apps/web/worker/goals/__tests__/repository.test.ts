import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { GoalsRepository, MAX_GOALS_PER_SITE } from "../repository";

describe("GoalsRepository", () => {
  const all = vi.fn();
  const run = vi.fn();
  const bind = vi.fn(() => ({ all, run }));
  const prepare = vi.fn(() => ({ bind }));
  const repository = new GoalsRepository({
    prepare,
  } as unknown as D1Database);

  beforeEach(() => {
    vi.clearAllMocks();
    run.mockResolvedValue({ success: true, meta: { changes: 1 } });
  });

  test("lists goals for a site", async () => {
    all.mockResolvedValueOnce({
      results: [
        {
          id: "goal-1",
          site_id: "example.com",
          name: "Signup",
          type: "event",
          value: "Signup",
          created_at: "2026-08-02T00:00:00Z",
        },
      ],
    });

    expect(await repository.list("example.com")).toEqual([
      {
        id: "goal-1",
        siteId: "example.com",
        name: "Signup",
        type: "event",
        value: "Signup",
        customProps: {},
        createdAt: "2026-08-02T00:00:00Z",
      },
    ]);
    expect(bind).toHaveBeenCalledWith("example.com");
  });

  test("creates and deletes validated goals", async () => {
    const goal = await repository.create({
      siteId: "example.com",
      name: " Signup conversion ",
      type: "event",
      value: " Signup ",
    });

    expect(goal.name).toBe("Signup conversion");
    expect(goal.value).toBe("Signup");
    expect(goal.id).toBeTruthy();

    await repository.delete("example.com", goal.id);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("rejects invalid goals before querying D1", async () => {
    await expect(
      repository.create({
        siteId: "example.com",
        name: "",
        type: "event",
        value: "Signup",
      }),
    ).rejects.toThrow("required");
    expect(prepare).not.toHaveBeenCalled();
  });

  test("rejects goals above the per-site limit", async () => {
    run.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });

    await expect(
      repository.create({
        siteId: "example.com",
        name: "Another conversion",
        type: "event",
        value: "Upgrade",
      }),
    ).rejects.toThrow(`at most ${MAX_GOALS_PER_SITE} goals`);
    expect(run).toHaveBeenCalledOnce();
  });
});
