import { createEl } from "./dom.js";

/**
 * An accessible confirmation dialog (instead of window.confirm): focus moves into it and stays there,
 * Escape or Cancel resolves false, and focus returns to where it was. With `requireText`, the confirm
 * button is enabled only after that exact text is typed (for actions that cannot be undone).
 */
export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, requireText = null }) {
    return new Promise((resolve) => {
        const previousFocus = document.activeElement;
        const overlay = createEl("div", "fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4");
        const dialog = createEl("div", "w-full max-w-md rounded-xl bg-white p-6 shadow-2xl");
        dialog.setAttribute("role", "alertdialog");
        dialog.setAttribute("aria-modal", "true");
        const titleId = `dialog-title-${Date.now()}`;
        const messageId = `${titleId}-message`;
        dialog.setAttribute("aria-labelledby", titleId);
        dialog.setAttribute("aria-describedby", messageId);

        const heading = createEl("h2", "text-lg font-semibold text-slate-900", title);
        heading.id = titleId;
        const body = createEl("p", "mt-2 text-sm text-slate-600", message);
        body.id = messageId;
        dialog.append(heading, body);

        let input = null;
        if (requireText) {
            const label = createEl("label", "mt-4 block text-sm text-slate-700");
            label.append(createEl("span", "", "Type "), createEl("strong", "font-semibold", requireText), createEl("span", "", " to confirm."));
            input = createEl("input", "mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none");
            input.type = "text";
            input.autocomplete = "off";
            label.appendChild(input);
            dialog.appendChild(label);
        }

        const actions = createEl("div", "mt-6 flex justify-end gap-3");
        const cancel = createEl("button", "rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50", cancelLabel);
        cancel.type = "button";
        const confirm = createEl("button", `rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"}`, confirmLabel);
        confirm.type = "button";
        confirm.disabled = Boolean(requireText);
        actions.append(cancel, confirm);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);

        const close = (result) => {
            document.removeEventListener("keydown", onKeyDown, true);
            overlay.remove();
            if (previousFocus instanceof HTMLElement) previousFocus.focus();
            resolve(result);
        };
        const focusables = () => [...dialog.querySelectorAll("button, input")].filter((element) => !element.disabled);
        const onKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close(false);
            } else if (event.key === "Tab") {
                const items = focusables();
                const first = items[0];
                const last = items[items.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            } else if (event.key === "Enter" && document.activeElement === input && !confirm.disabled) {
                event.preventDefault();
                close(true);
            }
        };

        input?.addEventListener("input", () => {
            confirm.disabled = input.value.trim() !== requireText;
        });
        cancel.addEventListener("click", () => close(false));
        confirm.addEventListener("click", () => close(true));
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close(false);
        });
        document.addEventListener("keydown", onKeyDown, true);
        document.body.appendChild(overlay);
        (input ?? cancel).focus();
    });
}
