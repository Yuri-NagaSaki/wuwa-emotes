// Copy the Cap widget's WASM (and the pako fallback for browsers without DecompressionStream) into
// public/cap/ so the widget never fetches from jsDelivr. The widget is pointed here via
// window.CAP_CUSTOM_WASM_URL / CAP_CUSTOM_HASHWX_URL / CAP_PAKO_URL (see src/ui/cap).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'cap')
mkdirSync(out, { recursive: true })

const files: [string, string][] = [
  ['node_modules/@cap.js/wasm/browser/cap_wasm_bg.wasm', 'cap_wasm_bg.wasm'],
  ['node_modules/@cap.js/wasm/browser/hashwx.wasm', 'hashwx.wasm'],
]
const pakoCandidates = ['node_modules/pako/dist/browser/pako_inflate.umd.min.js', 'node_modules/pako/dist/browser/pako_inflate.min.js']
const pako = pakoCandidates.find((p) => existsSync(join(root, p)))
if (pako) files.push([pako, 'pako_inflate.min.js'])

for (const [from, to] of files) copyFileSync(join(root, from), join(out, to))
console.log(`cap assets: ${files.map(([, to]) => to).join(', ')} -> public/cap/`)
