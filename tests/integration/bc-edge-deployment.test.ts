/**
 * @jest-environment node
 *
 * Smoke tests against the LIVE deployed bc-claim and bc-reference edge
 * functions on the NxtClaimTest project (pltbwxddxtsavygijcnl).
 *
 * Scope: deployment liveness + JWT-gate behaviour. Happy-path BC roundtrips
 * are excluded because submitting test claims to the real BC sandbox is a
 * side effect we don't want from a test suite. Detailed lifecycle assertions
 * (ALREADY_SUBMITTED, ALREADY_IN_FLIGHT, MISSING_MAPPING) require a seeded
 * finance-approver test user, which is owned by future test-infrastructure
 * work (see plan §8). What this file DOES cover is enough to prove
 * deployment, env wiring, JWT enforcement, and bc-reference end-to-end.
 *
 * These tests hit a real Supabase project. They require these env vars at
 * test time (skipped if missing):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

import "@jest/globals";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

// The Supabase edge-function platform gate `verify_jwt=true` requires a real
// JWT in Authorization (not the modern `sb_publishable_*` format). Tests
// accept either NEXT_PUBLIC_SUPABASE_ANON_KEY if it's a JWT, or fall back to
// SUPABASE_LEGACY_ANON_KEY for environments using the modern publishable
// format. Skip the suite entirely if neither resolves to a JWT.
const isJwt = (s: string | undefined): s is string => Boolean(s && s.startsWith("eyJ"));
const rawAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const legacyAnon = process.env.SUPABASE_LEGACY_ANON_KEY;
const ANON_JWT = isJwt(rawAnon) ? rawAnon : isJwt(legacyAnon) ? legacyAnon : undefined;

const liveSuite = SUPABASE_URL && ANON_JWT ? describe : describe.skip;
const ANON_KEY = ANON_JWT ?? "";

liveSuite("bc-edge-deployment (live)", () => {
  describe("bc-reference (deployed function)", () => {
    test("currencies returns lowercased { code, description } items", async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bc-reference?type=currencies`, {
        headers: { Authorization: `Bearer ${ANON_KEY}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.value)).toBe(true);
      if (body.value.length > 0) {
        expect(body.value[0]).toEqual(
          expect.objectContaining({
            code: expect.any(String),
            description: expect.any(String),
          }),
        );
      }
      // BC test sandbox is known to include INR.
      const codes = (body.value as Array<{ code: string }>).map((r) => r.code);
      expect(codes).toContain("INR");
    }, 15_000);

    test("gstGroupCodes returns non-empty array", async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bc-reference?type=gstGroupCodes`, {
        headers: { Authorization: `Bearer ${ANON_KEY}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.value.length).toBeGreaterThan(0);
    }, 15_000);

    test("hsnSacCodes returns non-empty array", async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bc-reference?type=hsnSacCodes`, {
        headers: { Authorization: `Bearer ${ANON_KEY}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.value.length).toBeGreaterThan(0);
    }, 15_000);

    test("unknown type returns 400 UNKNOWN_TYPE", async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bc-reference?type=nope`, {
        headers: { Authorization: `Bearer ${ANON_KEY}` },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("UNKNOWN_TYPE");
    }, 10_000);

    test("non-GET returns 405", async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bc-reference?type=currencies`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ANON_KEY}` },
      });
      expect(res.status).toBe(405);
    }, 10_000);
  });

  describe("bc-claim (deployed function)", () => {
    test("POST without any Authorization header → 401 (Supabase platform gate)", async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bc-claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimId: "CLM-DOES-NOT-MATTER", isVendorPayment: false }),
      });
      expect(res.status).toBe(401);
    }, 10_000);

    test("POST with anon JWT (no real user) → 401 UNAUTHENTICATED from function body", async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bc-claim`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ANON_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ claimId: "CLM-DOES-NOT-MATTER", isVendorPayment: false }),
      });
      // Anon JWT passes the platform verify_jwt gate but auth.getUser() returns
      // no user.id — our handler returns 401 UNAUTHENTICATED explicitly.
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: "UNAUTHENTICATED" }),
        }),
      );
    }, 10_000);

    test("non-POST returns 405", async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bc-claim`, {
        method: "GET",
        headers: { Authorization: `Bearer ${ANON_KEY}` },
      });
      expect(res.status).toBe(405);
    }, 10_000);
  });
});
