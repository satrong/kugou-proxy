import path from 'path'
import sqlite3 from 'sqlite3'

const dbPath = path.join(__dirname, 'data.sqlite')

function handler (err: Error | null): void {
  if (err != null) { console.error(err); return }

  const TABLE_LINKS = 'links'
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLE_LINKS} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link TEXT,
        filename TEXT,
        songName TEXT DEFAULT NULL
      )
    `)

    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS ${TABLE_LINKS}_uid ON ${TABLE_LINKS} (filename);`)
  })
  console.info('DB connected.')
}

console.info('DB path:', dbPath)

const args = [dbPath, handler] as const

if (process.env.NODE_ENV === 'production') {
  (args as any).splice(1, 0, sqlite3.OPEN_READONLY)
}

export const db = new (sqlite3.verbose()).Database(...args)
