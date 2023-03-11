import { URL } from 'node:url'
import path from 'node:path'
import { promisify } from 'node:util'
import fs from 'fs-extra'
import { db } from '../db'
import { defineMiddleware } from './define'
import { downloadDir } from '../config'

fs.ensureDirSync(downloadDir)


export default defineMiddleware(async (req, res) => {
  const uri = new URL(req.url!)
  const proxyResContentType = res.headers['content-type']


  if (['image', 'audio'].some(el => proxyResContentType?.startsWith(el))) return

  let body = ''
  if (req.method === 'POST') {
    const buffers = []

    for await (const chunk of req) {
      buffers.push(chunk)
    }

    body = Buffer.concat(buffers).toString()
  }

  const contentBuffers = []
  for await (const chunk of res) {
    contentBuffers.push(chunk)
  }
  const content = Buffer.concat(contentBuffers).toString()

  const data = {
    url: req.url,
    method: req.method,
    body,
    content
  }

  console.log(data)

  // let content = ''
  // res.on('data', chunk => {
  //   content += chunk
  // })
  // res.on('end', () => {
  //   console.log('↓↓↓↓')
  //   console.log(req.url)
  //   console.log(content)
  //   console.log('↑↑↑↑')

  //   const data = {
  //     url: req.url,
  //     method: req.method,
  //   }

  //   // fs.writeFileSync(path.resolve('req.log'), )
  // })

  // if (proxyResContentType && proxyResContentType.includes('audio')) {
  //   const pathInfo = path.parse(uri.pathname)

  //   const SQL_COUNT = `SELECT count(*) as count FROM links WHERE filename = ?`
  //   const result = await promisify<string, string, { count: number }>(db.get.bind(db))(SQL_COUNT, pathInfo.base)
  //   console.log(req.headers, req.method)
  //   if (result.count === 0) {
  //     console.log('→', pathInfo.base)
  //     const tmpFilepath = path.join(downloadDir, pathInfo.base)
  //     const ws = fs.createWriteStream(tmpFilepath)
  //     res.pipe(ws).once('close', () => {
  //       db.run(`INSERT INTO links (link, filename) VALUES (?, ?)`, [req.url, pathInfo.base])
  //       db.get('SELECT count(*) as count FROM links', (err, row) => {
  //         if (!err) console.log('↓', pathInfo.base, row.count)
  //       })
  //     })
  //   }

  // ws.once('close', () => {
  //   import('music-metadata').then(mm => {
  //     mm.parseFile(tmpFilepath).then(async ({ common }) => {
  //       if (common.artist) {
  //         const newFileName = [common.artist, common.title].filter(Boolean).join(' - ') + pathInfo.ext
  //         const newFileDir = path.join(downloadDir, common.artist || '其他')
  //         await fs.promises.mkdir(newFileDir, { recursive: true })
  //         await fs.copyFile(tmpFilepath, path.join(newFileDir, newFileName))
  //         console.log('download:', newFileName)
  //       }
  //     })
  //   })
  // })
  // }
  return res
})
