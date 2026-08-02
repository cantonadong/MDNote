<script lang="ts">
  import { appState } from "$lib/appState.svelte";
  import { api } from "$lib/api";
  import { t, i18n, formatSyncTime, type LanguageSetting } from "$lib/i18n.svelte";

  let language = $state<LanguageSetting>((appState.settings.language as LanguageSetting) || "system");
  let outlineAutoNumber = $state(appState.settings.outlineAutoNumber);
  let grammarCheckEnabled = $state(appState.settings.grammarCheckEnabled);

  function setLanguage(v: LanguageSetting) {
    language = v;
    void appState.saveAppSettings(language, outlineAutoNumber, grammarCheckEnabled);
  }

  function toggleOutlineAutoNumber() {
    outlineAutoNumber = !outlineAutoNumber;
    void appState.saveAppSettings(language, outlineAutoNumber, grammarCheckEnabled);
  }

  function toggleGrammarCheck() {
    grammarCheckEnabled = !grammarCheckEnabled;
    void appState.saveAppSettings(language, outlineAutoNumber, grammarCheckEnabled);
  }

  // Cloud sync fields are local drafts, saved only via the explicit Save
  // button (unlike the toggles above, which save on every change) — these
  // include a credential, so writing config.ini on every keystroke would be
  // both wasteful and a worse UX if a field is mid-edit.
  let syncEnabled = $state(appState.settings.syncEnabled);
  let syncURL = $state(appState.settings.syncURL);
  let syncUsername = $state(appState.settings.syncUsername);
  let syncPassword = $state(appState.settings.syncPassword);
  let syncInterval = $state(appState.settings.syncIntervalMinutes || 30);
  let testState = $state<"idle" | "testing" | "ok" | "error">("idle");
  let testMessage = $state("");
  let saveState = $state<"idle" | "saved">("idle");
  let syncNowRunning = $state(false);

  async function testConnection() {
    testState = "testing";
    try {
      const err = await api.testSyncConnection(syncURL, syncUsername, syncPassword);
      if (err) {
        testState = "error";
        testMessage = err;
      } else {
        testState = "ok";
        testMessage = "";
      }
    } catch (e) {
      testState = "error";
      testMessage = String(e);
    }
  }

  async function saveSyncSettings() {
    const ok = await appState.saveSyncSettings(syncEnabled, syncURL, syncUsername, syncPassword, syncInterval);
    if (!ok) return;
    saveState = "saved";
    setTimeout(() => {
      if (saveState === "saved") saveState = "idle";
    }, 2000);
  }

  function toggleSyncEnabled() {
    syncEnabled = !syncEnabled;
    void saveSyncSettings();
  }

  async function syncNow() {
    syncNowRunning = true;
    try {
      await appState.syncNow();
    } finally {
      syncNowRunning = false;
    }
  }

  function formatLastSync(iso: string): string {
    if (!iso) return t("settings.sync.never");
    const time = formatSyncTime(iso, i18n.locale);
    return time === iso ? t("settings.sync.never") : time;
  }
</script>

