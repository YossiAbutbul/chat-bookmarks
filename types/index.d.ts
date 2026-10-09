export type Mark = { id: string; key: string; snippet: string; text: string; tags?: string[] }

declare module 'claude-code' {
  interface PluginState {
    'chat-bookmarks': { marks: Mark[]; openKeys: string[]; query: string; kind: string; editing: string | null }
  }
}
