// Headless render smoke check against the running Vite dev server (localhost:5173).
// Uses a throwaway Chrome profile under /tmp and a fake portfolio, so no real browser data is touched.
// Usage: node contracts/tools/smoke-render.mjs outlook   (or holdings, optimize, risk)
//        node contracts/tools/smoke-render.mjs outlook "Monte Carlo"   (also clicks the in-page tab with that label)
// Prints any uncaught exception and console error, the final URL (to check redirects), then the first 400 characters of #root.
// An empty ROOT TEXT means the page rendered blank. SMOKE_WAIT_MS=10000 waits longer after the sub-tab click (slow API).
// SMOKE_CLICKS="COVID crash|Run Scenario" then clicks those buttons in order (text contains the label).
// SMOKE_EVAL='<js expression>' prints the expression's value at the end.
import { spawn } from 'node:child_process'

const tab = process.argv[2] ?? 'outlook'
const subTab = process.argv[3]
const port = 9333
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/be_scratch/chrome', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  // Chrome can answer /json before it has opened a page, so wait for a page target, and create one if none appears.
  let page
  for (let attempt = 0; attempt < 60 && !page; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      page = targets.find((target) => target.type === 'page')
      if (!page && attempt >= 20) page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
    } catch {
      // Chrome is not listening yet.
    }
    if (!page) await sleep(250)
  }
  if (!page) throw new Error(`Chrome opened no page on port ${port}. Is another Chrome using that port, or is the launch blocked?`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve))
  let nextId = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result)
      pending.delete(message.id)
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      console.log('EXCEPTION:', (details.exception?.description ?? details.text).slice(0, 1200))
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      console.log('CONSOLE.error:', message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 1200))
    }
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: 'http://localhost:5173/' })
  await sleep(2500)
  const portfolio = {
    id: 'smoke',
    name: 'Smoke test',
    cashWeight: 38,
    updatedAt: '2026-09-01T00:00:00.000Z',
    // SMOKE_POSITIONS='[{"ticker":"XLK","weight":10,"shares":5},…]' swaps in other holdings.
    positions: process.env.SMOKE_POSITIONS
      ? JSON.parse(process.env.SMOKE_POSITIONS)
      : [
          { ticker: 'XLK', weight: 20, shares: 10 },
          { ticker: 'MS', weight: 22, shares: 20 },
          { ticker: 'GLD', weight: 20, shares: 5 },
        ],
  }
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('bec-portfolios', ${JSON.stringify(JSON.stringify([portfolio]))})`,
  })
  await send('Page.navigate', { url: `http://localhost:5173/portfolios/smoke/${tab}` })
  await sleep(5000)
  if (subTab !== undefined) {
    const clicked = await send('Runtime.evaluate', {
      expression: `(() => { const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.innerText.trim() === ${JSON.stringify(subTab)}); tab?.click(); return tab !== undefined })()`,
    })
    console.log('SUB-TAB CLICKED:', clicked.result.value)
    await sleep(Number(process.env.SMOKE_WAIT_MS ?? 3000))
  }
  // SMOKE_CLICKS="COVID crash|Run Scenario" clicks, in order, the first button whose text contains each label.
  for (const label of (process.env.SMOKE_CLICKS ?? '').split('|').filter(Boolean)) {
    const hit = await send('Runtime.evaluate', {
      expression: `(() => { const b = [...document.querySelectorAll('button')].find((el) => el.innerText.includes(${JSON.stringify(label)})); b?.click(); return b !== undefined })()`,
    })
    console.log(`CLICKED ${JSON.stringify(label)}:`, hit.result.value)
    await sleep(Number(process.env.SMOKE_WAIT_MS ?? 3000))
  }
  const url = await send('Runtime.evaluate', { expression: 'location.href' })
  console.log('FINAL URL:', url.result.value)
  const root = await send('Runtime.evaluate', { expression: `document.getElementById('root')?.innerText.slice(0, 400)` })
  console.log('ROOT TEXT:', JSON.stringify(root.result.value))
  // The header ticker tape fills ROOT TEXT, so also print the page body: <main> if present, else #root.
  const body = await send('Runtime.evaluate', {
    expression: `(document.querySelector('main') ?? document.getElementById('root'))?.innerText.slice(0, 1500)`,
  })
  console.log('PAGE TEXT:', JSON.stringify(body.result.value))
  // SMOKE_EVAL='<js expression>' prints that expression's value too (e.g. SVG tick labels innerText misses).
  if (process.env.SMOKE_EVAL) {
    const extra = await send('Runtime.evaluate', { expression: process.env.SMOKE_EVAL, returnByValue: true })
    console.log('EVAL:', JSON.stringify(extra.result.value ?? extra.result.description))
  }
  ws.close()
} finally {
  chrome.kill()
}
