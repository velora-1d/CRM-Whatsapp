import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const globalForDb = globalThis as unknown as {
  conn: Pool | undefined
}

const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
const connectionString = process.env.DATABASE_URL || (isBuildPhase ? 'postgres://dummy:dummy@localhost:5432/dummy' : undefined)

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not defined')
}

const pool =
  globalForDb.conn ||
  new Pool({
    connectionString,
    ssl:
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
  })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.conn = pool
}

export const db = drizzle(pool, { schema })
export type DbClient = typeof db
export * as schema from './schema'
