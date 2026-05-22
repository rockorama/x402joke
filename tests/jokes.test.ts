import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: createMock }
    },
  }
})

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  createMock.mockReset()
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
})

async function loadJokes() {
  vi.resetModules()
  return await import('../src/jokes')
}

describe('generateJoke', () => {
  it('asks Claude for a joke about the given theme', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'A joke about corgis.' }],
    })
    const { generateJoke } = await loadJokes()

    const result = await generateJoke('corgis')

    expect(result).toBe('A joke about corgis.')
    expect(createMock).toHaveBeenCalledTimes(1)
    const call = createMock.mock.calls[0][0]
    expect(call.messages[0].content).toContain('corgis')
  })

  it('falls back to a surprise prompt when no theme is given', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Surprise!' }],
    })
    const { generateJoke } = await loadJokes()

    const result = await generateJoke(null)

    expect(result).toBe('Surprise!')
    const call = createMock.mock.calls[0][0]
    expect(call.messages[0].content.toLowerCase()).toContain('whatever')
  })

  it('trims trailing whitespace from the model output', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '  padded joke  \n' }],
    })
    const { generateJoke } = await loadJokes()
    expect(await generateJoke('cats')).toBe('padded joke')
  })

  it('skips non-text content blocks and uses the first text block', async () => {
    createMock.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', name: 'whatever' },
        { type: 'text', text: 'the actual joke' },
      ],
    })
    const { generateJoke } = await loadJokes()
    expect(await generateJoke(null)).toBe('the actual joke')
  })

  it('throws when the model returns no text content', async () => {
    createMock.mockResolvedValueOnce({ content: [] })
    const { generateJoke } = await loadJokes()
    await expect(generateJoke('cats')).rejects.toThrow(/no text content/i)
  })
})