<div class="settings-page">
  <div class="settings-col">
    <h1>{t("settings.title")}</h1>

    <section>
      <div class="row-label">{t("settings.language.label")}</div>
      <div class="options">
        <button class:active={language === "zh"} onclick={() => setLanguage("zh")}>{t("settings.language.zh")}</button>
        <button class:active={language === "en"} onclick={() => setLanguage("en")}>{t("settings.language.en")}</button>
        <button class:active={language === "system"} onclick={() => setLanguage("system")}
          >{t("settings.language.system")}</button
        >
      </div>
    </section>

    <section>
      <div class="row-label">{t("settings.outline.label")}</div>
      <label class="toggle-row">
        <input type="checkbox" checked={outlineAutoNumber} onchange={toggleOutlineAutoNumber} />
        <span class="desc">{t("settings.outline.desc")}</span>
      </label>
    </section>

    <section>
      <div class="row-label">{t("settings.grammar.label")}</div>
      <label class="toggle-row">
        <input type="checkbox" checked={grammarCheckEnabled} onchange={toggleGrammarCheck} />
        <span class="desc">{t("settings.grammar.desc")}</span>
      </label>
    </section>

    <section>
      <div class="row-label">{t("settings.sync.label")}</div>
      <p class="desc sync-desc">{t("settings.sync.desc")}</p>
      <label class="toggle-row">
        <input type="checkbox" checked={syncEnabled} onchange={toggleSyncEnabled} />
        <span class="desc">{t("settings.sync.enable")}</span>
      </label>

      <div class="sync-form">
        <label class="field">
          <span class="field-label">{t("settings.sync.url")}</span>
          <input type="text" bind:value={syncURL} placeholder="https://your-username.teracloud.jp/dav/" />
          <span class="field-hint">{t("settings.sync.urlHint")}</span>
        </label>
        <label class="field">
          <span class="field-label">{t("settings.sync.username")}</span>
          <input type="text" bind:value={syncUsername} autocomplete="off" />
          <span class="field-hint">{t("settings.sync.usernameHint")}</span>
        </label>
        <label class="field">
          <span class="field-label">{t("settings.sync.password")}</span>
          <input type="password" bind:value={syncPassword} autocomplete="off" />
          <span class="field-hint">{t("settings.sync.passwordHint")}</span>
        </label>
        <label class="field field-narrow">
          <span class="field-label">{t("settings.sync.interval")}</span>
          <input type="number" min="1" bind:value={syncInterval} />
        </label>
      </div>

      <div class="sync-actions">
        <button class="btn" onclick={testConnection} disabled={testState === "testing"}>
          {t("settings.sync.test")}
        </button>
        <button class="btn" onclick={saveSyncSettings}>
          {saveState === "saved" ? t("settings.sync.saved") : t("settings.sync.save")}
        </button>
        <button class="btn" onclick={syncNow} disabled={syncNowRunning || !appState.settings.syncEnabled}>
          {t("settings.sync.syncNow")}
        </button>
      </div>

      {#if testState === "ok"}
        <div class="sync-status ok">{t("settings.sync.testSuccess")}</div>
      {:else if testState === "error"}
        <div class="sync-status error">{t("settings.sync.testFailed")}：{testMessage}</div>
      {/if}

      <div class="desc sync-last">
        {t("settings.sync.lastSync")}：{formatLastSync(appState.settings.lastSyncTime)}
      </div>
    </section>
  </div>
</div>

<style>
  .settings-page {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    background: var(--content-bg);
    display: flex;
    justify-content: center;
  }
  .settings-col {
    width: 100%;
    max-width: 560px;
    padding: 56px 40px;
  }
  h1 {
    margin: 0 0 28px;
    font-size: 22px;
    font-weight: 700;
    color: var(--text-primary);
  }
  section {
    padding: 18px 0;
    border-top: 1px solid var(--border);
  }
  .row-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }
  .desc {
    font-size: 12.5px;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .options {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .options button {
    border: 1px solid var(--border);
    background: var(--content-bg);
    color: var(--text-primary);
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .options button:hover {
    background: var(--hover-bg);
  }
  .options button.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    cursor: pointer;
    width: fit-content;
  }
  .toggle-row input {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  .sync-desc {
    margin: 4px 0 10px;
  }
  .sync-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
    max-width: 360px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-narrow {
    max-width: 140px;
  }
  .field-label {
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .field-hint {
    font-size: 11.5px;
    color: var(--text-secondary);
    opacity: 0.8;
    line-height: 1.4;
  }
  .field input {
    border: 1px solid var(--border);
    background: var(--content-bg);
    color: var(--text-primary);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 13px;
    font-family: inherit;
  }
  .field input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .sync-actions {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }
  .btn {
    border: 1px solid var(--border);
    background: var(--content-bg);
    color: var(--text-primary);
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--hover-bg);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .sync-status {
    margin-top: 10px;
    font-size: 12.5px;
  }
  .sync-status.ok {
    color: #2f9e44;
  }
  .sync-status.error {
    color: #e03e3e;
  }
  .sync-last {
    margin-top: 10px;
  }
</style>
