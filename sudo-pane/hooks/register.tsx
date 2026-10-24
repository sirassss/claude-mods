import type { EngineInterface as Engine, Register, RenderInput } from 'claude-code'

// sudo-pane: một lệnh Bash có `sudo` bị giữ lại, dải trên ô input hỏi password, password
// được kiểm bằng `sudo -S -v` rồi ghi vào file 0600 trong $XDG_RUNTIME_DIR.
// Lệnh chạy bằng Bash tool như thường với SUDO_ASKPASS trỏ tới script đọc
// file đó (sudo không có tty thì tự dùng askpass), xong thì xoá file.
// Password không bao giờ nằm trong lệnh, argv hay transcript.

const DOT = '•'
const SUDO = /(^|[\s;&|(`])sudo(\s|$)/
const POLL_SECONDS = '0.2'
const HOLD_LIMIT_MS = 5 * 60 * 1000
const PANE = 'sudo-pane'
const BAND_WAIT_MS = 1000
const STALE_MS = 20_000 // dài hơn timeout 15 s của bước kiểm password
// ponytail: nhớ password trong RAM của module 15 phút như timestamp của sudo; muốn hỏi mỗi lần thì đặt 0
const REMEMBER_MS = 15 * 60 * 1000

// Password vào stdin, không qua argv. In ra thư mục chứa file.
const STASH = `umask 077; d="\${XDG_RUNTIME_DIR:-/tmp}/sudo-pane-$(id -u)"
mkdir -p "$d" && cat > "$d/pw" && printf '#!/bin/sh\\ncat "%s/pw"\\n' "$d" > "$d/askpass" && chmod 700 "$d/askpass" && printf %s "$d"`

type Held = {
  command: string
  typed: string
  error?: string
  isChecking: boolean
  answer: null | 'submit' | 'cancel'
  // Lần cuối vòng chờ còn sống; hook bị huỷ giữa chừng có thể không kịp dọn `held`.
  beat: number
  // Dải đã được vẽ chưa: mod khác (replay-theater) có thể đang chiếm dải.
  isDrawn: boolean
}

let held: Held | null = null
let remembered: { pw: string; until: number } | null = null

// Ô nhập không có chế độ ẩn, nên mỗi lần gõ ta vẽ lại ô bằng chấm và tự giữ
// chữ thật. `value` là nội dung ô sau lần gõ: chấm còn lại hai bên, chữ mới ở
// giữa. Bộ gõ tiếng Việt (Telex/VNI) gửi xoá + chữ mới trong một lần (a → á),
// nên phần chấm bị mất ở giữa là phần bị thay.
export const unmask = (typed: string, value: string): string => {
  const at = value.search(/[^•]/)
  if (at === -1) return typed.slice(0, value.length) // chỉ xoá
  const fresh = value.slice(at).replace(/•+$/, '')
  const kept = Math.min(value.length - at - fresh.length, typed.length - at)
  return typed.slice(0, at) + fresh + typed.slice(typed.length - kept)
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!SUDO.test(e.command)) return next(e)
    // NOPASSWD hoặc đã có quyền: không cần hỏi.
    if ((await $.process.run(['sudo', '-n', 'true'], { timeoutMs: 5000 })).exitCode === 0) return next(e)

    const now = await $.clock.now()
    const pw = remembered && remembered.until > now ? remembered.pw : await ask($, e.command, next.signal)
    if (pw === null) {
      return { deny: 'sudo-pane: người dùng không nhập sudo password (huỷ, hết giờ hoặc turn bị ngắt), lệnh chưa chạy. Đừng thử lại trừ khi người dùng yêu cầu.' }
    }
    remembered = { pw, until: now + REMEMBER_MS }

    const stash = await $.process.run(['sh', '-c', STASH], { stdin: pw, timeoutMs: 5000 })
    if (stash.exitCode !== 0) return { deny: `sudo-pane: không ghi được file askpass: ${stash.stderr.trim()}` }
    const dir = stash.stdout

    let isBackground = false
    try {
      const ran = await next({ ...e, command: `export SUDO_ASKPASS='${dir}/askpass'\n${e.command}` })
      isBackground = (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId !== undefined
      return ran
    } finally {
      // Lệnh chạy nền còn cần file thêm một lúc để sudo kịp đọc.
      if (isBackground) $.clock.after(60_000, () => void wipe($, dir))
      else await wipe($, dir)
    }
  })

  // Vẽ vào dải ngay trên ô input; dải không tự lấy bàn phím được nên người
  // dùng bấm ctrl+x tab (hoặc click) để vào ô.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (held === null) return next(e)
    held.isDrawn = true
    return draw($, e, held)
  })

  // Dự phòng khi dải không tới lượt mod này.
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e, next) =>
    held === null ? next(e) : draw($, e, held),
  )
}

async function wipe($: Engine, dir: string) {
  await $.process.run(['rm', '-f', `${dir}/pw`], { timeoutMs: 5000 })
}

// Giữ lệnh tới khi có password đúng; null khi huỷ, hết giờ hay bị ngắt.
// Hook chỉ có 10 s thời gian riêng, thời gian trong lệnh `$` thì không tính,
// nên chờ bằng `sleep` qua $.process.run như blast-radius.
async function ask($: Engine, command: string, signal: AbortSignal): Promise<string | null> {
  while (held !== null && (await $.clock.now()) - held.beat < STALE_MS) {
    if (signal.aborted) return null
    await $.process.run(['sleep', POLL_SECONDS], { timeoutMs: 5000 })
  }
  const mine: Held = { command, typed: '', isChecking: false, answer: null, beat: await $.clock.now(), isDrawn: false }
  held = mine
  let isPaned = false
  try {
    $.ui.invalidate('ui.render')

    const startedAt = await $.clock.now()
    for (;;) {
      mine.beat = await $.clock.now()
      if (signal.aborted || mine.answer === 'cancel') return null
      if ((await $.clock.now()) - startedAt > HOLD_LIMIT_MS) return null
      if (!mine.isDrawn && !isPaned && mine.beat - startedAt > BAND_WAIT_MS) {
        isPaned = true
        await $.ui.open({ id: PANE, title: 'sudo password', focus: true, rows: 8 })
      }
      if (mine.answer === 'submit') {
        mine.answer = null
        mine.isChecking = true
        $.ui.invalidate('ui.render')
        const check = await $.process.run(['sudo', '-k', '-S', '-p', '', '-v'], { stdin: `${mine.typed}\n`, timeoutMs: 15000 })
        mine.isChecking = false
        mine.beat = await $.clock.now()
        if (check.exitCode === 0) return mine.typed
        mine.typed = ''
        mine.error = 'Sai password, nhập lại.'
        $.ui.invalidate('ui.render')
      }
      await $.process.run(['sleep', POLL_SECONDS], { timeoutMs: 5000 })
    }
  } catch (err) {
    if (signal.aborted) return null // Esc/ngắt turn làm `sleep` bị huỷ: coi như huỷ
    throw err
  } finally {
    if (isPaned) await $.ui.close({ id: PANE }).catch(() => {})
    if (held === mine) held = null
    $.ui.invalidate('ui.render')
  }
}

function draw($: Engine, e: RenderInput, state: Held) {
  const ui = $.ui.resolve(e)
  // mobile không có Input
  if (!('Input' in ui)) return <ui.Text>Claude cần sudo password: nhập ở terminal.</ui.Text>
  const { Box, Text, Input, Button } = ui
  // Các closure trả lời đúng lần hỏi mà dải được vẽ cho.
  const typing = (value: string) => {
    state.typed = unmask(state.typed, value)
    state.error = undefined
    $.ui.invalidate('ui.render')
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>
        <Text bold color="yellow">🔒 Claude cần sudo</Text>
        {e.component === 'AbovePrompt' && <Text dimColor>  ·  bấm </Text>}
        {e.component === 'AbovePrompt' && <Text bold>ctrl+x tab</Text>}
        {e.component === 'AbovePrompt' && <Text dimColor> để nhập, Esc để ra</Text>}
      </Text>
      <Text wrap="truncate-end">
        <Text dimColor>Lệnh  </Text>
        <Text bold>{state.command}</Text>
      </Text>
      <Input
        key="pw"
        label="Password "
        value={DOT.repeat(state.typed.length)}
        submitLabel="chạy"
        autoFocus
        onInput={typing}
        onSubmit={() => {
          if (state.answer === null && !state.isChecking) state.answer = 'submit'
        }}
      />
      {state.isChecking && <Text dimColor>Đang kiểm tra…</Text>}
      {state.error !== undefined && <Text color="red">{state.error}</Text>}
      <Box gap={2}>
        <Button key="cancel" label="Huỷ" plain onPress={() => { state.answer = 'cancel' }} />
        <Text dimColor>Password không vào transcript; nhớ 15 phút trong phiên này.</Text>
      </Box>
    </Box>
  )
}
