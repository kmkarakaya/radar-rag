/**
 * A text field with a list of suggestions (WAI-ARIA combobox), used for model names. Replaces the browser's
 * <datalist>, whose popup the panel cannot style or place (it opened dark and beside the field in the sliding
 * inspector) and which hides every suggestion that does not start like the current text.
 *
 * Markup (in index.html):
 *   <div class="relative">
 *     <input id="x" role="combobox" aria-controls="xList" aria-expanded="false" aria-autocomplete="list">
 *     <button type="button" data-combobox-toggle aria-controls="xList">
 *     <ul id="xList" role="listbox" class="hidden">
 *   </div>
 *
 * The suggestions always come from getOptions() (the server's model lists); the field keeps no copy of them,
 * and any text can still be typed. Choosing a suggestion fires "input" and "change" on the field, so existing
 * listeners run as if the user had typed it.
 *
 * No DOM access happens at import time (filterOptions is used by the Node tests).
 */

/**
 * The suggestions to show: unique non-empty names in their order, those containing the query (case-insensitive).
 * Everything is shown when asked (opened with the button), when the query is empty, or when it is exactly one
 * of the names (the field holds a choice; the list then helps to change it).
 */
export function filterOptions(options, query, { showAll = false } = {}) {
    const unique = [...new Set(
        (Array.isArray(options) ? options : [])
            .filter((value) => typeof value === "string" && value.trim() !== "")
            .map((value) => value.trim()),
    )];
    const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
    if (showAll || needle === "" || unique.some((value) => value.toLowerCase() === needle)) return unique;
    return unique.filter((value) => value.toLowerCase().includes(needle));
}

const instances = new WeakMap();

/** The combobox set up on a field, if any. */
export function comboboxFor(input) {
    return input ? instances.get(input) ?? null : null;
}

const OPTION_CLASS = "cursor-pointer break-all px-3 py-1.5 text-sm text-slate-700";
const ACTIVE_CLASSES = ["bg-indigo-50", "text-indigo-900"];

/**
 * Sets up a combobox on an input that sits in the markup above. Returns { open, close, refresh, isOpen }.
 * `emptyText` is shown when no suggestion matches.
 */
export function createCombobox({ input, getOptions, emptyText = "No match. You can type any name." }) {
    if (!input) return null;
    const existing = instances.get(input);
    if (existing) return existing;
    const wrapper = input.parentElement;
    const listbox = document.getElementById(input.getAttribute("aria-controls") || "");
    const toggle = wrapper?.querySelector("[data-combobox-toggle]") ?? null;
    if (!wrapper || !listbox) return null;

    let items = [];
    let activeIndex = -1;
    let showingAll = false;
    let choosing = false;

    const isDisabled = () => input.matches(":disabled") || input.readOnly;
    const isOpen = () => !listbox.classList.contains("hidden");
    const optionId = (index) => `${listbox.id}-option-${index}`;

    function render() {
        listbox.replaceChildren();
        const current = input.value.trim();
        if (items.length === 0) {
            const empty = document.createElement("li");
            empty.setAttribute("role", "presentation");
            empty.className = "px-3 py-1.5 text-xs text-slate-500";
            empty.textContent = emptyText;
            listbox.appendChild(empty);
            return;
        }
        items.forEach((value, index) => {
            const option = document.createElement("li");
            option.id = optionId(index);
            option.setAttribute("role", "option");
            option.setAttribute("aria-selected", value === current ? "true" : "false");
            option.className = OPTION_CLASS + (value === current ? " font-semibold" : "");
            option.textContent = value;
            // Keep focus in the field while the mouse picks a suggestion.
            option.addEventListener("mousedown", (event) => event.preventDefault());
            option.addEventListener("click", () => choose(value));
            listbox.appendChild(option);
        });
        setActive(activeIndex);
    }

    function setActive(index) {
        listbox.querySelectorAll('[role="option"]').forEach((option) => option.classList.remove(...ACTIVE_CLASSES));
        activeIndex = items.length === 0 ? -1 : Math.max(-1, Math.min(index, items.length - 1));
        if (activeIndex < 0) {
            input.removeAttribute("aria-activedescendant");
            return;
        }
        const option = document.getElementById(optionId(activeIndex));
        option?.classList.add(...ACTIVE_CLASSES);
        input.setAttribute("aria-activedescendant", optionId(activeIndex));
        option?.scrollIntoView({ block: "nearest" });
    }

    function open({ showAll = false } = {}) {
        if (isDisabled()) return;
        showingAll = showAll;
        items = filterOptions(getOptions(), input.value, { showAll });
        activeIndex = items.indexOf(input.value.trim());
        listbox.classList.remove("hidden");
        input.setAttribute("aria-expanded", "true");
        toggle?.setAttribute("aria-expanded", "true");
        render();
    }

    function close() {
        if (!isOpen()) return;
        listbox.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
        toggle?.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        activeIndex = -1;
    }

    /** Redraws an open list from getOptions() (the server's models changed or another service was chosen). */
    function refresh() {
        if (!isOpen()) return;
        items = filterOptions(getOptions(), input.value, { showAll: showingAll });
        render();
    }

    function choose(value) {
        input.value = value;
        close();
        choosing = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        choosing = false;
        input.focus();
    }

    // Typing filters the list; a value set by code (an "input" event fired elsewhere) does not open it.
    input.addEventListener("input", () => {
        if (choosing || document.activeElement !== input) return;
        open({ showAll: false });
    });
    input.addEventListener("click", () => {
        if (isOpen()) return;
        open({ showAll: input.value.trim() === "" });
    });
    input.addEventListener("keydown", (event) => {
        if (isDisabled()) return;
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                if (!isOpen() || event.altKey) open({ showAll: true });
                else setActive(activeIndex + 1);
                break;
            case "ArrowUp":
                event.preventDefault();
                if (!isOpen()) {
                    open({ showAll: true });
                    setActive(items.length - 1);
                } else {
                    setActive(Math.max(0, activeIndex - 1));
                }
                break;
            case "Home":
                if (!isOpen()) return;
                event.preventDefault();
                setActive(0);
                break;
            case "End":
                if (!isOpen()) return;
                event.preventDefault();
                setActive(items.length - 1);
                break;
            case "Enter":
                if (!isOpen()) return;
                if (activeIndex >= 0) {
                    event.preventDefault();
                    choose(items[activeIndex]);
                } else {
                    close();
                }
                break;
            case "Escape":
                if (!isOpen()) return;
                event.preventDefault();
                event.stopPropagation();
                close();
                break;
            case "Tab":
                close();
                break;
            default:
                break;
        }
    });
    toggle?.addEventListener("mousedown", (event) => event.preventDefault());
    toggle?.addEventListener("click", () => {
        if (isOpen()) {
            close();
        } else {
            open({ showAll: true });
            input.focus();
        }
    });
    wrapper.addEventListener("focusout", (event) => {
        if (!(event.relatedTarget instanceof Node) || !wrapper.contains(event.relatedTarget)) close();
    });
    document.addEventListener("mousedown", (event) => {
        if (event.target instanceof Node && !wrapper.contains(event.target)) close();
    });

    const api = { open, close, refresh, isOpen };
    instances.set(input, api);
    return api;
}
