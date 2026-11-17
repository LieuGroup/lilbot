/** Native by default; pass a Bun target and output path for release binaries. */
import { createHash } from 'node:crypto'
const [target, output = 'dist/lilbot-helper'] = process.argv.slice(2)
const child = Bun.spawn(['bun', 'build', '--compile', ...(target ? [`--target=${target}`] : []), 'helper/main.ts', '--outfile', output], { stdout: 'inherit', stderr: 'inherit' })
if (await child.exited) throw new Error('Helper build failed.')
const checksum = createHash('sha256').update(Buffer.from(await Bun.file(output).arrayBuffer())).digest('hex')
await Bun.write(`${output}.sha256`, `${checksum}\n`)
