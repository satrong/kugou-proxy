import type { IncomingMessage } from 'http'

export type Middleware = (req: IncomingMessage, res: IncomingMessage) => void

export function defineMiddleware(middleware: Middleware) {
  return middleware
}