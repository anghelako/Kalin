# Database hardening Batch A

Prepared 2026-11-23 from the checked-in [audit](DB_AUDIT.md) and [baseline](../supabase/migrations/0000_baseline.sql). Production was untouched.

| Audit ID | Change |
|---|---|
| RLS-01 | Recreate the 13 formerly PUBLIC policies for `authenticated`. Their predicates are preserved except for the author-delete change below. |
| RLS-02 | Require the note author to be a current circle member before deleting a care note. |
| GRT-03 | Remove direct default table and function grants to `anon` and `authenticated` for future `public` objects created by `postgres`. Existing object grants are preserved. |
| GRT-04 | Enforce the `create_circle` limits on direct writes. The trimmed name must be 1–60 characters and a non-null description at most 120 characters. |
| FN-08 | Set an empty `search_path` on `add_circle_owner`, `add_circle_owner_membership`, `is_circle_member`, and `owns_circle`. Their existing bodies already qualify application and Auth objects. The migration preserves the bodies, signatures, owners, and grants. |
| INT-05 | Require one-dimensional weekday and time arrays, allowing empty arrays where the existing frequency rules allow them. Weekdays use 0–6 and times use midnight through the end of the same day, excluding PostgreSQL's special `24:00:00` value. Both arrays reject duplicates and null elements. |
| RLS-03 | Replace the address-derived fallback with `Member` in the signup profile trigger, pharmacy actor helper, and join-request RPC. Explicit names and the join request's separate contact field retain their existing behavior. Historical display names receive no backfill. |

**Frontend impact.** No code or RPC call changes are expected. A new display name may show `Member` when none was supplied. The current forms already enforce the circle length limits, select the supported weekdays, and deduplicate schedule times.

## Apply and validate

1. Review and apply the [forward migration](../supabase/migrations/20261123090000_batch_a_hardening.sql) as `postgres` on a disposable database first. Use the baseline only when bootstrapping a fresh environment.
2. Review existing schedule data before running the [manual validation](../supabase/migrations/manual/batch_a_validate.sql). The four new checks start as `NOT VALID`, so the forward migration skips the existing data scan. New inserts and updates must satisfy the checks, including updates to preexisting rows. Both schedule constraints validate in one transaction. The circle checks can be validated separately after existing rows have been reviewed. [PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)
3. If reversal is required, review the [manual rollback](../supabase/migrations/manual/batch_a_rollback.sql) against any subsequent changes. It restores the audited policy and function definitions and the prior default grants for `postgres`. It leaves existing rows as stored, including neutral names written while Batch A was active.

**GRT-03 scope.** Supabase reserves `supabase_admin` default privileges. The hosted `postgres` role cannot alter them. PostgreSQL's built-in `PUBLIC` function EXECUTE default is global, so a schema-scoped revocation cannot remove it. For each future RPC, revoke `EXECUTE` from `PUBLIC` on the new routine in the same transaction that creates it, then grant execution only to the intended roles. This preserves defaults in other schemas. [Supabase managed-role guidance](https://supabase.com/kb/troubleshooting/cant-change-the-default-privileges-of-supabase_admin-in-the-public-schema-448af9) · [PostgreSQL ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)

## Verification

The [SQL suite](../supabase/tests/batch_a_hardening.sql) uses synthetic fixtures for owner, member, outsider, former-member and anonymous contexts. Run it as `postgres` on a disposable database after applying the migration. It rolls back its fixtures, temporary schema objects and test-only grants.

```sh
psql -X -v ON_ERROR_STOP=1 -d kalin_batch_a_local -f supabase/tests/batch_a_hardening.sql
```

Passed on disposable embedded PostgreSQL 17.5 (PGlite), using stub Supabase roles and Auth helpers. The checks covered forward application and repeat application, all changed policies, changed functions and triggers, staged and validated constraints against synthetic legacy data, existing object ACL preservation, rollback catalog parity, and reapplication. The baseline's managed extension declarations were omitted in this local harness. Hosted Auth, PostgREST and Supabase's managed roles were outside this test.
