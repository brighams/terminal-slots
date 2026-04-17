#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'

const SAVE_FILE   = join(homedir(), '.terminal-slots')
const KITTY_START = 500

const SYMBOLS = ['🍒', '🍊', '🍉', '🍇', '🍀', '🍓', '🔔', '⭐', '💎', '👑']
const WEIGHTS  = [ 40,   20,  15,   12,   11,   10,   8,   5,   3,   1]
const SIMPLE   = new Set(['🍒', '🍊'])

const POOL = WEIGHTS.flatMap((w, i) => Array(w).fill(SYMBOLS[i]))

const FLAT_PAYOUTS = {
  '🍒🍒🍒':  4,
  '🍊🍊🍊':  8,
  '🍉🍉🍉': 10,
  '🍇🍇🍇': 15,
  '🍓🍓🍓': 25,
  '🔔🔔🔔': 50,
}

const MULTIPLIERS = {
  '🍀🍀🍀': 2,
  '⭐⭐⭐': 3,
  '💎💎💎': 4,
}

const STOP_TIMES    = [1200, 1900, 2600]
const TICK_MS       = 80
const DISPLAY_LINES = 10

const load_state = () => {
  if (existsSync(SAVE_FILE)) {
    try { return JSON.parse(readFileSync(SAVE_FILE, 'utf8')) } catch {}
  }
  return { credits: 100, kitty: KITTY_START, spins: 0, wins: 0, jackpots: 0 }
}

const save_state = (state) => writeFileSync(SAVE_FILE, JSON.stringify(state, null, 2))

const rand_sym = () => POOL[Math.floor(Math.random() * POOL.length)]
const rand_col = () => [rand_sym(), rand_sym(), rand_sym()]

const check_win = (center, bet, kitty) => {
  const [a, b, c] = center
  const key = `${a}${b}${c}`

  if (key === '👑👑👑') {
    return { amount: kitty, label: `👑👑👑  JACKPOT!  WIN THE KITTY!`, jackpot: true }
  }

  if (MULTIPLIERS[key]) {
    return { amount: MULTIPLIERS[key] * bet, label: `THREE ${a}! x${MULTIPLIERS[key]} bet`, triple: true }
  }

  if (FLAT_PAYOUTS[key]) {
    return { amount: FLAT_PAYOUTS[key], label: `THREE ${a}! +${FLAT_PAYOUTS[key]} credits`, triple: true }
  }

  if (SIMPLE.has(a) && a === b) {
    return { amount: 5, label: `Two ${a} in slots 1&2! +5 credits` }
  }

  if (a === '🍒') return { amount: 2, label: `🍒 in slot 1! +2 credits` }
  if (SIMPLE.has(a)) return { amount: 1, label: `${a} in slot 1! +1 credit` }

  return { amount: 0, label: 'No win...' }
}

// --- audio ---

const RATE = 22050

const play_buf = (buf) => {
  const p = spawn('aplay', ['-r', String(RATE), '-f', 'S16_LE', '-c', '1', '-q', '-'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  p.on('error', () => {})
  p.stdin.on('error', () => {})
  p.stdin.write(buf)
  p.stdin.end()
}

const make_tone = (freq, ms, vol = 0.35) => {
  const n = Math.floor(RATE * ms / 1000)
  const buf = Buffer.allocUnsafe(n * 2)
  let phase = 0
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * freq) / RATE
    const env = Math.min(i / 30, 1) * Math.max(0, 1 - i / n * 0.85)
    buf.writeInt16LE(Math.floor(Math.sin(phase) * vol * env * 32767), i * 2)
  }
  return buf
}

const make_sweep = (f0, f1, ms, vol = 0.3) => {
  const n = Math.floor(RATE * ms / 1000)
  const buf = Buffer.allocUnsafe(n * 2)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    phase += (2 * Math.PI * (f0 + (f1 - f0) * t)) / RATE
    const env = Math.min(i / 20, 1) * (1 - t * 0.7)
    buf.writeInt16LE(Math.floor(Math.sin(phase) * vol * env * 32767), i * 2)
  }
  return buf
}

const silence = (ms) => Buffer.alloc(Math.floor(RATE * ms / 1000) * 2, 0)

