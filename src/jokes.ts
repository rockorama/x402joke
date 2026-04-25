import Anthropic from '@anthropic-ai/sdk'

import { config } from './config'

const client = new Anthropic({ apiKey: config.anthropicKey })

const SYSTEM_PROMPT = `You are a world-class standup comedian who writes jokes for an x402-powered joke shop.
Every joke you write is served to a buyer who just paid real USDC for it — so it has to be worth it.

Rules:
- Keep it under 60 words.
- Make it a setup + punchline. No lead-in, no "Here's a joke:".
- It must be genuinely funny, clever, or unexpected. No corny dad-joke groaners unless the buyer asked for dad jokes.
- If the buyer requests a theme that's sensitive (politics, religion, identity), dodge with a meta-joke about the theme itself.
- Keep it clean. No slurs, no targeted meanness.

Just output the joke. No preamble, no explanation.`

export async function generateJoke(theme: string | null): Promise<string> {
  const userMsg = theme
    ? `Write a joke about: ${theme}`
    : `Write whatever joke comes to mind. Pick a fresh, unexpected angle.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  })

  const block = response.content.find((c) => c.type === 'text')
  if (!block || block.type !== 'text') {
    throw new Error('Anthropic returned no text content')
  }
  return block.text.trim()
}
