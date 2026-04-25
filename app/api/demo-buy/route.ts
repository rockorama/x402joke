import { NextRequest, NextResponse } from 'next/server'

type DemoBuyBody = {
  hightopUrl?: string
  agentId: string
  apiKey: string
  theme?: string
}

type PaymentRequirement = {
  scheme: string
  network: string
  maxAmountRequired: string
  resource: string
  payTo: string
  asset: string
  maxTimeoutSeconds?: number
}

type SettlementResponse = {
  success?: boolean
  transaction?: string
  network?: string
  payer?: string
  errorReason?: string
}

function decodePaymentResponseHeader(header: string | null): SettlementResponse | null {
  if (!header) return null
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf-8'))
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  let body: DemoBuyBody
  try {
    body = (await request.json()) as DemoBuyBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { agentId, apiKey, theme } = body
  const hightopUrl = (body.hightopUrl || 'http://localhost:3000').replace(/\/$/, '')

  if (!agentId || !apiKey) {
    return NextResponse.json({ error: 'agentId_and_apiKey_required' }, { status: 400 })
  }

  const jokeBuyUrl = new URL('/api/buy', request.url).toString()
  const steps: Array<{ name: string; status: number; ok: boolean; note?: string }> = []

  // Step 1: probe /buy to get 402 + payment requirements
  const probe = await fetch(jokeBuyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme }),
  })
  steps.push({ name: '1. probe /api/buy', status: probe.status, ok: probe.status === 402 })
  if (probe.status !== 402) {
    return NextResponse.json({ error: 'probe_unexpected_status', status: probe.status, steps }, { status: 500 })
  }
  const probeBody = (await probe.json()) as { accepts: PaymentRequirement[] }
  const requirements = probeBody.accepts?.[0]
  if (!requirements) {
    return NextResponse.json({ error: 'probe_missing_requirements', steps }, { status: 500 })
  }

  // Step 2: sign via Hightop
  const signRes = await fetch(`${hightopUrl}/api/actions/x402/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-id': agentId,
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      payTo: requirements.payTo,
      amount: requirements.maxAmountRequired,
      targetUrl: requirements.resource,
    }),
  })
  steps.push({ name: '2. hightop /sign', status: signRes.status, ok: signRes.ok })
  if (!signRes.ok) {
    const errBody = await signRes.text()
    return NextResponse.json({ error: 'sign_failed', detail: errBody, steps }, { status: signRes.status })
  }
  const signBody = (await signRes.json()) as { paymentHeader: string; validBefore: string }

  // Step 3: retry /buy with X-PAYMENT header
  const buyRes = await fetch(jokeBuyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': signBody.paymentHeader,
    },
    body: JSON.stringify({ theme }),
  })
  const settlement = decodePaymentResponseHeader(buyRes.headers.get('x-payment-response'))
  steps.push({ name: '3. retry /api/buy', status: buyRes.status, ok: buyRes.ok })
  if (!buyRes.ok) {
    const errBody = await buyRes.text()
    return NextResponse.json({ error: 'buy_failed', detail: errBody, steps }, { status: buyRes.status })
  }

  const buyBody = (await buyRes.json()) as { joke: string; theme: string | null }

  return NextResponse.json({
    joke: buyBody.joke,
    theme: buyBody.theme,
    requirements: {
      payTo: requirements.payTo,
      amount: requirements.maxAmountRequired,
      asset: requirements.asset,
      network: requirements.network,
    },
    settlement,
    validBefore: signBody.validBefore,
    steps,
  })
}
