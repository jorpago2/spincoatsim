import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const limits = {
  js: { raw: 650_000, gzip: 210_000 },
  css: { raw: 950_000, gzip: 115_000 },
}

const files = await readdir(new URL('../dist/assets/', import.meta.url))

for (const extension of ['js', 'css']) {
  const buffers = await Promise.all(
    files
      .filter((file) => file.endsWith(`.${extension}`))
      .map((file) => readFile(new URL(`../dist/assets/${file}`, import.meta.url))),
  )
  const raw = buffers.reduce((total, buffer) => total + buffer.byteLength, 0)
  const gzip = buffers.reduce(
    (total, buffer) => total + gzipSync(buffer).byteLength,
    0,
  )
  const budget = limits[extension]
  console.log(
    `${extension.toUpperCase()}: ${(raw / 1024).toFixed(1)} KiB raw, ${(gzip / 1024).toFixed(1)} KiB gzip`,
  )
  if (raw > budget.raw || gzip > budget.gzip) {
    throw new Error(
      `${extension.toUpperCase()} bundle exceeds its declared raw/gzip budget.`,
    )
  }
}
