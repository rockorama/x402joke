import { describe, expect, it } from 'vitest'

import {
  cdpHost,
  parseVerifyErrorReason,
  RETRYABLE_VERIFY_REASONS,
  VERIFY_ERROR_PREFIX,
} from '../src/x402-helpers'

describe('parseVerifyErrorReason', () => {
  it('returns the bare reason when verify answered 200 with isValid:false', () => {
    const body = JSON.stringify({ error: 'invalid_payload' })
    expect(parseVerifyErrorReason(body)).toBe('invalid_payload')
  })

  it('strips the "Failed to verify payment: " prefix from VerifyError shapes', () => {
    const body = JSON.stringify({ error: `${VERIFY_ERROR_PREFIX}payment_expired` })
    expect(parseVerifyErrorReason(body)).toBe('payment_expired')
  })

  it('returns null for non-JSON bodies', () => {
    expect(parseVerifyErrorReason('not json at all')).toBeNull()
    expect(parseVerifyErrorReason('')).toBeNull()
  })

  it('returns null when the JSON body has no string error field', () => {
    expect(parseVerifyErrorReason(JSON.stringify({ status: 'fail' }))).toBeNull()
    expect(parseVerifyErrorReason(JSON.stringify({ error: 42 }))).toBeNull()
    expect(parseVerifyErrorReason(JSON.stringify(null))).toBeNull()
    expect(parseVerifyErrorReason(JSON.stringify([]))).toBeNull()
  })

  it('passes the reason through unchanged when no prefix is present', () => {
    const body = JSON.stringify({ error: 'unexpected_verify_error' })
    expect(parseVerifyErrorReason(body)).toBe('unexpected_verify_error')
  })

  it('only strips the prefix when it is at the start', () => {
    const body = JSON.stringify({ error: `something ${VERIFY_ERROR_PREFIX}invalid_payload` })
    expect(parseVerifyErrorReason(body)).toBe(`something ${VERIFY_ERROR_PREFIX}invalid_payload`)
  })
})

describe('RETRYABLE_VERIFY_REASONS', () => {
  it('contains the documented transient facilitator reasons', () => {
    for (const reason of [
      'invalid_payload',
      'invalid_exact_evm_payload_signature',
      'invalid_exact_evm_payload_authorization_valid_before',
      'invalid_exact_evm_payload_authorization_valid_after',
      'payment_expired',
      'unexpected_verify_error',
    ]) {
      expect(RETRYABLE_VERIFY_REASONS.has(reason)).toBe(true)
    }
  })

  it('does not retry terminal mismatches the buyer would have to re-sign for', () => {
    for (const reason of [
      'insufficient_funds',
      'invalid_payment_requirements',
      'invalid_scheme',
      'invalid_network',
      'invalid_exact_evm_payload_recipient_mismatch',
    ]) {
      expect(RETRYABLE_VERIFY_REASONS.has(reason)).toBe(false)
    }
  })
})

describe('cdpHost', () => {
  it('extracts the host from a facilitator URL', () => {
    expect(cdpHost('https://api.cdp.coinbase.com/platform/v2/x402')).toBe('api.cdp.coinbase.com')
  })

  it('preserves non-default ports', () => {
    expect(cdpHost('http://localhost:4021/facilitator')).toBe('localhost:4021')
  })

  it('throws on invalid URLs', () => {
    expect(() => cdpHost('not a url')).toThrow()
  })
})
