import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { NextRequest, NextResponse } from 'next/server'
import { exact } from 'x402/schemes'
import { withX402 } from 'x402-next'

import { config } from '../../../src/config'
import { generateJoke } from '../../../src/jokes'

const isCdpFacilitator = config.facilitatorUrl.startsWith('https://api.cdp.coinbase.com')

function cdpHost(url: string): string {
  return new URL(url).host
}

async function createCdpAuthHeaders() {
  if (!config.cdpApiKeyId || !config.cdpApiKeySecret) {
    throw new Error('CDP facilitator selected but CDP_API_KEY_ID / CDP_API_KEY_SECRET are not set')
  }
  const host = cdpHost(config.facilitatorUrl)
  const sign = (path: string) =>
    generateJwt({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
      requestMethod: 'POST',
      requestHost: host,
      requestPath: path,
    })
  const [verifyJwt, settleJwt, supportedJwt] = await Promise.all([
    sign('/platform/v2/x402/verify'),
    sign('/platform/v2/x402/settle'),
    sign('/platform/v2/x402/supported'),
  ])
  return {
    verify: { Authorization: `Bearer ${verifyJwt}` },
    settle: { Authorization: `Bearer ${settleJwt}` },
    supported: { Authorization: `Bearer ${supportedJwt}` },
  }
}

async function handler(request: NextRequest): Promise<NextResponse> {
  let theme: string | null = null
  try {
    const body = (await request.json()) as { theme?: string }
    theme = body.theme?.trim() || null
  } catch {
    // No body is fine — generate a surprise joke.
  }

  // withX402 has already verified the payment by the time this handler runs.
  // Decode the header just to log the payer EOA (the `from` in the EIP-3009 auth).
  const paymentHeader = request.headers.get('X-PAYMENT')
  let payer = 'unknown'
  if (paymentHeader) {
    const decoded = exact.evm.decodePayment(paymentHeader).payload
    if ('authorization' in decoded) payer = decoded.authorization.from
  }

  const joke = await generateJoke(theme)
  console.log(`[x402joker] served joke to ${payer} (theme: ${theme ?? 'surprise'})`)

  return NextResponse.json({ joke, theme })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const endpoint = new URL('/api/buy', request.url).toString()
  const usdc =
    config.network === 'base-sepolia'
      ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
      : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  return NextResponse.json({
    name: 'x402joker',
    description: 'Pay-per-joke vending machine over the x402 protocol.',
    endpoint,
    method: 'POST',
    protocol: 'x402',
    body: { theme: 'optional string — joke theme, omit for surprise' },
    payment: {
      price: `$${config.price.replace(/^\$/, '').replace(/^\./, '0.')}`,
      network: config.network,
      asset: usdc,
      assetSymbol: 'USDC',
      payTo: config.payee,
      scheme: 'exact',
    },
    flow: [
      'POST endpoint with no X-PAYMENT header → 402 with accepts:[paymentRequirements] in body',
      'Sign EIP-3009 transferWithAuthorization matching the requirements; base64-encode as X-PAYMENT header',
      'Retry POST with X-PAYMENT → 200 { joke } + on-chain settlement tx hash in X-PAYMENT-RESPONSE header',
    ],
    discovery: {
      llmsTxt: new URL('/llms.txt', request.url).toString(),
      humanReadable: new URL('/', request.url).toString(),
    },
    references: {
      spec: 'https://x402.org',
      reference: 'https://github.com/coinbase/x402',
    },
  })
}

export const POST = withX402(
  handler,
  config.payee,
  {
    price: config.price,
    network: config.network,
    config: {
      description: 'A custom Claude-generated joke, delivered fresh.',
      mimeType: 'application/json',
      maxTimeoutSeconds: 60,
    },
  },
  {
    url: config.facilitatorUrl,
    ...(isCdpFacilitator ? { createAuthHeaders: createCdpAuthHeaders } : {}),
  },
)
