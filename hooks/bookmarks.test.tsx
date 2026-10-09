import { expect, test } from 'claude-code/testing'

import { kindOf, paragraphsOf, quoteOf, segmentsOf } from './paragraphs'

const TEXT =
  'First paragraph here.\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nThird **one** with a longer sentence in it\n\n- a list item\n- another'

const REPLY = {
  plugin: 'chat-bookmarks',
  component: 'AssistantMessage',
  requestId: 'msg-1',
  props: { text: TEXT, isFirstOfReply: true },
} as const

const PANE = {
  plugin: 'chat-bookmarks',
  component: 'Pane',
  requestId: 'chat-bookmarks',
  props: {
    title: 'Favorites',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40, contentRows: 1 },
    view: { first: 0, last: 0 },
  },
} as const

test('paragraphs, segments, kinds and quotes', () => {
  expect(paragraphsOf(TEXT)).toHaveLength(4)
  expect(paragraphsOf(TEXT)[1]).toBe('```ts\nconst a = 1\n\nconst b = 2\n```')
  expect(segmentsOf('Run:\n```bash\nls\n```')).toEqual([
    { kind: 'text', text: 'Run:' },
    { kind: 'code', language: 'bash', source: 'ls' },
  ])
  expect(paragraphsOf(TEXT).map(kindOf)).toEqual(['text', 'code', 'text', 'list'])
  expect(kindOf('| a | b |\n|---|---|')).toBe('table')
  expect(kindOf('## Title')).toBe('heading')
  expect(quoteOf('one\n\ntwo')).toBe('> one\n>\n> two\n\n')
})

test('favorites: mark, save, search, filter by type, reply and delete', async ($, on) => {
  const filled: string[] = []
  const db = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: db.get(e.key) }) as never)
  on('store.set', (_$, e) => (db.set(e.key, e.value), { value: undefined }) as never)
  on('store.delete', (_$, e) => (db.delete(e.key), { value: undefined }) as never)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.open', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.scroll', () => ({ deny: 'transcript not scrollable here' }))
  on('session.id', () => ({ value: 'session-1' }) as never)
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true } as never
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const reply = await $.ui.mount({ ...REPLY, surface })
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await reply.findAll({ type: 'Button' })).toHaveLength(4)

    expect((await reply.find({ key: 'mark:2' }))?.text).toBe('☆')
    await reply.press({ key: 'mark:2' })
    await reply.press({ key: 'mark:1' })
    await reply.press({ key: 'mark:3' })
    expect((await reply.find({ key: 'mark:2' }))?.text).toBe('★')
    expect((await pane.find({ key: 'jump:p:msg-1:2' }))?.text).toBe('▸ 1. Third one with a longer sentence in it')
    expect((await pane.find({ key: 'jump:p:msg-1:1' }))?.text).toBe('▸ 2. const a = 1')

    // Saved under the session.
    expect((db.get('marks:session-1') as unknown[]).length).toBe(3)
    expect(db.get('sessions')).toEqual(['session-1'])

    // Type filters: only the kinds present, plus All.
    expect(await pane.find({ key: 'kind:all' })).toBeDefined()
    expect(await pane.find({ key: 'kind:list' })).toBeDefined()
    expect(await pane.find({ key: 'kind:table' })).toBeUndefined()
    await pane.press({ key: 'kind:code' })
    expect(await pane.find({ key: 'jump:p:msg-1:2' })).toBeUndefined()
    expect(await pane.find({ key: 'jump:p:msg-1:1' })).toBeDefined()
    await pane.press({ key: 'kind:all' })

    // Search narrows by the text.
    await pane.input({ key: 'search', text: 'LONGER sentence', kind: 'change' })
    expect(await pane.find({ key: 'jump:p:msg-1:1' })).toBeUndefined()
    expect((await pane.find({ key: 'jump:p:msg-1:2' }))?.text).toBe('▸ 1. Third one with a longer sentence in it')
    await pane.input({ key: 'search', text: 'nothing like this', kind: 'change' })
    expect(await pane.find({ type: 'Text', text: 'No favorites match.' })).toBeDefined()
    await pane.input({ key: 'search', text: '', kind: 'change' })

    // Custom tags: Add tag shows only on an open card.
    expect(await pane.find({ key: 'tags:p:msg-1:2' })).toBeUndefined()
    await pane.press({ key: 'jump:p:msg-1:2' })
    await pane.press({ key: 'tags:p:msg-1:2' })
    await pane.input({ key: 'tag-input:p:msg-1:2', text: 'Auth, fix later #ui' })
    expect(await pane.find({ key: 'tag-input:p:msg-1:2' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: '#fix-later' })).toBeDefined()
    expect((await pane.find({ key: 'tags:p:msg-1:2' }))?.text).toBe('Add tag')

    // A second round adds to the tags; × takes one off.
    await pane.press({ key: 'tags:p:msg-1:2' })
    expect(await pane.find({ key: 'tags:p:msg-1:2' })).toBeUndefined()
    await pane.input({ key: 'tag-input:p:msg-1:2', text: 'later, auth' })
    await pane.press({ key: 'untag:p:msg-1:2:later' })
    expect(await pane.find({ type: 'Text', text: '#later' })).toBeUndefined()
    await pane.press({ key: 'kind:#auth' })
    expect(await pane.find({ key: 'jump:p:msg-1:1' })).toBeUndefined()
    expect(await pane.find({ key: 'jump:p:msg-1:2' })).toBeDefined()
    await pane.press({ key: 'kind:all' })
    await pane.input({ key: 'search', text: 'fix-later', kind: 'change' })
    expect(await pane.find({ key: 'jump:p:msg-1:1' })).toBeUndefined()
    await pane.input({ key: 'search', text: '', kind: 'change' })
    expect((db.get('marks:session-1') as { tags?: string[] }[]).find(x => x.tags)?.tags).toEqual(['auth', 'fix-later', 'ui'])

    expect(await pane.find({ key: 'reply:p:msg-1:3' })).toBeUndefined()

    // Expand all opens the code; delete all empties the list and the store.
    await pane.press({ key: 'toggle-all' })
    expect(await pane.find({ type: 'Code' })).toBeDefined()
    expect(await pane.find({ key: 'copy:p:msg-1:1:0' })).toEqual(surface === 'terminal' ? expect.anything() : undefined)

    await reply.press({ key: 'mark:2' })
    expect(await pane.find({ key: 'jump:p:msg-1:2' })).toBeUndefined()

    await pane.press({ key: 'clear' })
    expect(await pane.find({ type: 'Text', text: 'No favorites yet' })).toBeDefined()
    expect(db.get('marks:session-1')).toEqual([])

    await pane.unmount()
    await reply.unmount()
  }
})
