# MD Note

<img width="1280" height="784" alt="PixPin_2026-07-29_22-28-59" src="https://github.com/user-attachments/assets/d52f9eb1-843f-46e1-818d-49dfb4f046c7" />

MD Note is a Windows Markdown note editor built for everyday writing, local file management, and a Notion-like editing experience. It keeps your notes as normal `.md` files while adding a structured workspace, rich block editing, tables, links, PDF export, and optional cloud sync.

## Highlights

- Local-first Markdown editing for Windows 10/11.
- Folder-based note workspace with a left file tree.
- Multi-tab editor with session restore.
- Notion-style block editing, slash menu, drag handles, and block insertion.
- Advanced table editing with row/column controls, resize handles, index column support, and horizontal scrolling for wide tables.
- Page links, file links, and web links.
- PDF export.
- English spelling and grammar checking with a custom dictionary.
- Optional InfiniCloud WebDAV sync.
- Portable settings stored next to the executable.

## Download

Download the latest Windows build from the Releases page:

https://github.com/cantonadong/MDNote/releases/latest

The release asset is a Windows executable. No database is required; notes are stored as Markdown files in your selected workspace folder.

## Core Features

### Markdown Editor

MD Note edits Markdown directly and keeps file contents portable. Common Markdown structures are supported through the editor UI:

- Headings
- Paragraphs
- Bold, italic, underline, highlight, and wavy underline
- Bullet lists, ordered lists, and task lists
- Blockquotes
- Code blocks and inline code
- Horizontal rules
- Tables
- Toggle blocks
- Callouts
- Multi-column blocks

### Block Editing

The editor uses block handles and a slash menu to make Markdown editing faster without hiding the underlying Markdown model.

- Insert blocks from the `+` handle or slash menu.
- Drag blocks to reorder content.
- Convert an empty block to another block type.
- Select and move content blocks with visual feedback.
- Use consistent block menus for text, lists, callouts, tables, links, and layout blocks.

### Tables

Tables are a major focus of the editor experience.

- Insert and edit Markdown tables.
- Add, remove, move, and resize rows and columns.
- Drag the bottom `+` control to add or remove multiple rows.
- Drag the right `+` control to add or remove multiple columns.
- Resize columns by dragging column boundaries.
- Auto-fit columns to content.
- Distribute content column widths evenly.
- Optional index column with fixed minimal width.
- Focused cell highlight for the active editing cell.
- Horizontal table scrolling when content is wider than the normal note width.
- Wide-table scrollbar behavior designed to keep the table readable while preserving the normal document left edge.

### File Workspace

MD Note manages notes as files and folders, not as a hidden database.

- Select a root folder for your notes.
- Notes are stored under an `MDNote` folder inside the selected location.
- Create, rename, move, and delete notes or folders.
- Open existing `.md` and `.txt` files.
- Open files by double-clicking from Windows when associated with the app.
- Drag files from Explorer into the app to open them.
- Restore open tabs from the previous session.
- Detect missing files when they were deleted or moved outside the app.

### Tabs

- Open multiple notes at once.
- Keep unsaved changes visible in the tab bar.
- Restore previously opened tabs after restart.
- Open settings as a separate tab-like page.
- Close individual tabs or groups of tabs with unsaved-change protection.

### Links

MD Note supports several link workflows:

- Page links to Markdown notes.
- File links to local files such as spreadsheets, documents, or images.
- Web links opened in the system browser.
- Stable local file/page link tracking so links can keep working after target files are renamed or moved inside the workspace.

### Outline

The right outline panel helps navigate long documents.

- Automatically builds an outline from headings.
- Click outline items to jump through the document.
- Optional outline auto-numbering for same-level headings.

### Search, Grammar, and Writing Help

- Search highlighting inside the current document.
- English spelling and grammar check.
- Red wavy underline for unrecognized English words.
- Common typo correction after finishing a word.
- Custom dictionary support for accepted words.

Grammar checking is optional and can be turned on or off in settings.

### Export

- Export the active note to PDF.
- PDF output is generated from the rendered editor content.

### Cloud Sync

MD Note can optionally sync the notes root directory with InfiniCloud over WebDAV.

Supported sync settings include:

- WebDAV URL
- Username
- App password
- Sync interval
- Manual connection test
- Manual sync
- Last sync status and error display

The InfiniCloud password is stored using Windows DPAPI encryption where supported.

## Settings

Settings are stored in a portable `config.ini` next to the executable.

Available settings include:

- Language: system, English, or Chinese
- Workspace root directory
- Outline auto-numbering
- Grammar checking
- InfiniCloud sync configuration
- Open tab restore state

## Build From Source

### Requirements

- Windows 10/11
- Go
- Node.js and npm
- Wails CLI v2

### Install Dependencies

```powershell
cd frontend
npm install
```

### Run Checks

```powershell
cd frontend
npm run check
```

### Build Windows Executable

```powershell
wails build
```

The executable is generated at:

```text
build/bin/MDNote.exe
```

## Development Notes

The app is built with:

- Wails
- Go
- Svelte
- TypeScript
- Tiptap / ProseMirror

Generated Wails bindings live under `frontend/src/lib/wailsjs`.

## License

MIT
