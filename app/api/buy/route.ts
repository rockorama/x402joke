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
  console.log(`[x402joke] served joke to ${payer} (theme: ${theme ?? 'surprise'})`)

  return NextResponse.json({ joke, theme })
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
