import { describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn((..._args: unknown[]) => ({ auth: {} })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

import "./client";

describe("Supabase client auth configuration", () => {
  it("delegates browser storage to Supabase without a platform-specific adapter", () => {
    expect(createClientMock).toHaveBeenCalledTimes(1);

    const options = createClientMock.mock.calls[0]?.[2] as {
      auth?: Record<string, unknown>;
    };

    expect(options.auth).toEqual({
      persistSession: true,
      autoRefreshToken: true,
    });
    expect(options.auth).not.toHaveProperty("storage");
  });
});
