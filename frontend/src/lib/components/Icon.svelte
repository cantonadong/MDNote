<script lang="ts">
  let { name, size = 16 }: { name: string; size?: number } = $props();

  const paths: Record<string, string> = {
    new: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z M14 2v6h6 M12 12v6 M9 15h6",
    open: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
    save: "M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M8 3v6h8V3 M7 14h10v7H7z",
    "save-as": "M5 3h9l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M8 3v5h6V3 M12 14v6 M9 17h6",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.35-4.35",
    replace: "M4 7h11l-3-3 M15 7l-3 3 M20 17H9l3 3 M9 17l3-3",
    undo: "M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
    redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3",
    folder: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z",
    "folder-plus": "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z M12 11v5 M9.5 13.5h5",
    "file-plus": "M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7Z M13 2v7h7 M12 12v6 M9 15h6",
    file: "M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7Z M13 2v7h7",
    "chevron-right": "M9 18l6-6-6-6",
    "chevron-down": "M6 9l6 6 6-6",
    plus: "M12 5v14 M5 12h14",
    close: "M18 6 6 18 M6 6l12 12",
    "more-horizontal": "M5 12h.01 M12 12h.01 M19 12h.01",
    refresh: "M21 12a9 9 0 1 1-2.64-6.36 M21 4v6h-6",
    cloud: "M7 18a4.5 4.5 0 0 1-.5-8.97A5.5 5.5 0 0 1 17.3 8 4 4 0 0 1 17 18H7Z",
    trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
    rename: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
    "chevron-up": "M18 15l-6-6-6 6",
    text: "M4 6h16 M4 12h10 M4 18h13",
    "list-bullet": "M9 6h12 M9 12h12 M9 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
    "list-ordered": "M10 6h11 M10 12h11 M10 18h11 M4 6h1.5v3.5H4 M4.5 6H6 M4 13.5c0-1 2-1 2 0s-2 1.5-2 2.5h2 M4 10v.01",
    quote: "M7 8a3 3 0 0 0-3 3v2a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1H6a3 3 0 0 1 2-3Z M16 8a3 3 0 0 0-3 3v2a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-1a3 3 0 0 1 2-3Z",
    code: "M9 6 3 12l6 6 M15 6l6 6-6 6",
    minus: "M5 12h14",
    "check-square": "M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    megaphone: "M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z M15 8a4 4 0 0 1 0 8 M18 5a8 8 0 0 1 0 14",
    table: "M3 4h18v16H3Z M3 10h18 M3 16h18 M9 4v16 M15 4v16",
    "row-insert-above": "M9 2v6 M6 5h6 M4 12h16 M4 17h16",
    "row-insert-below": "M4 4h16 M4 9h16 M9 14v6 M6 17h6",
    "col-insert-left": "M12 4v16 M18 4v16 M5 9v6 M2 12h6",
    "col-insert-right": "M4 4v16 M10 4v16 M19 9v6 M16 12h6",
    page: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z M14 2v6h6 M9 13h6 M9 17h6",
    link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5 M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5",
    move: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z M10 13h7 M14.5 9.5 18 13l-3.5 3.5",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3a13 13 0 0 1 0 18 M12 3a13 13 0 0 0 0 18",
    columns: "M3 4h18v16H3Z M9 4v16 M15 4v16",
    export: "M12 3v12 M7 10l5 5 5-5 M4 21h16",
    print: "M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6Z",
    settings:
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z",
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "grip"}
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </g>
  {:else if name === "grip4"}
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="9" r="1.6" />
      <circle cx="15" cy="9" r="1.6" />
      <circle cx="9" cy="15" r="1.6" />
      <circle cx="15" cy="15" r="1.6" />
    </g>
  {:else if name === "toggle"}
    <!-- Same equilateral triangle as the toggle block's own disclosure
         icon (see .toggle-icon in Editor.svelte) — unified so the format
         icon shown on hover and the actual collapse control read as the
         same shape. -->
    <polygon points="8,5 8,19 20,12" fill="currentColor" stroke="none" />
  {:else if name === "h1" || name === "h2" || name === "h3" || name === "h4" || name === "h5" || name === "h6"}
    <text
      x="12"
      y="17"
      text-anchor="middle"
      font-size="14"
      font-weight="700"
      fill="currentColor"
      stroke="none"
      font-family="inherit">{name.toUpperCase()}</text
    >
  {:else}
    <path d={paths[name] ?? ""} />
  {/if}
</svg>