const SEQ_SMALL = [make_tone(523, 110), make_tone(659, 170)]
const SEQ_MED   = [make_tone(523, 90),  make_tone(659, 90),  make_tone(784, 210)]
const SEQ_BIG   = [make_tone(523, 70),  make_tone(659, 70),  make_tone(784, 70), make_tone(1047, 320)]
const SEQ_JACK  = [make_tone(523, 70),  make_tone(659, 70),  make_tone(784, 70),
                   make_tone(1047, 70), make_tone(1319, 70), make_tone(1047, 70), make_tone(1319, 420)]

const SFX = {
  press:      () => play_buf(make_sweep(700, 250, 90)),
  lock:       (col) => play_buf(make_sweep(280 - col * 55, 90 - col * 15, 130, 0.45)),
  lose:       () => play_buf(Buffer.concat([make_sweep(420, 210, 180), silence(40), make_sweep(310, 140, 200)])),
  win_small:  () => play_buf(Buffer.concat(SEQ_SMALL)),
  win_med:    () => play_buf(Buffer.concat(SEQ_MED)),
  win_big:    () => play_buf(Buffer.concat(SEQ_BIG)),
  win_triple: () => play_buf(Buffer.concat([...SEQ_SMALL, silence(80), ...SEQ_MED, silence(80), ...SEQ_BIG])),
  jackpot:    () => play_buf(Buffer.concat([...SEQ_SMALL, silence(60), ...SEQ_MED, silence(60), ...SEQ_BIG, silence(60), ...SEQ_JACK])),
}

const play_win_sfx = ({ amount, triple, jackpot }) => {
  if (jackpot)        SFX.jackpot()
  else if (triple)    SFX.win_triple()
  else if (amount >= 25) SFX.win_big()
  else if (amount >= 6)  SFX.win_med()
  else                   SFX.win_small()
}

// --- display ---

const out  = (s) => process.stdout.write(s)
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const render = (cols, credits, bet, kitty, msg, first = false) => {
  const [c0, c1, c2] = cols
  const lines = [
    '╔═══════════════════════╗',
    '║   🎰 TERMINAL SLOTS   ║',
    '╠═══════╦═══════╦═══════╣',
    `║  ${c0[0]}   ║  ${c1[0]}   ║  ${c2[0]}   ║`,
    `║> ${c0[1]}  <║> ${c1[1]}  <║> ${c2[1]}  <║`,
    `║  ${c0[2]}   ║  ${c1[2]}   ║  ${c2[2]}   ║`,
    '╚═══════╩═══════╩═══════╝',
    `  Credits: ${String(credits).padEnd(6)} Bet: ${String(bet).padEnd(5)}`,
    `  Kitty:   ${String(kitty).padEnd(6)}`,
    `  ${msg.padEnd(48)}`,
  ]
  if (!first) out(`\x1b[${DISPLAY_LINES}A\r`)
  for (const line of lines) {
    out(`\x1b[2K\r${line}\n`)
  }
}

const jackpot_flash = async (cols, credits, kitty, msg) => {
  for (let i = 0; i < 12; i++) {
    out(i % 2 === 0 ? '\x1b[7m' : '\x1b[m')
    render(cols, credits, 0, kitty, msg)
    await wait(180)
  }
  out('\x1b[m')
}

// --- spin ---

const spin_animation = (credits, bet, kitty, cols) => new Promise((resolve) => {
  const result = [rand_sym(), rand_sym(), rand_sym()]
  const cur    = cols.map(c => [...c])
  const locked = [false, false, false]
  const start  = Date.now()

  const tick = setInterval(() => {
    const elapsed = Date.now() - start

    for (let i = 0; i < 3; i++) {
      if (!locked[i]) {
        if (elapsed >= STOP_TIMES[i]) {
          locked[i] = true
          cur[i] = [rand_sym(), result[i], rand_sym()]
          SFX.lock(i)
        } else {
          cur[i] = rand_col()
        }
      }
    }

    render(cur, credits, bet, kitty, 'Spinning...')

    if (locked.every(Boolean)) {
      clearInterval(tick)
      resolve({ result, cols: cur })
    }
  }, TICK_MS)
})

// --- input ---

const get_key = () => new Promise((resolve) => {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  const handler = (key) => {
    process.stdin.removeListener('data', handler)
    process.stdin.setRawMode(false)
    process.stdin.pause()
    if (key === '\x03') { out('\x1b[?25h\n'); process.exit(0) }
    resolve(key.toLowerCase())
  }
  process.stdin.on('data', handler)
})

