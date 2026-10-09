import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mark } from '../types'
import { KIND_LABEL, kindOf, paragraphsOf, segmentsOf } from './paragraphs'
import type { Kind } from './paragraphs'

const PANE = 'chat-bookmarks'
const TITLE = 'Favorites'
const marks = atom({ plugin: 'chat-bookmarks', key: 'marks' } as const, [] as Mark[])
const openKeys = atom({ plugin: 'chat-bookmarks', key: 'openKeys' } as const, [] as string[])
const query = atom({ plugin: 'chat-bookmarks', key: 'query' } as const, '')
const kindFilter = atom({ plugin: 'chat-bookmarks', key: 'kind' } as const, 'all')
const editing = atom({ plugin: 'chat-bookmarks', key: 'editing' } as const, null as string | null)

// Tags get a steady color each, picked from the theme by the tag's name.
const TAG_COLORS = ['suggestion', 'success', 'warning', 'merged', 'planMode', 'autoAccept', 'remember', 'ide']
const tagColor = (tag: string) =>
  TAG_COLORS[[...tag].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TAG_COLORS.length] ?? 'suggestion'

// "auth, Fix later #ui" -> ["auth", "fix-later", "ui"]
const parseTags = (value: string) => [
  ...new Set(
    value
      .split(/[,#]/)
      .map(t => t.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter(Boolean),
  ),
]

// Favorites are kept on disk per session, so reopening a session brings them back.
const SESSIONS = 'sessions'
const MAX_SESSIONS = 50
const storeKey = (sid: string) => `marks:${sid}`

const clip = (line: string) => (line.length > 40 ? `${line.slice(0, 40)}…` : line)
const plain = (text: string) => text.replace(/[#*`>_~|]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

// A code mark is labelled by its first line of code; prose by its words.
const snippetOf = (text: string) => {
  const parts = segmentsOf(text)
  const code = parts.find(p => p.kind === 'code')
  if (code && parts.every(p => p.kind === 'code' || !p.text.trim())) {
    const first = code.source.split('\n').find(l => l.trim()) ?? ''
    return clip(first.trim())
  }
  return clip(text.replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim())
}

// Writes the list and saves it under this session; the oldest sessions' lists give way.
const saveMarks = async ($: EngineInterface, fn: (list: Mark[]) => Mark[]) => {
  await update($, marks, fn)
  try {
    const sid = await $.session.id()
    const list = await read($, marks)
    const known = ((await $.store.get(SESSIONS)) as string[] | undefined) ?? []
    const sessions = [...known.filter(s => s !== sid), sid]
    for (const old of sessions.splice(0, Math.max(0, sessions.length - MAX_SESSIONS))) {
      await $.store.delete(storeKey(old))
    }
    await $.store.set(storeKey(sid), list)
    await $.store.set(SESSIONS, sessions)
  } catch {
    // Saving is best effort; the session's own copy stands.
  }
}

// Scrolls back to the paragraph where the surface allows it (the terminal);
// where it doesn't (the desktop Code tab), the pane shows the text instead.
const jump = async ($: EngineInterface, m: Mark) => {
  try {
    const exact = await $.ui.scroll({ to: { key: m.key }, block: 'start' })
    if (!exact.deny) return true
    const reply = await $.ui.scroll({ to: { requestId: m.id }, block: 'start' })
    return !reply.deny
  } catch {
    return false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'bookmarks', description: 'Open the favorites pane' })
    } catch (err) {
      $.ui.toast(`favorites: /bookmarks not registered: ${String(err)}`)
    }
    try {
      const saved = await $.store.get(storeKey(await $.session.id()))
      if (Array.isArray(saved) && saved.length > 0 && (await read($, marks)).length === 0) {
        await update($, marks, () => saved as Mark[])
      }
    } catch {
      // Nothing saved for this session.
    }
    return next(e)
  })

  on('command.run', { command: 'bookmarks' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Favorites pane opened.' }
  })

  // Each reply, paragraph by paragraph; pointing at one reveals a ☆ at its right edge.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) {
      return next(e)
    }

    const { Box, Button, Markdown } = $.ui.resolve(e)
    const id = e.requestId
    const marked = new Set((await read($, marks)).filter(m => m.id === id).map(m => m.key))

    return (
      <Box flexDirection="column">
        {paragraphsOf(e.props.text).map((para, i) => {
          const key = `p:${id}:${i}`
          const isMarked = marked.has(key)
          return (
            // A keyed row: the hover scope its toggle is revealed under.
            <Box key={key} position="relative" paddingRight={3}>
              <Markdown text={para} />
              <Box
                position="absolute"
                top={0}
                right={0}
                {...(isMarked ? {} : { display: 'none' as const, hover: { display: 'flex' as const } })}
              >
                <Button
                  key={`mark:${i}`}
                  plain
                  dimColor={!isMarked}
                  label={isMarked ? '★' : '☆'}
                  onPress={async () => {
                    await saveMarks($, list =>
                      list.some(m => m.key === key)
                        ? list.filter(m => m.key !== key)
                        : [...list, { id, key, snippet: snippetOf(para), text: para }],
                    )
                    if (!isMarked) await $.ui.open({ id: PANE, title: TITLE })
                  }}
                />
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })

  // The side pane: toolbar, search and type filters, then one card per favorite.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Markdown, Text } = $.ui.resolve(e)
    const list = await read($, marks)
    const editingKey = await read($, editing)
    const shown = new Set(await read($, openKeys))
    const rawQuery = await read($, query)
    const q = plain(rawQuery)
    const kind = await read($, kindFilter)

    const kinds = [...new Set(list.map(m => kindOf(m.text)))]
    const tags = [...new Set(list.flatMap(m => m.tags ?? []))].sort()
    const visible = list
      .map((m, i) => ({ m, n: i + 1, kind: kindOf(m.text) }))
      .filter(v =>
        kind === 'all' ? true : kind.startsWith('#') ? (v.m.tags ?? []).includes(kind.slice(1)) : v.kind === kind,
      )
      .filter(v => !q || plain(`${v.m.text} ${(v.m.tags ?? []).join(' ')}`).includes(q))
    const isAllOpen = visible.length > 0 && visible.every(v => shown.has(v.m.key))

    if (list.length === 0) {
      return (
        <Box flexDirection="column" alignItems="center" paddingY={1}>
          <Text bold>No favorites yet</Text>
          <Text dimColor>Point at a paragraph in a reply and</Text>
          <Text dimColor>click the ☆ at its right edge.</Text>
        </Box>
      )
    }

    const codeBox = (key: string, language: string, source: string) =>
      e.surface === 'terminal' ? (
        <Box key={`code:${key}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>{language || 'code'}</Text>
            <Button
              key={`copy:${key}`}
              plain
              dimColor
              label="Copy"
              onPress={async press => {
                const r = await $.ui.copy({ text: source, surface: press.surface })
                $.ui.toast(r.isCopied ? 'Code copied' : `Couldn't copy: ${r.reason}`)
              }}
            />
          </Box>
          <Code source={source} language={language || undefined} startLine={1} />
        </Box>
      ) : (
        // Other surfaces draw their own code card, copy icon included.
        <Box key={`code:${key}`} flexDirection="column">
          <Code source={source} language={language || undefined} startLine={1} />
        </Box>
      )

    // Comma- or #-separated tags, added to the card's own.
    const addTags = async (m: Mark, value: string) => {
      const added = parseTags(value)
      if (added.length) {
        await saveMarks($, l =>
          l.map(x => (x.key === m.key ? { ...x, tags: [...new Set([...(x.tags ?? []), ...added])] } : x)),
        )
      }
      await update($, editing, () => null)
    }

    const tagInput = (m: Mark) => {
      if (e.surface === 'mobile') return null
      const { Input } = $.ui.resolve(e)
      return (
        <Box key={`tag-edit:${m.key}`} flexGrow={1} flexShrink={1} minWidth={12}>
          <Input
            key={`tag-input:${m.key}`}
            placeholder="add tags, comma separated"
            submitLabel="Save"
            autoFocus
            onSubmit={value => addTags(m, value)}
          />
        </Box>
      )
    }

    const search =
      e.surface === 'mobile'
        ? null
        : (() => {
            const { Input } = $.ui.resolve(e)
            return (
              <Input
                key="search"
                placeholder="Search favorites…"
                value={rawQuery}
                onInput={value => update($, query, () => value)}
                onSubmit={value => update($, query, () => value)}
              />
            )
          })()

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text bold>
            ★ {list.length} {list.length === 1 ? 'favorite' : 'favorites'}
          </Text>
          <Box flexDirection="row" gap={2}>
            <Button
              key="toggle-all"
              plain
              label={isAllOpen ? 'Collapse all' : 'Expand all'}
              onPress={() =>
                update($, openKeys, ks =>
                  isAllOpen
                    ? ks.filter(k => !visible.some(v => v.m.key === k))
                    : [...new Set([...ks, ...visible.map(v => v.m.key)])],
                )
              }
            />
            <Button
              key="clear"
              plain
              label="Delete all"
              onPress={async () => {
                await saveMarks($, () => [])
                await update($, openKeys, () => [])
              }}
            />
          </Box>
        </Box>

        {search}

        {(kinds.length > 1 || tags.length > 0) && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {['all', ...(kinds.length > 1 ? kinds : []), ...tags.map(t => `#${t}`)].map(k => (
              <Button
                key={`kind:${k}`}
                plain
                dimColor={kind !== k}
                label={`${kind === k ? '● ' : ''}${
                  k === 'all' ? 'All' : k.startsWith('#') ? k : KIND_LABEL[k as Kind]
                }`}
                onPress={() => update($, kindFilter, () => k)}
              />
            ))}
          </Box>
        )}

        {visible.length === 0 && <Text dimColor>No favorites match.</Text>}

        {visible.map(({ m, n, kind: k }) => {
          const isOpen = shown.has(m.key)
          const parts = segmentsOf(m.text)
          const code = parts.find(p => p.kind === 'code')
          const language = code && code.kind === 'code' ? code.language || (k === 'code' ? 'code' : '') : ''

          return (
            <Box
              key={`item:${m.key}`}
              flexDirection="column"
              borderStyle="round"
              borderDimColor={!isOpen}
              hover={{ scope: `card:${m.key}`, borderDimColor: false }}
              paddingX={1}
            >
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Box flexShrink={1} flexGrow={1}>
                  <Button
                    key={`jump:${m.key}`}
                    plain
                    label={`${isOpen ? '▾' : '▸'} ${n}. ${m.snippet.replace(/^\[[^\]]*\] /, '')}`}
                    onPress={async () => {
                      if (!isOpen && (await jump($, m))) return
                      await update($, openKeys, ks =>
                        ks.includes(m.key) ? ks.filter(x => x !== m.key) : [...ks, m.key],
                      )
                    }}
                  />
                </Box>
                <Box flexDirection="row" gap={1} flexShrink={0}>
                  {language && <Text dimColor>{language}</Text>}
                  <Button
                    key={`del:${m.key}`}
                    plain
                    dimColor
                    label="✕"
                    onPress={async () => {
                      await saveMarks($, l => l.filter(x => x.key !== m.key))
                      await update($, openKeys, ks => ks.filter(x => x !== m.key))
                    }}
                  />
                </Box>
              </Box>

              {isOpen && (
                <Box key={`text:${m.key}`} flexDirection="column" marginTop={1}>
                  {parts.map((part, j) =>
                    part.kind === 'text' ? (
                      <Markdown key={`md:${m.key}:${j}`} text={part.text} />
                    ) : (
                      codeBox(`${m.key}:${j}`, part.language, part.source)
                    ),
                  )}
                </Box>
              )}

              {isOpen && (m.tags ?? []).length > 0 && (
                <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
                  {(m.tags ?? []).map(t => (
                    <Box key={`chip:${m.key}:${t}`} flexDirection="row" flexShrink={0}>
                      <Text color={tagColor(t)}>#{t}</Text>
                      <Button
                        key={`untag:${m.key}:${t}`}
                        plain
                        dimColor
                        label="×"
                        onPress={() =>
                          saveMarks($, l =>
                            l.map(x => (x.key === m.key ? { ...x, tags: (x.tags ?? []).filter(y => y !== t) } : x)),
                          )
                        }
                      />
                    </Box>
                  ))}
                </Box>
              )}
              {isOpen && (
                <Box
                  flexDirection="row"
                  alignItems="center"
                  columnGap={1}
                  marginTop={(m.tags ?? []).length === 0 ? 1 : 0}
                >
                  {editingKey === m.key ? (
                    tagInput(m)
                  ) : (
                    <Button
                      key={`tags:${m.key}`}
                      plain
                      dimColor
                      label="Add tag"
                      onPress={() => update($, editing, () => m.key)}
                    />
                  )}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
