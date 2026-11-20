import { normalizeAdminActionPath } from "./auth.js";
import { isRecord } from "./dom.js";
import { API, AUDIT_LOG_LIMIT, JOB_LIST_LIMIT, state } from "./state.js";
import { normalizeAuditCollectionValues, normalizeAuditOperationValues } from "./views/audit.js";

export function collectionReadyUrl(collection) {
    return collection?.readyUrl || `${API.rag}/collections/${collection?.id}/ready`;
}

export function collectionQueryUrl(collection) {
    return collection?.queryUrl || `${API.rag}/collections/${collection?.id}/query`;
}

export function collectionRetrieveUrl(collection) {
    return collection?.retrieveUrl || `${API.rag}/collections/${collection?.id}/retrieve`;
}

export function adminCollectionUrl(id) {
    return `${API.admin}/collections/${id}`;
}

export function adminCollectionFilesUrl(id, fileName) {
    const base = `${API.admin}/collections/${id}/files`;
    return fileName === undefined ? base : `${base}/${encodeURIComponent(fileName)}`;
}

export function adminCollectionValidateUrl(id) {
    return id ? `${API.admin}/collections/${id}/validate` : `${API.admin}/collections/validate`;
}

export function adminCollectionPhysicalCollectionsUrl(id) {
    return `${API.admin}/collections/${id}/physical-collections`;
}

export function adminJobUrl(id) {
    return `${API.admin}/jobs/${id}`;
}

export function adminJobDeleteUrl(id) {
    return `${API.admin}/jobs/${id}`;
}

export function adminJobsBulkDeleteUrl() {
    return `${API.admin}/jobs/bulk-delete`;
}

export function adminAuthSessionUrl() {
    return `${API.adminAuth}/session`;
}

export function adminAuthLoginUrl() {
    return `${API.adminAuth}/login`;
}

export function adminAuthLogoutUrl() {
    return `${API.adminAuth}/logout`;
}

export function adminAuthActionTokenUrl() {
    return `${API.adminAuth}/action-token`;
}

export function adminJobsListUrl(options = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit || JOB_LIST_LIMIT));
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.status && options.status !== "all") params.set("status", options.status);
    if (options.collectionId) params.set("collectionId", options.collectionId);
    const query = params.toString();
    return query ? `${API.admin}/jobs?${query}` : `${API.admin}/jobs`;
}

export function adminAuditLogUrl(options = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit || AUDIT_LOG_LIMIT));
    if (options.cursor) params.set("cursor", options.cursor);
    const collectionValues = Array.isArray(options.collectionIds)
        ? options.collectionIds
        : Array.isArray(options.collectionId)
            ? options.collectionId
            : typeof options.collectionId === "string"
                ? options.collectionId.split(",")
                : [];
    const operationValues = Array.isArray(options.operations)
        ? options.operations
        : Array.isArray(options.operation)
            ? options.operation
            : typeof options.operation === "string"
                ? options.operation.split(",")
                : [];
    normalizeAuditCollectionValues(collectionValues).forEach((collectionId) => {
        params.append("collectionId", collectionId);
    });
    normalizeAuditOperationValues(operationValues).forEach((operation) => {
        params.append("operation", operation);
    });
    const query = params.toString();
    return query ? `${API.admin}/audit-log?${query}` : `${API.admin}/audit-log`;
}

export function normalizeError(input, fallback = {}) {
    const status = input?.status ?? fallback.status ?? 0;
    const code = input?.code || fallback.code || (status ? `HTTP_${status}` : "NETWORK_ERROR");
    return {
        normalized: true,
        status,
        code,
        message: input?.message || fallback.message || "Request failed",
        requestId: input?.requestId || fallback.requestId || null,
        details: input?.details || fallback.details || null,
        issues: input?.issues || input?.details?.issues || fallback.issues || null,
        sessionExpired: Boolean(input?.sessionExpired || fallback.sessionExpired),
        cause: input,
    };
}

export function normalizeRequestPath(url) {
    try {
        return new URL(url, window.location.origin).pathname;
    } catch {
        return String(url || "");
    }
}

export function isRagRequest(url) {
    return normalizeRequestPath(url).startsWith(`${API.rag}/`);
}

export function getSessionHeadersForRequest(url) {
    if (!state.auth.session || !isRagRequest(url)) {
        return {};
    }
    return {
        "x-tenant-id": state.auth.session.tenantId,
        "x-user-id": state.auth.session.username,
    };
}

let unauthorizedHandler = null;

/** Called when an API call answers 401 (the session ended or was revoked); set by the auth module. */
export function setUnauthorizedHandler(handler) {
    unauthorizedHandler = handler;
}

/** The auth routes answer 401 as part of signing in; every other 401 means the session is gone. */
function isSessionCheckRequest(url) {
    const pathname = normalizeRequestPath(url);
    return pathname.startsWith(`${API.adminAuth}/`);
}

export async function apiRequest(url, options = {}) {
    const body = options.body;
    const headers = {
        Accept: "application/json",
        ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
        ...getSessionHeadersForRequest(url),
    };

    try {
        const fetchOptions = { credentials: options.credentials || "same-origin", ...options, headers };
        if (!fetchOptions.method || fetchOptions.method === "GET") {
            fetchOptions.cache = fetchOptions.cache || "no-store";
        }
        const response = await fetch(url, fetchOptions);
        if (response.status === 204) return null;

        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();
        let data = null;

        if (text.trim()) {
            if (contentType.includes("application/json")) {
                try {
                    data = JSON.parse(text);
                } catch (error) {
                    throw normalizeError(error, {
                        status: response.status,
                        code: "RESPONSE_PARSE_ERROR",
                        message: "The server sent a response the panel could not read.",
                    });
                }
            } else {
                data = text;
            }
        }

        if (!response.ok) {
            const errorData = isRecord(data) ? data : {};
            const sessionExpired = response.status === 401 && !isSessionCheckRequest(url) && Boolean(unauthorizedHandler);
            if (sessionExpired) unauthorizedHandler();
            throw normalizeError(errorData, {
                sessionExpired,
                status: response.status,
                code: errorData.code || `HTTP_${response.status}`,
                message: errorData.message || (typeof data === "string" && data.trim()) || response.statusText || "Request failed",
                requestId: errorData.requestId,
                details: errorData.details,
                issues: errorData.details?.issues,
            });
        }

        return data;
    } catch (error) {
        if (error?.normalized) throw error;
        throw normalizeError(error, {
            status: 0,
            code: "NETWORK_ERROR",
            message: error?.message || "Network request failed",
        });
    }
}

export async function requestAdminActionToken(method, path) {
    if (!state.auth.enabled || !state.auth.authenticated) {
        return null;
    }
    const data = await apiRequest(adminAuthActionTokenUrl(), {
        method: "POST",
        body: JSON.stringify({ method, path }),
    });
    return data?.actionToken || null;
}

export async function adminMutationRequest(url, options = {}) {
    const method = (options.method || "POST").toUpperCase();
    const token = await requestAdminActionToken(method, normalizeAdminActionPath(url));
    const headers = { ...(options.headers || {}) };
    if (token) {
        headers["x-admin-action-token"] = token;
    }
    return apiRequest(url, {
        ...options,
        method,
        headers,
    });
}
