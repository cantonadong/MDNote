<script lang="ts">
  import { appState } from "$lib/appState.svelte";
  import { t } from "$lib/i18n.svelte";

  let url = $state("");
  let text = $state("");
  // Tracks whether the user has typed into the text field themselves —
  // once they have, pasting/editing the URL stops overwriting it. Reset
  // whenever the dialog (re)opens.
  let textEdited = $state(false);
  let urlInput: HTMLInputElement | undefined = $state();

  let editing = $derived(!!appState.pendingWebLink?.initialUrl);

  // Guards the sync-from-pendingWebLink below to run only once per dialog
  // open rather than on every effect re-run. Without this, re-runs (e.g.
  // triggered by typing in the text field re-rendering the component, which
  // re-fires bind:this on urlInput) called urlInput?.focus() again on every
  // keystroke, yanking focus back to the URL field and making the text
  // field appear uneditable.
  let syncedPendingWebLink: typeof appState.pendingWebLink = null;

  $effect(() => {
    const pending = appState.pendingWebLink;
    if (pending && pending !== syncedPendingWebLink) {
      syncedPendingWebLink = pending;
      url = pending.initialUrl;
      text = pending.initialText;
      // Editing an existing link: both fields already have real values, so
      // touching the URL shouldn't clobber the (presumably deliberate)
      // existing text — same as once the user has typed into text
      // themselves for a brand-new link.
      textEdited = !!text;
      // Autofocus needs the input to exist first — it only renders once
      // pendingWebLink is set, so queue the focus for right after.
      queueMicrotask(() => urlInput?.focus());
    } else if (!pending) {
      syncedPendingWebLink = null;
    }
  });

  function onUrlInput() {
    if (!textEdited) text = url;
  }

  function onTextInput() {
    textEdited = true;
  }

  function submit() {
    appState.resolveWebLink(url, text);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      appState.cancelWebLink();
    }
  }
</script>

{#if appState.pendingWebLink}
  <div class="overlay" onkeydown={onKeydown} role="presentation">
    <div class="dialog">
      <h3>{editing ? t("weblink.editTitle") : t("weblink.title")}</h3>
      <label class="field">
        <span>{t("weblink.url")}</span>
        <input
          bind:this={urlInput}
          type="text"
          placeholder={t("weblink.urlPlaceholder")}
          bind:value={url}
          oninput={onUrlInput}
        />
      </label>
      <label class="field">
        <span>{t("weblink.text")}</span>
        <input type="text" placeholder={t("weblink.textPlaceholder")} bind:value={text} oninput={onTextInput} />
      </label>
      <div class="actions">
        <button onclick={() => appState.cancelWebLink()}>{t("weblink.cancel")}</button>
        <button class="primary" onclick={submit}>{editing ? t("weblink.save") : t("weblink.insert")}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }
  .dialog {
    background: var(--content-bg);
    border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
    padding: 20px;
    width: 380px;
  }
  .dialog h3 {
    margin: 0 0 14px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .field input {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 9px;
    font-size: 13px;
    color: var(--text-primary);
    background: var(--content-bg);
  }
  .field input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  .actions button {
    border: 1px solid var(--border);
    background: var(--content-bg);
    color: var(--text-primary);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .actions button:hover {
    background: var(--hover-bg);
  }
  .actions button.primary {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
</style>
