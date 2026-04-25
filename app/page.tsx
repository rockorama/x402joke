'use client'

import { useEffect, useState } from 'react'

type Step = { name: string; status: number; ok: boolean; note?: string }

type BuyResult = {
  joke?: string
  theme?: string | null
  requirements?: { payTo: string; amount: string; asset: string; network: string }
  settlement?: { success?: boolean; transaction?: string; payer?: string; network?: string } | null
  validBefore?: string
  steps?: Step[]
  error?: string
  detail?: string
}

const STORAGE_KEY = 'x402joke-demo'

export default function Home() {
  const [hightopUrl, setHightopUrl] = useState('https://api-staging.hightop.com')
  const [agentId, setAgentId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [theme, setTheme] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BuyResult | null>(null)

  // persist inputs locally so you don't re-paste on every reload
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const saved = JSON.parse(raw)
        setHightopUrl(saved.hightopUrl || 'https://api-staging.hightop.com')
        setAgentId(saved.agentId || '')
        setApiKey(saved.apiKey || '')
        setTheme(saved.theme || '')
      } catch {}
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hightopUrl, agentId, apiKey, theme }))
  }, [hightopUrl, agentId, apiKey, theme])

  async function buy() {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/demo-buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hightopUrl, agentId, apiKey, theme: theme.trim() || undefined }),
      })
      const body = (await res.json()) as BuyResult
      setResult(body)
    } catch (err) {
      setResult({ error: 'request_failed', detail: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = agentId.trim() && apiKey.trim() && hightopUrl.trim() && !loading

  return (
    <main>
      <h1>🎭 x402joke</h1>
      <p style={{ color: '#555' }}>
        Paste your Hightop agent credentials, pick a theme, buy a joke. The server orchestrates:
        probe → sign → retry.
      </p>

      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        <Field label="Hightop URL">
          <input
            value={hightopUrl}
            onChange={(e) => setHightopUrl(e.target.value)}
            placeholder="http://localhost:3000"
            style={inputStyle}
          />
        </Field>
        <Field label="Agent ID">
          <input
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="0bc67461-..."
            style={inputStyle}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Agent API Key">
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="57f4de47..."
            style={inputStyle}
            type="password"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Theme (optional)">
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="programming, cats, existential dread"
            style={inputStyle}
          />
        </Field>

        <button
          onClick={buy}
          disabled={!canSubmit}
          style={{
            padding: '12px 16px',
            fontSize: 16,
            fontWeight: 600,
            border: 'none',
            borderRadius: 8,
            background: canSubmit ? '#111' : '#ccc',
            color: 'white',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            marginTop: 8,
          }}
        >
          {loading ? 'Buying a joke…' : 'Buy a joke'}
        </button>
      </div>

      {result && <Result result={result} />}

      <footer style={{ marginTop: 48, fontSize: 12, color: '#888' }}>
        Credentials are kept in your browser's localStorage. They're sent to this app's server to
        proxy the Hightop sign call (avoids CORS). Don't paste prod creds here.
      </footer>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
      {label}
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  border: '1px solid #ddd',
  borderRadius: 6,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

function Result({ result }: { result: BuyResult }) {
  if (result.error) {
    return (
      <section style={{ marginTop: 24, padding: 16, background: '#fff4f4', border: '1px solid #f5bcbc', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>❌ {result.error}</h2>
        {result.detail && <pre style={preStyle}>{result.detail}</pre>}
        {result.steps && <Steps steps={result.steps} />}
      </section>
    )
  }

  return (
    <section style={{ marginTop: 24, display: 'grid', gap: 16 }}>
      <div
        style={{
          padding: 24,
          background: '#fffbe6',
          border: '1px solid #f0e0a0',
          borderRadius: 12,
          whiteSpace: 'pre-wrap',
          fontSize: 16,
          lineHeight: 1.5,
        }}
      >
        {result.joke}
      </div>

      <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
        {result.theme && (
          <KV label="Theme" value={result.theme} />
        )}
        {result.requirements && (
          <>
            <KV label="Paid" value={`${result.requirements.amount} (atomic) ${result.requirements.network}`} />
            <KV label="To" value={result.requirements.payTo} mono />
          </>
        )}
        {result.settlement?.transaction && (
          <KV
            label="Tx hash"
            value={
              <a
                href={`https://basescan.org/tx/${result.settlement.transaction}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontFamily: 'ui-monospace, monospace' }}
              >
                {result.settlement.transaction}
              </a>
            }
          />
        )}
        {result.settlement?.payer && <KV label="Payer" value={result.settlement.payer} mono />}
      </div>

      {result.steps && <Steps steps={result.steps} />}
    </section>
  )
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={mono ? { fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' } : { wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <details style={{ fontSize: 12, color: '#555' }}>
      <summary style={{ cursor: 'pointer' }}>Flow steps</summary>
      <ul style={{ marginTop: 8, paddingLeft: 20 }}>
        {steps.map((s, i) => (
          <li key={i}>
            {s.ok ? '✓' : '✗'} {s.name} — {s.status}
          </li>
        ))}
      </ul>
    </details>
  )
}

const preStyle: React.CSSProperties = {
  background: '#f6f6f6',
  padding: 12,
  borderRadius: 6,
  fontSize: 12,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
}
