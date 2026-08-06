import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const buildTempDirectory = path.join(projectRoot, 'build-temp')
const vendorDirectory = path.join(projectRoot, 'vendor')
const distDirectory = path.join(projectRoot, 'dist')
const compiledAppSource = path.join(buildTempDirectory, 'app.js')
const compiledAppTarget = path.join(projectRoot, 'app.js')
const xlsxSource = path.join(projectRoot, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js')
const xlsxTarget = path.join(vendorDirectory, 'xlsx.full.min.js')

await rm(distDirectory, { recursive: true, force: true })
await mkdir(vendorDirectory, { recursive: true })
await copyFile(compiledAppSource, compiledAppTarget)
await copyFile(xlsxSource, xlsxTarget)
await rm(buildTempDirectory, { recursive: true, force: true })
