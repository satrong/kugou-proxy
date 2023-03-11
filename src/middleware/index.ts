import type { Middleware } from './define'
import kugou from './middleware.kugou'

export const middleware: Middleware[] = [
  kugou
]
