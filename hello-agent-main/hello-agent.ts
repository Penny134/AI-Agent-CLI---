// 依赖：ai @ai-sdk/deepseek zod
// 启动：npx tsx hello-agent.ts

import { deepseek } from '@ai-sdk/deepseek'  //@...是SDK给deepseek提供的适配器（Adapter），负责屏蔽不同供应商的API差异，对外提供统一接口,后续如果要切换到 OpenAI 或 Anthropic，只需替换一行 model: deepseek(...) 为 model: openai(...)，其余代码不动。
//需要加载记忆是此处多加了个 generateText
import { streamText, stepCountIs, tool, generateText } from 'ai'  //ai包是SDK主题，导出三个核心api，streamText 用于向模型发起流式请求，stepCountIs 用于设定工具调用轮数上限，tool 用于定义工具。
import { z } from 'zod'  //zod 是 TypeScript 生态中使用最广泛的运行时校验库，这里用来为工具参数定义参数模式（Schema）
import fs from 'node:fs/promises'
import readline from 'node:readline'
import path from 'node:path' //加入writeFile工具要加的导入




//加入写文件工具
const writeFile = tool({
  // description：告诉 AI 什么时候用、怎么用
  description: `Write a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one.
- If this is an existing file, you MUST use readFile first to read its contents.
- The filePath must be an absolute path.
- NEVER create *.md or README files unless explicitly requested.`,

  // inputSchema：定义两个参数
  inputSchema: z.object({
    filePath: z.string().describe('Absolute path to the file'),
    content: z.string().describe('The full content to write'),
  }),

  // execute：实际写入文件
  execute: async ({ filePath, content }) => {
    
    // 创建一个临时的 readline 来问用户（新增的部分，用来让用户确认是否写入文件）
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const ask = (q: string) => new Promise<string>((r) => rl.question(q, r))

    const answer = await ask(`\n  确认写入文件 ${filePath}？(y/n): `)
    rl.close()

    if (answer.trim().toLowerCase() !== 'y') {
      return `Error: User declined. File ${filePath} was NOT written.`
    }

    // 用户确认，执行写入
    try {
      // 确保目录存在
      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })
      // 写入文件
      await fs.writeFile(filePath, content, 'utf-8')
      const lines = content.split('\n').length
      return `File written: ${filePath} (${lines} lines)`
    } catch (err) {
      return `Error: Failed to write file. ${err.message}`
    }
  },
})

// getCurrentTime.ts — 获取当前时间的工具
// 模仿 web-fetch.ts 的 tool() 结构
// import { tool } from 'ai'
// import { z } from 'zod'
export const getCurrentTime = tool({
  // ① description — 告诉 AI 这个工具能干什么
  description:
    `Get the current date and time in the user's timezone. ` +
    `Returns the current date, day of week, and time in ISO format. ` +
    `Useful when the user asks about today's date, what day it is, or needs the current time.`,

  // // ② inputSchema — 不需要任何参数
  // inputSchema: z.object({}),
  // 修复：不要留空 schema，加一个可选参数
  inputSchema: z.object({
    _dummy: z.string().optional().describe('No parameters needed'),
  }),

  // ③ execute — 实际执行逻辑
  execute: async () => {
    try {
      const now = new Date()
      const iso = now.toISOString()
      const formatted = now.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]
      return `Current time: ${formatted} (${weekday}). ISO: ${iso}`
    } catch (err) {
      return `Error: Failed to get current time. ${err.message}`
    }
  },
})

// calculate.ts
//下面两行是调入工具calculate需要导入的两行关键行
//import { tool } from 'ai'
//import { z } from 'zod'

export const calculate = tool({
  // ① description — 告诉 AI 这个工具能干什么
  description:
    `Perform mathematical calculations. ` +
    `Supports basic arithmetic (+, -, *, /), powers (^), ` +
    `square roots (sqrt), pi, and e. ` +
    `Example: '2 ^ 10' returns 1024. 'sqrt(144)' returns 12.`,

  // ② inputSchema — 只接收一个 expression 参数
  inputSchema: z.object({
    expression: z.string().describe('The math expression to evaluate'),
  }),

  // ③ execute — 实际计算逻辑
  execute: async ({ expression }) => {
    try {
      // 白名单过滤：只允许数字、运算符、括号、空格和安全的数学关键词
      const sanitized = expression.trim()
      if (!/^[0-9+\-*/().\s^sqrtpie]+$/.test(sanitized)) {
        return `Error: Invalid expression. Only basic math operations allowed.`
      }

      // 把 ^ 换成 JS 的 **，sqrt 换成 Math.sqrt，pi 换成 Math.PI
      const jsExpr = sanitized
        .replace(/\^/g, '**')
        .replace(/sqrt/g, 'Math.sqrt')
        .replace(/\bpi\b/g, 'Math.PI')
        .replace(/\be\b/g, 'Math.E')

      // 计算并返回
      const result = new Function(`return ${jsExpr}`)()
      return `Result: ${result}`
    } catch (err) {
      return `Error: Failed to calculate '${expression}'. ${err.message}`
    }
  },
})

