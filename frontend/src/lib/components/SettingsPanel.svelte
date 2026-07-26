<script lang="ts">
  import { appState } from "$lib/appState.svelte";
  import { t, type LanguageSetting } from "$lib/i18n.svelte";

  let language = $state<LanguageSetting>((appState.settings.language as LanguageSetting) || "system");
  let outlineAutoNumber = $state(appState.settings.outlineAutoNumber);

  function setLanguage(v: LanguageSetting) {
    language = v;
    void appState.saveAppSettings(language, outlineAutoNumber);
  }

  function toggleOutlineAutoNumber() {
    outlineAutoNumber = !outlineAutoNumber;
    void appState.saveAppSettings(language, outlineAutoNumber);
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
</style>
