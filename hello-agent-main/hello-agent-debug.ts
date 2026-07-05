// hello-agent-debug.ts —— 简化版，用本地 stub 模拟模型，便于调试 stdin/断点
import readline from 'node:readline'

type Chunk =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolName: string; input: any }
  | { type: 'tool-result'; output: any }

async function mockStream(messages: any) {
  const lastUser = messages[messages.length - 1]?.content ?? ''
  const fullStream = (async function* () {
    yield { type: 'text-delta', text: `（模拟）助手正在思考...\n` } as Chunk
    // 模拟逐步输出
    for (const ch of `模拟回复：你说的是 -> ${lastUser}`) {
      yield { type: 'text-delta', text: ch } as Chunk
      await new Promise((r) => setTimeout(r, 8))
    }
    yield { type: 'text-delta', text: '\n' } as Chunk
  })()

  const response = Promise.resolve({ messages: [{ role: 'assistant', content: `模拟回复：${lastUser}` }] })
  return { fullStream, response }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string) => new Promise<string>((r) => rl.question(q, r))
  const messages: Array<{ role: 'user' | 'assistant'; content: any }> = []

  for (;;) {
    const input = (await ask('\n你: ')).trim()
    if (!input || input === 'exit') break
    messages.push({ role: 'user', content: input })

    const result = await mockStream(messages)

    process.stdout.write('助手: ')
    for await (const chunk of result.fullStream) {
      if (chunk.type === 'text-delta') process.stdout.write(chunk.text)
      else if (chunk.type === 'tool-call') process.stdout.write(`\n  [调用 ${chunk.toolName}(${JSON.stringify(chunk.input)})]`)
      else if (chunk.type === 'tool-result') process.stdout.write(`\n  [返回 ${String(chunk.output).length} 字节]\n助手: `)
    }

    const { messages: newMessages } = await result.response
    messages.push(...(newMessages as any))
  }

  rl.close()
}

main().catch((e) => {
  console.error('ERROR', e)
  process.exit(1)
})
