/**
 * Runs Supabase migration files directly against the PostgreSQL database
 * using the simple query protocol, which handles multi-statement SQL natively.
 *
 * This replaces the Supabase GitHub integration migration runner that uses
 * prepared statements (which reject multi-statement files with SQLSTATE 42601).
 *
 * Env:
 *   SUPABASE_DB_URL  – PostgreSQL connection string
 *                      (Dashboard → Settings → Database → Connection string → URI)
 *
 * Usage:
 *   npm run db:migrate
 *   node --env-file=.env.local scripts/run-migrations.mjs
 *   node --env-file=.env.local scripts/run-migrations.mjs --dry-run
 *   node --env-file=.env.local scripts/run-migrations.mjs --from 015
 */

import pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations')

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const fromIndex = args.indexOf('--from')
const FROM_PREFIX = fromIndex !== -1 ? args[fromIndex + 1] : null

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`\n  Missing environment variable: ${name}`)
    console.error(`  Set it in .env.local or pass it directly.\n`)
    process.exit(1)
  }
  return value
}

async function ensureHistoryTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._migration_history (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum    TEXT
    )
  `)
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query(
    'SELECT name FROM public._migration_history ORDER BY name'
  )
  return new Set(rows.map((r) => r.name))
}

function simpleChecksum(content) {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0
  }
  return hash.toString(16)
}

async function getMigrationFiles() {
  const entries = await readdir(MIGRATIONS_DIR)
  return entries.filter((f) => f.endsWith('.sql')).sort()
}

async function main() {
  console.log('\n  Supabase Migration Runner')
  console.log('  ========================\n')

  const files = await getMigrationFiles()

  if (files.length === 0) {
    console.log('  No migration files found.\n')
    return
  }

  if (DRY_RUN) {
    console.log('  Mode: DRY RUN (no changes will be applied)\n')

    let pending = files
    if (FROM_PREFIX) {
      pending = pending.filter((f) => f >= FROM_PREFIX)
      console.log(`  Filtering: only migrations starting from "${FROM_PREFIX}"\n`)
    }

    console.log(`  Found ${pending.length} migration file(s):\n`)
    console.log(`  ${'#'.padEnd(5)} ${'Migration'.padEnd(70)} Lines`)
    console.log(`  ${'-'.repeat(85)}`)

    for (let i = 0; i < pending.length; i++) {
      const sql = await readFile(join(MIGRATIONS_DIR, pending[i]), 'utf-8')
      const lineCount = sql.split('\n').length
      const displayName =
        pending[i].length > 67 ? pending[i].slice(0, 64) + '...' : pending[i]
      console.log(
        `  ${String(i + 1).padEnd(5)} ${displayName.padEnd(70)} ${lineCount}`
      )
    }

    console.log(`\n  Total: ${pending.length} pending migration(s).\n`)
    return
  }

  const connectionString = requireEnv('SUPABASE_DB_URL')

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    console.log('  Connected to database.\n')

    await ensureHistoryTable(client)

    const applied = await getAppliedMigrations(client)
    let pending = files.filter((f) => !applied.has(f))

    if (FROM_PREFIX) {
      pending = pending.filter((f) => f >= FROM_PREFIX)
      console.log(`  Filtering: only migrations starting from "${FROM_PREFIX}"\n`)
    }

    if (pending.length === 0) {
      console.log('  All migrations are up to date.\n')
      return
    }

    console.log(
      `  Found ${files.length} total, ${applied.size} applied, ${pending.length} pending.\n`
    )
    console.log(
      `  ${'Migration'.padEnd(65)} ${'Status'.padEnd(12)} Duration`
    )
    console.log(`  ${'-'.repeat(90)}`)

    let successCount = 0
    let failCount = 0

    for (const file of pending) {
      const filePath = join(MIGRATIONS_DIR, file)
      const sql = await readFile(filePath, 'utf-8')
      const checksum = simpleChecksum(sql)
      const displayName = file.length > 62 ? file.slice(0, 59) + '...' : file

      const start = performance.now()

      try {
        await client.query(sql)

        await client.query(
          'INSERT INTO public._migration_history (name, checksum) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
          [file, checksum]
        )

        const duration = ((performance.now() - start) / 1000).toFixed(2)
        console.log(
          `  ${displayName.padEnd(65)} ${'OK'.padEnd(12)} ${duration}s`
        )
        successCount++
      } catch (err) {
        const duration = ((performance.now() - start) / 1000).toFixed(2)
        console.log(
          `  ${displayName.padEnd(65)} ${'FAILED'.padEnd(12)} ${duration}s`
        )
        console.error(`\n  Error in ${file}:`)
        console.error(`  ${err.message}\n`)

        if (err.position) {
          const pos = parseInt(err.position, 10)
          const context = sql.slice(Math.max(0, pos - 80), pos + 80)
          console.error(`  Near position ${pos}:`)
          console.error(`  ...${context}...\n`)
        }

        failCount++
        console.error('  Stopping migration run due to error.\n')
        process.exit(1)
      }
    }

    console.log(`\n  ${'='.repeat(90)}`)
    console.log(
      `  Done. ${successCount} applied, ${failCount} failed, ${applied.size} previously applied.\n`
    )
  } catch (err) {
    console.error(`\n  Connection error: ${err.message}\n`)
    process.exit(1)
  } finally {
    await client.end()
  }
}

await main()
