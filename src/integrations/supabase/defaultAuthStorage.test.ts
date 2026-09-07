import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

type AuthStorageInternals = {
  storage: {
    getItem: (key: string) => string | null | Promise<string | null>;
    setItem: (key: string, value: string) => void | Promise<void>;
    removeItem: (key: string) => void | Promise<void>;
  };
};

describe("Supabase default browser auth storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists, restores, and removes a session value through localStorage", async () => {
    const client = createClient(
      "https://supabase-test.invalid",
      "test-publishable-key",
      {
        auth: {
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    const { storage } = client.auth as unknown as AuthStorageInternals;
    const key = "sb-independent-auth-contract";
    const value = JSON.stringify({ access_token: "test-token" });

    expect(storage).toBe(window.localStorage);

    await storage.setItem(key, value);
    expect(await storage.getItem(key)).toBe(value);

    await storage.removeItem(key);
    expect(await storage.getItem(key)).toBeNull();
  });
});
