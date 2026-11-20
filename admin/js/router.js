import { switchView } from "./dashboard.js";
import { showToast } from "./dom.js";
import { state } from "./state.js";
import { loadCollections } from "./views/collections.js";
import { activateTab, closeInspector, openInspector, requestCloseInspector } from "./views/inspector.js";

/**
 * Hash routes, so reload, back/forward and shared links keep the place in the panel:
 *   #/collections, #/collections/new, #/collections/<id>/<readiness|documents|playground|settings>,
 *   #/services/embedding, #/services/chat, #/jobs, #/audit, #/health
 * UI actions record the route (pushState); back/forward and edited URLs apply it.
 */

const VIEW_ROUTES = {
    collections: "collections",
    "embedding-services": "services/embedding",
    "chat-services": "services/chat",
    jobs: "jobs",
    audit: "audit",
    health: "health",
};
const ROUTE_VIEWS = Object.fromEntries(Object.entries(VIEW_ROUTES).map(([view, route]) => [route, view]));
const TAB_ROUTES = { ready: "readiness", files: "documents", playground: "playground", editor: "settings" };
const ROUTE_TABS = Object.fromEntries(Object.entries(TAB_ROUTES).map(([tab, route]) => [route, tab]));

let applying = false;

/** The route of what is on screen now. */
export function routeFromState() {
    if (state.inspectorOpen) {
        if (!state.selectedCollection) return "#/collections/new";
        return `#/collections/${encodeURIComponent(state.selectedCollection.id)}/${TAB_ROUTES[state.activeTab] || "readiness"}`;
    }
    return `#/${VIEW_ROUTES[state.currentView] || "collections"}`;
}

/** Called after the UI changed place: adds a history entry for it (not while a route is being applied). */
export function recordRoute() {
    if (applying || !state.dashboardReady) return;
    const route = routeFromState();
    if (location.hash !== route) history.pushState(null, "", route);
}

function parseRoute(hash) {
    const parts = (hash || "").replace(/^#\/?/, "").split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] === "collections" && parts[1] === "new") return { view: "collections", create: true };
    if (parts[0] === "collections" && parts[1]) {
        return { view: "collections", collectionId: parts[1], tab: ROUTE_TABS[parts[2]] || "ready" };
    }
    const view = ROUTE_VIEWS[parts.slice(0, 2).join("/")] || ROUTE_VIEWS[parts[0]] || "collections";
    return { view };
}

/** Shows the place the URL names. */
export async function applyRoute() {
    if (!state.dashboardReady) return;
    const route = parseRoute(location.hash);
    applying = true;
    try {
        if (state.currentView !== route.view) switchView(route.view);
        if (route.create) {
            if (!(state.inspectorOpen && !state.selectedCollection)) await openInspector(null);
        } else if (route.collectionId) {
            if (!state.collections.some((collection) => collection.id === route.collectionId)) await loadCollections();
            if (!state.collections.some((collection) => collection.id === route.collectionId)) {
                showToast("That collection does not exist (or is not visible to you).", "error");
                if (state.inspectorOpen) closeInspector();
            } else {
                if (!state.inspectorOpen || state.selectedCollection?.id !== route.collectionId) await openInspector(route.collectionId, { tab: route.tab });
                else if (state.activeTab !== route.tab) activateTab(route.tab);
            }
        } else if (state.inspectorOpen) {
            await requestCloseInspector();
        }
    } finally {
        applying = false;
        // The applied place may differ from the URL (unknown id, disabled tab): show the real one.
        history.replaceState(null, "", routeFromState());
    }
}

export function bindRouter() {
    window.addEventListener("popstate", () => void applyRoute());
}

/** After sign-in the address is /admin/login; show the panel's own address instead. */
export function leaveLoginAddress() {
    if (location.pathname.endsWith("/admin/login")) history.replaceState(null, "", `/admin/${location.hash}`);
}
