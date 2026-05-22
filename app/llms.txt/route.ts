import { headers } from 'next/headers'

import { formatPrice } from '../../src/price'

export const dynamic = 'force-dynamic'

const PRICE = formatPrice(process.env.JOKE_PRICE_USD || '$0.01')
const NETWORK = process.env.X402_NETWORK || 'base'
const PAYEE = process.env.JOKE_SHOP_PAYEE_ADDRESS || ''
const USDC = NETWORK === 'base-sepolia'
  ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
  : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

export async function GET() {
  const h = await headers()
  const host = h.get('host') ?? 'x402joker.com'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origin = `${proto}://${host}`

  const body = `# x402joker

> A pay-per-joke vending machine. Pay ${PRICE} USDC on ${NETWORK} via the x402 protocol, get a fresh Claude-generated joke. No accounts, no API keys.

## Endpoint

- POST ${origin}/api/buy
- Body (optional JSON): { "theme": "string" }
- Protocol: x402 (HTTP 402 + EIP-3009 transferWithAuthorization)

## Payment

- Price: ${PRICE} USDC
- Network: ${NETWORK}
- Asset (USDC): ${USDC}
${PAYEE ? `- Pay to: ${PAYEE}\n` : ''}
## Flow

1. POST to the endpoint with no payment. Response: 402 with a JSON body containing \`accepts: [paymentRequirements]\`.
2. Sign an EIP-3009 \`transferWithAuthorization\` matching the requirements. Base64-encode the signed payload as the \`X-PAYMENT\` header.
3. Retry the POST with the \`X-PAYMENT\` header. Response: 200 with \`{ joke, theme }\` plus the on-chain settlement tx hash in the \`X-PAYMENT-RESPONSE\` header.

## Discovery

- Machine-readable: GET ${origin}/api/buy returns a JSON description of this endpoint.
- Human-readable: ${origin}/

## References

- x402 spec: https://x402.org
- x402 reference implementation: https://github.com/coinbase/x402
`

  return new Response(body, {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  })
}