// 给模型一个工具：读取一个文件的全部内容，以下三个要素（description+inputschema+execute）的组合成为工具使用协议（tool use protocol）
const readFile = tool({
  description: '读取一个文本文件，返回完整内容',   //一段给模型阅读的自然语言描述description，描述决定了模型在什么场景下会选用该工具，过笼统or过限制，都有弊端
  inputSchema: z.object({   //一组用Zod定义的参数模式inputschema，约束了调用时的参数格式
    path: z.string().describe('要读取的文件路径'),
  }),
  execute: async ({ path }) => { //一个真正执行操作的函数execute，决定了调用后实际发生的操作。模型永远不直接执行代码，所有副作用都由工具的execute函数代理完成。因此每个可能产生影响的操作都在开发者的控制之下。缺点是灵活性受限，无法执行工具集之外的任何操作
    return await fs.readFile(path, 'utf-8')
  },
})

// 在 main() 函数开头（创建加载记忆的函数）
async function loadMemory(): Promise<string> {
  try {
    return await fs.readFile('agent-memory.txt', 'utf-8')
  } catch {
    return ''  // 文件不存在，没有记忆
  }
}

async function main() {
  //第三部分，下面这三段是一个简单的交互式读取-求值-打印循环（REPL,Read-Eval-Print Loop）
    //terminal: false,  // 关键！关闭 readline 自动回显
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false }) //readline模块读取用户输入，将每条输入追加到message数组中，构建对话历史
  const ask = (q: string) => new Promise<string>((r) => rl.question(q, r))
  const messages: Array<{ role: 'user' | 'assistant'; content: any }> = []

  for (;;) {  
    const input = (await ask('\n你: ')).trim()
    if (!input || input === 'exit') break
    messages.push({ role: 'user', content: input })  //message数组是模型每一轮所看到的完整上下文，生产级agent会演化为一个名为loopstate的结构（过长压缩等操作）

    //第四部分下面加上for await循环是agent的核心驱动
    //在你的 for (;;) 循环中，在每次 streamText 之前，检查 messages 大小，如果超过阈值就用模型本身来压缩：
    // 在 user 消息 push 之后，streamText 之前可以用 LLM 自己来总结
        // 上下文压缩：每轮对话前检查消息数量（下面这段应该是直接丢弃历史内容+llm总结结合的）
    const MAX_CONTEXT_MESSAGES = 6  // 最多保留最近 6 条消息
    if (messages.length > MAX_CONTEXT_MESSAGES) {
      const keepNewest = 6
      const toSummarize = messages.slice(0, messages.length - keepNewest)
      const recentContext = messages.slice(messages.length - keepNewest)
      process.stdout.write('\n  [正在压缩对话历史...]')
      const summaryResult = await streamText({
        model: deepseek('deepseek-chat'),
        messages: [
          ...toSummarize,
          { role: 'user', content: 'Summarize the key facts, decisions, user preferences from the conversation above. Keep it brief.' },
        ],
      })
      for await (const chunk of summaryResult.fullStream) {
        // 吞掉输出，不需要显示
      }
      const { text: summary } = await summaryResult
      // 重置 messages
      messages.length = 0
      messages.push(
        { role: 'user', content: `[Context summary from earlier conversation]: ${summary}` },
        ...recentContext
      )
      process.stdout.write('\n  [对话已压缩]\n')
    }

    ////下面这段是增加的记忆功能，加载之前的记忆并注入到系统提示词中。依然是在streamtext前加入，跟压缩的原理一样是放在这个之前，不同的是记忆需要在streamtext里引入参数。
    const memory = await loadMemory()
    // 构建 system prompt（包含记忆）
    const systemPrompt = memory 
      ? `You are a helpful AI assistant.\n\n## Memory from previous sessions:\n${memory}`
      : `You are a helpful AI assistant.`

    const result = streamText({   //streamtext将当前messages与工具集发送给模型，SDK在内部驱动一个「模型输出文本 → 模型发出工具调用 → SDK 执行工具 → 工具结果回传给模型 → 模型继续输出」的循环，直到模型决定停止或命中 stopWhen 所设定的上限（此处为 10 轮）。
      model: deepseek('deepseek-chat'),
      messages, 
      tools: { readFile, 
        calculate,
        getCurrentTime,
        writeFile,
      },
      system: systemPrompt,  // ← 把 system prompt 传给模型
      stopWhen: stepCountIs(10), // 最多 10 轮工具调用就收手，stowhen设定上限
    })

    process.stdout.write('助手: ')
    // for await (const chunk of result.fullStream) {  //fullstream是循环的事件流（event stream），其中每一段文本、每一次工具调用、每一次工具返回都作为一个数据块（chunk）依次推出
    //   if (chunk.type === 'text-delta') process.stdout.write(chunk.text)  //用for await逐个消费，按chunk.type分别写到终端
    //   else if (chunk.type === 'tool-call') process.stdout.write(`\n  [调用 ${chunk.toolName}(${JSON.stringify(chunk.input)})]`)
    //   //(出现助手回复散一下就消失的问题，说是这段话出错了）else if (chunk.type === 'tool-result') process.stdout.write(`\n  [返回 ${String(chunk.output).length} 字节]\n助手: `)
    // } //注释整段for await，解决一下这出现回答，却一会就消失的问题
    
    ////////改了闪现没有怎么更严重了
    // 修改这部分代码（替换原来的 for await 循环）：
    let expectingText = false  // 新增：标记是否期望下一段 text-delta 是助手的新回复

    process.stdout.write('助手: ')
    for await (const chunk of result.fullStream) {
      if (chunk.type === 'text-delta') {
        if (expectingText) {
          process.stdout.write('助手: ')  // 工具执行完后，模型开始回复时才打印'助手: '
          expectingText = false
        }
        process.stdout.write(chunk.text)
      }
      else if (chunk.type === 'tool-call') {
        process.stdout.write(`\n  [调用 ${chunk.toolName}(${JSON.stringify(chunk.input)})]\n`)
        expectingText = false
      }
      else if (chunk.type === 'tool-result') {
        process.stdout.write(`  [${chunk.toolName} 返回 ${String(chunk.output).length} 字节]\n`)
        expectingText = true  // 工具执行完了，模型马上会继续回复 //对照了原段，区别就是每种情况都引入了expectingText，然后主要是tool-result这的改成true，核心改动就是加了一个 expectingText 标志位，把 助手:  的打印时机从每个 tool-result 后改成了只有模型真正开始回复文本时。
      }
        // (取消了换个方案验证）process.stdout.write(`\n  [工具返回: ${String(chunk.tool_result).substring(0, 100)}...]`) //在你现有的 for await 循环里，加一行调试打印：
    }
    //以下为新增段，看到工具结果是怎么变成 role: 'tool' 的消息的。放在 for await 循环之后
    console.log('===== 本轮 messages =====')
    messages.forEach((m, i) => {
      console.log(`[${i}] role: ${m.role}`, typeof m.content === 'string' ? m.content.substring(0, 80) : JSON.stringify(m.content).substring(0, 80))
    })
/////////////

    const { messages: newMessages } = await result.response   //最后，result.response.messages取出SDK在本轮中累积的所有新消息，包括模型输出的文本、工具调用记录，工具返回结果，追加到messages数组中。
    messages.push(...(newMessages as any))  //整个流程中，SDK 帮我们封装了「执行工具 → 回传结果 → 再次请求模型」这一循环，我们只需消费 fullStream 并维护 messages。
  ////在messages.push后面加入有关于加入记忆的代码。
      // 在 messages.push 之后
    try {
      const { text: memText } = await generateText({
        model: deepseek('deepseek-chat'),
        messages: [
          ...messages.slice(-4),
          { role: 'user', content: 'Extract key facts about the user from this conversation. Output "NONE" if nothing worth remembering.' }
        ],
      })

      if (memText && !memText.includes('NONE') && memText.length > 10) {
        await fs.writeFile('agent-memory.txt', memText, 'utf-8')
        process.stdout.write('\n  [记忆已保存]\n')
      }
    } catch {}
  }
  rl.close()
}

main().catch(console.error)
