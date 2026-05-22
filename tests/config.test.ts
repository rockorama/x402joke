import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = [
  'JOKE_SHOP_PAYEE_ADDRESS',
  'ANTHROPIC_API_KEY',
  'X402_FACILITATOR_URL',
  'X402_NETWORK',
  'JOKE_PRICE_USD',
  'CDP_API_KEY_ID',
  'CDP_API_KEY_SECRET',
] as const

const originalEnv: Record<string, string | undefined> = {}

// `facilitatorUrl`, `network`, and `price` are read at module-load time, so
// every test re-imports `config` after staging the desired env.
async function loadConfig() {
  vi.resetModules()
  return (await import('../src/config')).config
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

describe('config required fields', () => {
  it('throws a descriptive error when JOKE_SHOP_PAYEE_ADDRESS is missing', async () => {
    const config = await loadConfig()
    expect(() => config.payee).toThrow(/JOKE_SHOP_PAYEE_ADDRESS/)
  })

  it('throws a descriptive error when ANTHROPIC_API_KEY is missing', async () => {
    const config = await loadConfig()
    expect(() => config.anthropicKey).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('returns the configured payee when set', async () => {
    process.env.JOKE_SHOP_PAYEE_ADDRESS = '0x000000000000000000000000000000000000dEaD'
    const config = await loadConfig()
    expect(config.payee).toBe('0x000000000000000000000000000000000000dEaD')
  })

  it('treats an empty string as missing', async () => {
    process.env.JOKE_SHOP_PAYEE_ADDRESS = ''
    const config = await loadConfig()
    expect(() => config.payee).toThrow(/JOKE_SHOP_PAYEE_ADDRESS/)
  })
})

describe('config defaults', () => {
  it('defaults the facilitator URL to the CDP hosted endpoint', async () => {
    const config = await loadConfig()
    expect(config.facilitatorUrl).toBe('https://api.cdp.coinbase.com/platform/v2/x402')
  })

  it('defaults the network to base mainnet', async () => {
    const config = await loadConfig()
    expect(config.network).toBe('base')
  })

  it('defaults the joke price to $0.01', async () => {
    const config = await loadConfig()
    expect(config.price).toBe('$0.01')
  })

  it('honours overrides for facilitator, network, and price', async () => {
    process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator'
    process.env.X402_NETWORK = 'base-sepolia'
    process.env.JOKE_PRICE_USD = '$0.05'
    const config = await loadConfig()
    expect(config.facilitatorUrl).toBe('https://x402.org/facilitator')
    expect(config.network).toBe('base-sepolia')
    expect(config.price).toBe('$0.05')
  })

  it('exposes the CDP keys as empty strings when unset', async () => {
    const config = await loadConfig()
    expect(config.cdpApiKeyId).toBe('')
    expect(config.cdpApiKeySecret).toBe('')
  })

  it('returns the configured CDP credentials when set', async () => {
    process.env.CDP_API_KEY_ID = 'kid'
    process.env.CDP_API_KEY_SECRET = 'sek'
    const config = await loadConfig()
    expect(config.cdpApiKeyId).toBe('kid')
    expect(config.cdpApiKeySecret).toBe('sek')
  })
})
