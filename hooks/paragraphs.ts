// Splits a reply into paragraphs on blank lines, keeping code fences whole.
export const paragraphsOf = (text: string): string[] => {
  const out: string[] = []
  let current: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (!inFence && line.trim() === '') {
      if (current.length) out.push(current.join('\n'))
      current = []
    } else {
      current.push(line)
    }
  }
  if (current.length) out.push(current.join('\n'))
  return out
}

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; language: string; source: string }

// Splits a paragraph into its prose and its fenced code blocks, in order.
export const segmentsOf = (text: string): Segment[] => {
  const out: Segment[] = []
  let prose: string[] = []
  let code: string[] | null = null
  let language = ''
  for (const line of text.split('\n')) {
    const fence = /^\s*(```|~~~)\s*([\w+#.-]*)/.exec(line)
    if (fence && code === null) {
      if (prose.length) out.push({ kind: 'text', text: prose.join('\n') })
      prose = []
      code = []
      language = fence[2] ?? ''
    } else if (fence && code !== null) {
      out.push({ kind: 'code', language, source: code.join('\n') })
      code = null
    } else if (code !== null) {
      code.push(line)
    } else {
      prose.push(line)
    }
  }
  if (code !== null) out.push({ kind: 'code', language, source: code.join('\n') })
  if (prose.length) out.push({ kind: 'text', text: prose.join('\n') })
  return out
}

export type Kind = 'code' | 'list' | 'table' | 'quote' | 'heading' | 'text'

export const KIND_LABEL: Record<Kind, string> = {
  code: 'Code',
  list: 'List',
  table: 'Table',
  quote: 'Quote',
  heading: 'Heading',
  text: 'Text',
}

// What a paragraph mostly is, read off its first non-empty line.
export const kindOf = (text: string): Kind => {
  const first = text.split('\n').find(l => l.trim())?.trim() ?? ''
  if (/^(```|~~~)/.test(first)) return 'code'
  if (/^([-*+]|\d+[.)])\s/.test(first)) return 'list'
  if (/^\|/.test(first)) return 'table'
  if (/^>/.test(first)) return 'quote'
  if (/^#{1,6}\s/.test(first)) return 'heading'
  return segmentsOf(text).some(p => p.kind === 'code') ? 'code' : 'text'
}

// The paragraph as a markdown quote, ready to drop into the prompt.
export const quoteOf = (text: string) =>
  `${text
    .split('\n')
    .map(l => (l ? `> ${l}` : '>'))
    .join('\n')}\n\n`
