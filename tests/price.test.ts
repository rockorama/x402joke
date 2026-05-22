import { describe, expect, it } from 'vitest'

import { formatPrice } from '../src/price'

describe('formatPrice', () => {
  it('passes through a well-formed dollar amount', () => {
    expect(formatPrice('$0.01')).toBe('$0.01')
    expect(formatPrice('$1.00')).toBe('$1.00')
  })

  it('adds the missing leading zero when the value starts with "."', () => {
    expect(formatPrice('$.01')).toBe('$0.01')
    expect(formatPrice('.10')).toBe('$0.10')
  })

  it('adds the leading "$" when missing', () => {
    expect(formatPrice('0.01')).toBe('$0.01')
    expect(formatPrice('1.50')).toBe('$1.50')
  })

  it('handles integer-only values', () => {
    expect(formatPrice('1')).toBe('$1')
    expect(formatPrice('$5')).toBe('$5')
  })

  it('only strips a single leading "$"', () => {
    expect(formatPrice('$$1.00')).toBe('$$1.00')
  })
})
