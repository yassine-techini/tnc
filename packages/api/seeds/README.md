# Seeds — demo data, NOT migrations

These files used to live in `packages/api/migrations/` as `0011_seed_development.sql`
and `0012_seed_staging.sql`. They were moved out because a migration runs in **every**
environment: `pnpm db:migrate:prod` would have inserted the demo accounts below into
production, including a `SUPER_ADMIN` (`admin@tnc.trading`) and two `STATE_OPERATOR`
accounts whose password hashes are committed to this repository.

That never happened only because the chain aborted earlier — `0011` inserted into a
table named `system_config`, which does not exist (it is `config`), so nothing from
`0011` onwards could be applied to a fresh database. Fixing that bug alone would have
removed the accidental protection, so the seeds left the migration chain at the same
time.

## Usage

Local development only:

```bash
pnpm db:seed
```

Never run these against staging or production. The demo credentials are public.

## Files

| File | Was | Contents |
|---|---|---|
| `admins-dev.sql` | `0002_seed_admins.sql` | `SUPER_ADMIN` + `STATE_OPERATOR` (header: "Password for all: Admin123!"), and a **10 000 g gold allocation** |
| `development.sql` | `0011_seed_development.sql` | Demo users, wallets, prices, config defaults |
| `staging.sql` | `0012_seed_staging.sql` | Demo users + demo `SUPER_ADMIN` and `STATE_OPERATOR` accounts |

`admins-dev.sql` was the worst of the three: as migration `0002` it ran before everything
else, so **any** database built from the migration chain started with
`gold_stock.total_allocated = 10000` — ten kilos of gold that do not exist, immediately
tokenizable and sellable, against a platform whose founding invariant is
`tokens_issued <= total_allocated`. `0015` only ever raises that figure (`MAX`), never
resets it.

Bootstrapping a real environment is the job of the `/setup/*` routes, which are gated by
`SETUP_SECRET` (fail-closed), generate real passwords, and initialise `gold_stock` from
the `initial_gold_stock` config. A fresh database now ends the migration chain with zero
admins, zero users and zero allocated gold.

Both use `INSERT OR IGNORE` so they are idempotent and never delete a row another
table references — `INSERT OR REPLACE` on `users` deletes before re-inserting, which
breaks the foreign key from `wallets`.