// --- main ---

const main = async () => {
  if (!process.stdin.isTTY) {
    console.error('terminal-slots requires an interactive terminal')
    process.exit(1)
  }

  out('\x1b[?25l')
  process.on('exit', () => out('\x1b[?25h'))
  process.on('SIGINT', () => { out('\x1b[?25h\n'); process.exit(0) })

  const state = load_state()
  if (state.kitty === undefined) state.kitty = KITTY_START
  let bet  = 1
  let cols = [rand_col(), rand_col(), rand_col()]

  render(cols, state.credits, bet, state.kitty, 'SPACE to spin  Q to quit', true)

  while (true) {
    if (state.credits < bet) {
      const win_rate = state.spins > 0 ? Math.round(state.wins / state.spins * 100) : 0
      const stat_lines = [
        '╔═══════════════════════╗',
        '║   🎰 TERMINAL SLOTS   ║',
        '╠═══════════════════════╣',
        '║      GAME  OVER       ║',
        '║                       ║',
        `║  Spins:     ${String(state.spins).padEnd(10)}║`,
        `║  Wins:      ${String(state.wins).padEnd(10)}║`,
        `║  Jackpots:  ${String(state.jackpots ?? 0).padEnd(10)}║`,
        `║  Win rate:  ${String(win_rate + '%').padEnd(10)}║`,
        '╚═══════════════════════╝',
      ]
      out(`\x1b[${DISPLAY_LINES}A\r`)
      for (const line of stat_lines) out(`\x1b[2K\r${line}\n`)
      out('\x1b[2K\r  Press ENTER to play again\n')

      await get_key()

      state.credits  = 100
      state.kitty    = KITTY_START
      state.spins    = 0
      state.wins     = 0
      state.jackpots = 0
      bet  = 1
      cols = [rand_col(), rand_col(), rand_col()]
      save_state(state)
      render(cols, state.credits, bet, state.kitty, 'SPACE to spin  Q to quit')
      continue
    }

    const key = await get_key()
    if (key === 'q') break
    if (key !== ' ' && key !== '\r' && key !== '\n') continue

    state.credits -= bet
    state.spins++
    save_state(state)
    SFX.press()

    const { result, cols: new_cols } = await spin_animation(state.credits, bet, state.kitty, cols)
    cols = new_cols
    const win = check_win(result, bet, state.kitty)

    if (win.amount > 0) {
      state.wins++
      play_win_sfx(win)

      if (win.jackpot) {
        const won = win.amount
        state.jackpots++
        state.kitty = KITTY_START
        save_state(state)
        await jackpot_flash(cols, state.credits, state.kitty, `JACKPOT! +${won} credits!`)
        render(cols, state.credits, bet, state.kitty, `${win.label}  [L]et it ride  [T]ake  [Q]uit`)
      } else {
        save_state(state)
        render(cols, state.credits, bet, state.kitty, `${win.label}  [L]et it ride  [T]ake  [Q]uit`)
      }

      let chose = false
      while (!chose) {
        const choice = await get_key()
        if (choice === 'l') {
          bet = bet + win.amount
          render(cols, state.credits, bet, state.kitty, `Riding ${bet} cr!  SPACE to spin`)
          chose = true
        } else if (choice === 't') {
          state.credits += win.amount
          bet = 1
          save_state(state)
          render(cols, state.credits, bet, state.kitty, `Took ${win.amount}!  Total: ${state.credits} cr  SPACE to spin`)
          chose = true
        } else if (choice === 'q') {
          state.credits += win.amount
          bet = 1
          save_state(state)
          render(cols, state.credits, bet, state.kitty, `Took ${win.amount} and quit. Final: ${state.credits} credits`)
          out('\x1b[?25h\n')
          process.exit(0)
        }
      }
    } else {
      state.kitty += bet
      bet = 1
      save_state(state)
      SFX.lose()
      render(cols, state.credits, bet, state.kitty, `${win.label}  SPACE to spin`)
    }
  }

  out('\x1b[?25h\n')
}

main().catch((err) => {
  out('\x1b[?25h\n')
  console.error(err)
  process.exit(1)
})
