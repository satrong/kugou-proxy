import { createGunzip, createGzip, gzip } from 'node:zlib'
import { promisify } from 'node:util'
import Hapi from '@hapi/hapi'
import H2o2 from '@hapi/h2o2'
import Wreck from '@hapi/wreck'

const start = async function () {

  const server = Hapi.server({
    port: 8899,
    routes: {
      payload: {
        output: 'stream',
        parse: false
      }
    }
  });

  await server.register(H2o2);
  await server.start();

  console.log(`Server started at:  ${server.info.uri}`);

  server.route([
    {
      method: ['GET', 'POST'],
      path: '/{p*}',
      handler (req, h) {
        return h.proxy({
          uri: req.url.toString(),
          passThrough: true,
          // onRequest (req) {
          //   return req
          // },
          async onResponse (err, res, request, h, settings, ttl) {
            if (err) {
              throw err
            }

            const contentType = res.headers['content-type']
            if (['image', 'audio'].some(el => contentType?.startsWith(el))) return res

            const isJson = contentType?.includes('json')
            const isGzip = res.headers['content-encoding'] === 'gzip'
            let data: Uint8Array = Buffer.from([])
            if (isGzip) {
              const gunzip = createGunzip()
              res.pipe(gunzip)
              for await (const chunk of gunzip) {
                data = Buffer.concat([data, chunk])
              }
            } else {
              for await (const chunk of res) {
                data = Buffer.concat([data, chunk])
              }
            }

            if (isJson) {
              const content = data.toString()
              try {
                console.log(JSON.stringify(JSON.parse(content), null, 2))
              } catch (err) {
                console.log(content)
              }
            }

            const response = h.response(isGzip ? await promisify(gzip)(data) : data)
            Object.assign(response.headers, res.headers)
            return response
          }
        })
      }
    }
  ])
};

start();
