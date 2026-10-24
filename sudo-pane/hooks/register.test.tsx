import { expect, test } from 'claude-code/testing'

import { unmask } from './register'

const BAND = {
  plugin: 'sudo-pane',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

test('unmask giữ chữ thật sau chấm', async () => {
  expect(unmask('', 'a')).toBe('a')
  expect(unmask('a', '•b')).toBe('ab')
  expect(unmask('ab', '•')).toBe('a')
  expect(unmask('ab', '•x•')).toBe('axb')
  expect(unmask('abc', '')).toBe('')
  // Telex: xoá chữ cuối rồi gửi chữ có dấu trong cùng một lần
  expect(unmask('a', 'á')).toBe('á')
  expect(unmask('xa', '•á')).toBe('xá')
  expect(unmask('dd', '•đ')).toBe('dđ')
  expect(unmask('ab', 'đ•')).toBe('đb')
  expect(unmask('abc', '•ê')).toBe('aê')
})

test('sudo command: hỏi trong pane, sai thì hỏi lại, đúng thì chạy với SUDO_ASKPASS', async ($, on) => {
  const stashed: string[] = []
  const wiped: string[] = []
  const commands: string[] = []
  // `sleep` của vòng chờ chỉ trả lời khi test bơm, để vòng đó không chiếm hết lượt
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
    if (cmd === 'sudo') return ok(e.init?.stdin === 'hunter2\n' ? 0 : 1)
    if (cmd === 'sh') {
      stashed.push(e.init?.stdin ?? '')
      return ok(0, '/run/user/1/sudo-pane-1')
    }
    if (cmd === 'rm') {
      wiped.push(args.join(' '))
      return ok(0)
    }
    if (cmd === 'sleep') return new Promise(resolve => waiters.push(() => resolve(ok(0))))
    return ok(0)
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('tool.call', (_, e) => {
    commands.push(String((e as { command?: string }).command))
    return { result: { stdout: 'done', stderr: '', interrupted: false } }
  })

  // Mỗi lần đọc là một lần vẽ mới, như engine vẽ lại sau invalidate.
  const mount = () => $.ui.mount(BAND)
  const pane = async <T,>(act: (ui: Awaited<ReturnType<typeof mount>>) => Promise<T>) => {
    const ui = await mount()
    const out = await act(ui)
    await ui.unmount()
    return out
  }
  const field = () => pane(ui => ui.find({ key: 'pw' }))
  const until = async (seen: () => Promise<unknown>) => {
    for (let i = 0; i < 100; i += 1) {
      if (await seen()) return
      await pump()
    }
  }

  // lệnh không có sudo đi thẳng
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(commands).toEqual(['ls'])

  const call = $.tool.call({ tool: 'Bash', command: 'sudo apt update' })
  await until(field)
  expect((await field())?.type).toBe('Input')

  // gõ sai trước
  await pane(ui => ui.input({ key: 'pw', text: 'x', kind: 'change' }))
  expect((await field())?.props.value).toBe('•')
  await pane(ui => ui.input({ key: 'pw', text: '•' }))
  await until(() => pane(ui => ui.find({ type: 'Text', text: /Sai password/ })))
  expect(await pane(ui => ui.find({ type: 'Text', text: /Sai password/ }))).toBeDefined()
  expect((await field())?.props.value).toBe('')

  // gõ từng chữ: ô chỉ hiện chấm
  let shown = ''
  for (const ch of 'hunter2') {
    await pane(ui => ui.input({ key: 'pw', text: shown + ch, kind: 'change' }))
    shown = String((await field())?.props.value)
  }
  expect(shown).toBe('•••••••')
  await pane(ui => ui.input({ key: 'pw', text: shown }))
  await pump()

  const result = await call
  expect(result.deny).toBeUndefined()
  expect(commands[1]).toBe("export SUDO_ASKPASS='/run/user/1/sudo-pane-1/askpass'\nsudo apt update")
  expect(stashed).toEqual(['hunter2'])
  expect(wiped).toEqual(['-f /run/user/1/sudo-pane-1/pw'])
  expect(JSON.stringify(commands)).not.toContain('hunter2')
  expect((await field())?.type).toBeUndefined()

  // lần sau trong 15 phút: không hỏi nữa
  await $.tool.call({ tool: 'Bash', command: 'sudo true' })
  expect(commands[2]).toContain('sudo true')
})
