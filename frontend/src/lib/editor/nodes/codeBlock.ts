import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import java from "highlight.js/lib/languages/java";
import sql from "highlight.js/lib/languages/sql";
import plaintext from "highlight.js/lib/languages/plaintext";

export const codeLanguages = [
  { value: "", label: "纯文本" },
  { value: "sql", label: "SQL" },
  { value: "java", label: "Java" },
] as const;

// Register only languages exposed by the picker so the editor bundle does not
// pull in lowlight's full common-language catalog.
const lowlight = createLowlight();
lowlight.register("sql", sql);
lowlight.register("java", java);
lowlight.register("plaintext", plaintext);

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "code-block-shell";

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      pre.append(code);
      dom.append(pre);

      const select = document.createElement("select");
      select.className = "code-language-select";
      select.setAttribute("aria-label", "Code language");
      const selectedLanguage = node.attrs.language ?? "";
      for (const language of codeLanguages) {
        const option = document.createElement("option");
        option.value = language.value;
        option.textContent = language.label;
        option.selected = language.value === selectedLanguage;
        select.append(option);
      }
      select.value = selectedLanguage;
      select.addEventListener("change", () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            language: select.value || null,
          }),
        );
        editor.commands.focus(undefined, { scrollIntoView: false });
      });
      dom.append(select);

      return {
        dom,
        contentDOM: code,
        update(updatedNode) {
          if (updatedNode.type.name !== "codeBlock") return false;
          node = updatedNode;
          select.value = updatedNode.attrs.language ?? "";
          return true;
        },
        stopEvent(event) {
          return event.target === select || event.target instanceof HTMLOptionElement;
        },
      };
    };
  },
}).configure({ lowlight, defaultLanguage: "plaintext" });
