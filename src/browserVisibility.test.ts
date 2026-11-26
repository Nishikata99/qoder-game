import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDocumentBackgrounded } from './browserVisibility'

afterEach(() => vi.unstubAllGlobals())

describe('isDocumentBackgrounded', () => {
  it('does not treat a visible page as backgrounded', () => {
    vi.stubGlobal('document', { hidden: false, hasFocus: () => false })
    expect(isDocumentBackgrounded()).toBe(false)
  })

  it('detects a hidden unfocused tab', () => {
    vi.stubGlobal('document', { hidden: true, hasFocus: () => false })
    expect(isDocumentBackgrounded()).toBe(true)
  })

  it('ignores focused hidden reports from embedded browsers', () => {
    vi.stubGlobal('document', { hidden: true, hasFocus: () => true })
    expect(isDocumentBackgrounded()).toBe(false)
  })
})
