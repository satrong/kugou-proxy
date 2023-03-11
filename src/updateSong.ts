import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'fs-extra'
import { db } from './db'
import { downloadDir, musicDir } from './config'

/** 重命名文件 */
export async function renameSongFile (filename: string) {
  try {
    const filepath = path.join(downloadDir, filename)
    const mm = await import('music-metadata')
    const { common } = await mm.parseFile(filepath)
    if (common.artist) {
      const arr = [common.artist, common.title].filter(Boolean)
      if (arr.length === 0) {
        console.error('重命名', filename, '未获取到名称')
        return null
      }
      const name = arr.join(' - ')
      const newFileName = name + path.extname(filename)
      const newFileDir = path.join(musicDir, common.artist || '其他')
      await fs.promises.mkdir(newFileDir, { recursive: true })
      await fs.move(filepath, path.join(newFileDir, newFileName))
      return name
    }
  } catch (err: any) {
    console.error('重命名', filename, err.message)
  }
  return null
}

type TUpdateParams = { filename: string; songName: string | null }

async function updateDb ({ filename, songName }: TUpdateParams) {
  if (!filename || !songName) return

  const SQL = `UPDATE links SET songName = ? WHERE filename = ?`
  await promisify<string, string[], any>(db.run.bind(db))(SQL, [songName, filename])
}

export async function updateSong () {
  await fs.ensureDir(musicDir)
  await fs.ensureDir(downloadDir)

  for (const filename of await fs.readdir(downloadDir)) {
    const songName = await renameSongFile(filename)
    await updateDb({ filename, songName })
    console.log(filename, songName)
  }
}
