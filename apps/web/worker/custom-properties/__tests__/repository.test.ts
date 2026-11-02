import { beforeEach, describe, expect, test, vi } from "vitest";
import { CustomPropertiesRepository } from "../repository";

describe("CustomPropertiesRepository", () => {
    const all = vi.fn();
    const run = vi.fn();
    const bind = vi.fn(() => ({ all, run }));
    const prepare = vi.fn(() => ({ bind }));
    const repository = new CustomPropertiesRepository({ prepare } as unknown as D1Database);

    beforeEach(() => vi.clearAllMocks());

    test("lists properties in repository order", async () => {
        all.mockResolvedValue({ results: [{ property: "author" }, { property: "title" }] });
        await expect(repository.list("example.com")).resolves.toEqual(["author", "title"]);
    });

    test("creates properties idempotently", async () => {
        run.mockResolvedValue({ meta: { changes: 0 } });
        await expect(repository.create("example.com", " title ")).resolves.toBe(true);
        expect(bind).toHaveBeenCalledWith("example.com", "title");
    });

    test("returns the deletion result as a boolean", async () => {
        run.mockResolvedValue({ meta: { changes: 1 } });
        await expect(repository.delete("example.com", "title")).resolves.toBe(true);
        run.mockResolvedValue({ meta: { changes: 0 } });
        await expect(repository.delete("example.com", "missing")).resolves.toBe(false);
    });
});
