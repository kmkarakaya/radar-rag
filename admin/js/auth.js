import { adminAuthLoginUrl, adminAuthLogoutUrl, adminAuthSessionUrl, apiRequest, normalizeError, normalizeRequestPath } from "./api.js";
import { initializeDashboard, resetDashboardState, stopDashboardPolling } from "./dashboard.js";
import { formatDateTime, setButtonLoading } from "./dom.js";
import { elements, state } from "./state.js";
import { syncSaveButtonAccess } from "./views/inspector.js";

export function getAdminSessionSummary() {
    return state.auth.session;
}

export function setAdminSession(session, enabled = state.auth.enabled, capabilities = []) {
    state.auth.enabled = Boolean(enabled);
    state.auth.authenticated = Boolean(session);
    state.auth.session = session || null;
    state.auth.capabilities = Array.isArray(capabilities) ? capabilities : [];
    state.auth.error = null;
    syncAuthChrome();
}

export function clearAdminSession() {
    state.auth.authenticated = false;
    state.auth.session = null;
    state.auth.capabilities = [];
    syncAuthChrome();
}

export function syncAuthChrome() {
    const session = state.auth.session;
    if (elements.authStatus) {
        elements.authStatus.textContent = state.auth.loading
            ? "Checking session..."
            : state.auth.enabled
                ? (state.auth.authenticated ? "Authenticated" : "Authentication required")
                : "Auth disabled";
    }
    if (elements.authError) {
        if (state.auth.error) {
            elements.authError.textContent = state.auth.error;
            elements.authError.classList.remove("hidden");
        } else {
            elements.authError.textContent = "";
            elements.authError.classList.add("hidden");
        }
    }
    if (elements.authSessionSummary) {
        elements.authSessionSummary.textContent = session
            ? `${session.username} on ${session.tenantId}`
            : state.auth.enabled
                ? "No active admin session"
                : "Admin auth is disabled";
    }
    if (elements.authSessionRole) {
        elements.authSessionRole.textContent = session?.role || "-";
    }
    if (elements.authSessionTenant) {
        elements.authSessionTenant.textContent = session?.tenantId || "-";
    }
    if (elements.authSessionExpiry) {
        elements.authSessionExpiry.textContent = session?.expiresAt ? formatDateTime(session.expiresAt) : "-";
    }
    if (elements.authBadge) {
        elements.authBadge.textContent = state.auth.authenticated && session
            ? `${session.role} - ${session.username}`
            : state.auth.enabled
                ? "Signed out"
                : "Auth off";
    }
    if (elements.authLogoutButton) {
        elements.authLogoutButton.disabled = !state.auth.authenticated;
    }
    if (elements.btnCreateCollection) {
        const allowed = canAdminAction("createCollection");
        elements.btnCreateCollection.disabled = !allowed;
        if (!allowed) {
            elements.btnCreateCollection.title = state.auth.enabled
                ? "Create collection requires operator access."
                : "Create collection";
        } else {
            elements.btnCreateCollection.removeAttribute("title");
        }
    }
    syncSaveButtonAccess();
}

export function shouldPromptForLogin() {
    return state.auth.enabled && !state.auth.authenticated;
}

export function setDashboardVisible(visible) {
    if (elements.dashboardShell) {
        elements.dashboardShell.classList.toggle("hidden", !visible);
    }
    if (elements.authShell) {
        elements.authShell.classList.toggle("hidden", visible);
    }
}

export function resetAuthForm() {
    if (elements.authPassword) elements.authPassword.value = "";
}

export function normalizeAdminActionPath(url) {
    return normalizeRequestPath(url);
}

/** Whether the session may do this, from the capabilities the server returned (the server checks every request). */
export function canAdminAction(capability) {
    return state.auth.capabilities.includes(capability);
}

export async function loadAdminSession() {
    state.auth.loading = true;
    state.auth.error = null;
    syncAuthChrome();
    try {
        const data = await apiRequest(adminAuthSessionUrl());
        state.auth.enabled = Boolean(data?.enabled);
        if (data?.authenticated && data?.session) {
            setAdminSession(data.session, data.enabled, data.capabilities);
            return true;
        }
        setAdminSession(null, data?.enabled, data?.enabled ? [] : data?.capabilities);
        return !data?.enabled;
    } catch (error) {
        const normalized = normalizeError(error);
        if (normalized.status === 401 || normalized.code === "UNAUTHORIZED") {
            state.auth.enabled = true;
            clearAdminSession();
            return false;
        }
        state.auth.error = normalized.message;
        syncAuthChrome();
        throw error;
    } finally {
        state.auth.loading = false;
        syncAuthChrome();
    }
}

export async function loginAdmin(event) {
    event?.preventDefault?.();
    const username = elements.authUsername?.value.trim();
    const password = elements.authPassword?.value || "";
    if (!username || !password) {
        state.auth.error = "Username and password are required.";
        syncAuthChrome();
        return;
    }

    try {
        setButtonLoading(elements.authLoginButton, true, "Signing in...");
        const data = await apiRequest(adminAuthLoginUrl(), {
            method: "POST",
            body: JSON.stringify({ username, password }),
        });
        if (!data?.session) {
            throw normalizeError(null, { status: 0, code: "INVALID_AUTH_RESPONSE", message: "The server did not confirm the sign-in. Try again." });
        }
        state.auth.enabled = true;
        setAdminSession(data.session, true, data.capabilities);
        resetAuthForm();
        resetDashboardState();
        setDashboardVisible(true);
        await initializeDashboard();
    } catch (error) {
        const normalized = normalizeError(error);
        state.auth.error = normalized.status === 401 ? "Invalid username or password." : normalized.message;
        syncAuthChrome();
    } finally {
        setButtonLoading(elements.authLoginButton, false, "Sign in");
    }
}

/** The session ended (expired, revoked or the server restarted with a new secret): back to sign-in, once. */
export function handleSessionExpired() {
    if (!state.auth.enabled || !state.auth.authenticated) return;
    stopDashboardPolling();
    clearAdminSession();
    resetDashboardState();
    setDashboardVisible(false);
    state.auth.error = "Your session has ended. Sign in again.";
    syncAuthChrome();
    elements.authUsername?.focus();
}


export async function logoutAdmin() {
    try {
        setButtonLoading(elements.authLogoutButton, true, "Signing out...");
        await apiRequest(adminAuthLogoutUrl(), { method: "POST" });
    } catch (error) {
        console.warn("Logout failed", error);
    } finally {
        clearAdminSession();
        resetAuthForm();
        stopDashboardPolling();
        resetDashboardState();
        setDashboardVisible(false);
        syncAuthChrome();
        if (!state.auth.enabled) {
            setDashboardVisible(true);
            await initializeDashboard();
        }
        setButtonLoading(elements.authLogoutButton, false, "Sign out");
    }
}
