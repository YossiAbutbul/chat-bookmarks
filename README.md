# chat-bookmarks

A Claude Code mod for starring paragraphs in Claude's replies and keeping them in a side pane.

- Hover a paragraph in a reply and click the ☆ at its right edge to favorite it (★ once marked).
- The **Favorites** pane lists each favorite as a card: expand it to read the text, with code blocks highlighted.
- Add your own tags, filter by type (code, list, text…) or tag, and search.
- Favorites are saved per session, so reopening a session brings them back.
- `/bookmarks` opens the pane.

In the terminal, clicking a favorite scrolls the chat back to it. The desktop Code tab doesn't let mods scroll the chat, so there the card opens in place instead.

## Load it

Point Claude Code at this folder, for every session, in `~/.claude/settings.json`:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\chat-bookmarks"
}
```

Or for one terminal session:

```bash
claude --plugin-dir /path/to/chat-bookmarks
```

## Develop

```bash
claude plugin validate .
claude plugin test .
```
