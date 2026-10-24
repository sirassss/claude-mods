// File riêng: password nhớ trong module ở file test kia sẽ làm lần này không hỏi.
import { expect, test } from 'claude-code/testing'

test('dải bị mod khác chiếm: sau 1 giây mở pane để nhập', async ($, on) => {
  let now = 0
  let opened = 0
  let waiters: (() => void)[] = []
  const pump = async () => {
    for (let i = 0; i < 5; i += 1) {
      const due = waiters
      waiters = []
      due.forEach(wake => wake())
      for (let j = 0; j < 50; j += 1) await Promise.resolve()
    }
  }
  const ok = (exitCode: number, stdout = '') => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('process.run', (_, e) => {
    const [cmd, ...args] = e.argv
    if (cmd === 'sudo' && args[0] === '-n') return ok(1)
    if (cmd === 'sudo') return ok(e.init?.stdin === 'pw\n' ? 0 : 1)
    if (cmd === 'sh') return ok(0, '/run/user/1/sudo-pane-1')
    if (cmd === 'sleep') return new Promise(resolve => waiters.push(() => { now += 200; resolve(ok(0)) }))
    return ok(0)
  })
  on('clock.now', () => ({ value: now }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => { opened += 1; return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('tool.call', () => ({ result: { stdout: 'root', stderr: '', interrupted: false } }))

  const call = $.tool.call({ tool: 'Bash', command: 'sudo whoami' })
  // Không mount dải: coi như mod khác đang chiếm nó.
  // Mount một pane khác chỉ để nhường lượt cho các lệnh `$` của mod (vẽ ra 'engine').
  const tick = async () => {
    await pump()
    await (await $.ui.mount({ ...PANE_FALLBACK, requestId: 'other' })).unmount()
  }
  for (let i = 0; opened === 0 && i < 50; i += 1) await tick()
  expect(opened).toBe(1)

  const pane = await $.ui.mount({ ...PANE_FALLBACK })
  expect((await pane.find({ type: 'Text', text: /ctrl\+x tab/ }))).toBeUndefined()
  await pane.input({ key: 'pw', text: 'p', kind: 'change' })
  await pane.unmount()
  const again = await $.ui.mount({ ...PANE_FALLBACK })
  await again.input({ key: 'pw', text: '•w', kind: 'change' })
  await again.unmount()
  const last = await $.ui.mount({ ...PANE_FALLBACK })
  await last.input({ key: 'pw', text: '••' })
  await last.unmount()
  for (let i = 0; i < 5; i += 1) await tick()
  expect((await call).deny).toBeUndefined()
})

const PANE_FALLBACK = {
  plugin: 'sudo-pane',
  component: 'Pane',
  requestId: 'sudo-pane',
  surface: 'terminal',
  props: {
    title: 'sudo password',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const
