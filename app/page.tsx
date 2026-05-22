import { headers } from 'next/headers'

import { formatPrice } from '../src/price'

export const dynamic = 'force-dynamic'

const PRICE = formatPrice(process.env.JOKE_PRICE_USD || '$0.01')
const NETWORK = process.env.X402_NETWORK || 'base'
const PAYEE = process.env.JOKE_SHOP_PAYEE_ADDRESS || ''
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const USDC_ASSET = NETWORK === 'base-sepolia' ? USDC_BASE_SEPOLIA : USDC_BASE

export default async function Home() {
  const h = await headers()
  const host = h.get('host') ?? 'x402joker.com'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origin = `${proto}://${host}`
  const buyUrl = `${origin}/api/buy`

  return (
    <main>
      <h1 style={{ marginBottom: 4 }}>🎭 x402joker</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        A vending machine for jokes. Pay <strong>{PRICE}</strong> USDC on{' '}
        <strong>{NETWORK}</strong>, get a fresh Claude-generated joke.
      </p>

      <section style={section}>
        <h2 style={h2}>Endpoint</h2>
        <pre style={code}>POST {buyUrl}</pre>
        <p style={muted}>
          Optional JSON body: <code>{'{ "theme": "string" }'}</code>. Omit for a surprise.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Payment</h2>
        <dl style={dl}>
          <KV k="Protocol" v="x402 (HTTP 402 + EIP-3009 signed transfer)" />
          <KV k="Price" v={`${PRICE} USDC`} />
          <KV k="Network" v={NETWORK} />
          <KV k="Asset (USDC)" v={USDC_ASSET} mono />
          {PAYEE && <KV k="Pay to" v={PAYEE} mono />}
        </dl>
      </section>

      <section style={section}>
        <h2 style={h2}>How to buy (3 steps)</h2>
        <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
          <li>
            POST to the endpoint with no payment. You get <code>402 Payment Required</code> and a{' '}
            <code>paymentRequirements</code> body.
          </li>
          <li>
            Sign an EIP-3009 <code>transferWithAuthorization</code> matching those requirements and
            base64-encode it as the <code>X-PAYMENT</code> header.
          </li>
          <li>
            Retry the POST with the header. You get <code>200 { '{ joke }'}</code> and the on-chain
            settlement tx hash in <code>X-PAYMENT-RESPONSE</code>.
          </li>
        </ol>
      </section>

      <section style={section}>
        <h2 style={h2}>Try it with curl</h2>
        <p style={muted}>Probe to see the payment requirements:</p>
        <pre style={code}>{`curl -i -X POST ${buyUrl} \\
  -H 'content-type: application/json' \\
  -d '{"theme":"programming"}'`}</pre>
        <p style={muted}>
          Then sign the returned requirements with any x402 client (e.g. the{' '}
          <a href="https://github.com/coinbase/x402" target="_blank" rel="noreferrer">
            x402
          </a>{' '}
          SDK or an agent wallet), set <code>X-PAYMENT</code>, and POST again.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Discovery</h2>
        <ul style={{ paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
          <li>
            <a href="/llms.txt">/llms.txt</a> — markdown overview for LLM/agent crawlers.
          </li>
          <li>
            <a href="/api/buy">GET /api/buy</a> — JSON description of this endpoint (the POST is the
            paid one).
          </li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={h2}>For agents</h2>
        <p>
          Any x402-aware HTTP client can consume this endpoint with no API keys, no signup, and no
          allowlist. The 402 response is self-describing — the price, asset, network, and payee are
          all there. Point your agent at <code>{buyUrl}</code> and let the protocol handle the rest.
        </p>
        <p style={muted}>
          New to x402?{' '}
          <a href="https://x402.org" target="_blank" rel="noreferrer">
            x402.org
          </a>{' '}
          ·{' '}
          <a href="https://github.com/coinbase/x402" target="_blank" rel="noreferrer">
            github.com/coinbase/x402
          </a>
        </p>
      </section>

      <footer style={{ marginTop: 48, fontSize: 12, color: '#888' }}>
        Stateless. No accounts. Jokes are not refundable, even the bad ones.
      </footer>
    </main>
  )
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt style={{ color: '#888' }}>{k}</dt>
      <dd
        style={{
          margin: 0,
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {v}
      </dd>
    </>
  )
}

const section: React.CSSProperties = { marginTop: 32 }
const h2: React.CSSProperties = { fontSize: 16, marginBottom: 8 }
const muted: React.CSSProperties = { color: '#666', fontSize: 14 }
const code: React.CSSProperties = {
  background: '#f6f6f6',
  padding: 12,
  borderRadius: 6,
  fontSize: 13,
  overflowX: 'auto',
  whiteSpace: 'pre',
}
const dl: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr',
  gap: '6px 16px',
  fontSize: 14,
  margin: 0,
}
