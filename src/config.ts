function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required env var: ${key}`)
  return value
}

export const config = {
  get payee() {
    return required('JOKE_SHOP_PAYEE_ADDRESS') as `0x${string}`
  },
  get anthropicKey() {
    return required('ANTHROPIC_API_KEY')
  },
  // CDP facilitator requires auth. Falls back to x402.org only for testnet.
  facilitatorUrl: (process.env.X402_FACILITATOR_URL ||
    'https://api.cdp.coinbase.com/platform/v2/x402') as `${string}://${string}`,
  network: (process.env.X402_NETWORK || 'base') as 'base' | 'base-sepolia',
  price: process.env.JOKE_PRICE_USD || '$0.01',
  // CDP creds used to authenticate calls to Coinbase's hosted facilitator.
  // Only needed when the facilitator URL is the CDP one (default for mainnet).
  get cdpApiKeyId() {
    return process.env.CDP_API_KEY_ID || ''
  },
  get cdpApiKeySecret() {
    return process.env.CDP_API_KEY_SECRET || ''
  },
}
