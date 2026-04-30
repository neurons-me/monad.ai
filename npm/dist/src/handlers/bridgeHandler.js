import { createEnvelope, createErrorEnvelope } from "../http/envelope.js";
import { buildMeTargetNrp } from "../http/meTarget.js";
import { resolveObserverRelation, resolveTransportHost } from "../http/namespace.js";
import { resolveSelfDispatch } from "../http/selfMapping.js";
import { buildBridgeTarget, getNamespaceSelectorInfo, parseBridgeTarget, } from "../runtime/bridge.js";
export function createBridgeHandler(config) {
    return async (req, res) => {
        const rawTarget = String(req.query?.target || "").trim();
        const decodedTarget = rawTarget ? decodeURIComponent(rawTarget) : "";
        const parsed = parseBridgeTarget(decodedTarget);
        const requestHost = resolveTransportHost(req) || config.hostname || "unknown-host";
        const relation = resolveObserverRelation(req);
        if (!parsed) {
            return res.status(400).json({
                ok: false,
                operation: "read",
                target: buildBridgeTarget(null, requestHost, relation, decodedTarget),
                error: "TARGET_REQUIRED",
            });
        }
        const bridgeTarget = buildBridgeTarget(parsed, requestHost, relation, decodedTarget);
        let selectorDispatch = null;
        if (!parsed.pathSlash) {
            return res.status(400).json({
                ok: false,
                operation: "read",
                target: bridgeTarget,
                error: "TARGET_PATH_REQUIRED",
            });
        }
        if (parsed.namespace.includes("[") || parsed.namespace.includes("]")) {
            const selectorInfo = getNamespaceSelectorInfo(parsed.namespace);
            const dispatch = resolveSelfDispatch(selectorInfo.base, selectorInfo.selectorRaw, config.selfNodeConfig);
            selectorDispatch = dispatch;
            if (dispatch.mode === "local") {
                parsed.namespace = selectorInfo.base;
            }
            if (dispatch.mode !== "local" && selectorInfo.webTarget) {
                const webTarget = {
                    host: requestHost,
                    namespace: parsed.namespace,
                    operation: "read",
                    path: parsed.pathDot || "",
                    nrp: buildMeTargetNrp(parsed.namespace, "read", parsed.pathDot || "", relation),
                    relation,
                };
                try {
                    const response = await fetch(selectorInfo.webTarget, { method: "GET" });
                    const contentType = String(response.headers.get("content-type") || "text/html; charset=utf-8");
                    const wantsJson = String(req.headers.accept || "").includes("application/json");
                    const bodyText = await response.text();
                    if (!wantsJson) {
                        res.setHeader("Content-Type", contentType);
                        return res.status(response.status).send(bodyText);
                    }
                    return res.status(response.status).json({
                        ...createEnvelope(webTarget, {
                            value: {
                                url: selectorInfo.webTarget,
                                status: response.status,
                                contentType,
                                body: bodyText,
                                overlay: parsed.pathDot || "",
                            },
                        }),
                        dispatch,
                    });
                }
                catch (error) {
                    return res.status(502).json({
                        ...createErrorEnvelope(webTarget, {
                            error: "WEB_FETCH_FAILED",
                            detail: error instanceof Error ? error.message : String(error),
                        }),
                        dispatch,
                    });
                }
            }
            if (dispatch.hasInstanceSelector) {
                return res.status(422).json({
                    ok: false,
                    operation: "read",
                    target: bridgeTarget,
                    dispatch,
                    error: "INSTANCE_SELECTOR_UNRESOLVED",
                    hint: "Selector targets the same identity, but this node is not the requested instance.",
                });
            }
            if (selectorInfo.selectorRaw) {
                return res.status(422).json({
                    ok: false,
                    operation: "read",
                    target: bridgeTarget,
                    dispatch,
                    error: "SELECTOR_BINDING_UNRESOLVED",
                    hint: "Namespace selector requires an instance or transport resolver before HTTP dispatch.",
                });
            }
        }
        if (parsed.pathSlash.startsWith("resolve")) {
            return res.status(400).json({
                ok: false,
                operation: "read",
                target: bridgeTarget,
                error: "RESOLVE_PATH_BLOCKED",
            });
        }
        try {
            const origin = `http://localhost:${config.port}`;
            const url = new URL(`/${parsed.pathSlash}`, origin);
            for (const [key, value] of Object.entries(req.query || {})) {
                if (key === "target")
                    continue;
                if (Array.isArray(value)) {
                    for (const item of value)
                        url.searchParams.append(key, String(item));
                    continue;
                }
                if (typeof value !== "undefined")
                    url.searchParams.set(key, String(value));
            }
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "x-forwarded-host": parsed.namespace,
                    "x-forwarded-proto": "http",
                    host: parsed.namespace,
                },
            });
            const contentType = String(response.headers.get("content-type") || "");
            if (contentType.includes("application/json")) {
                const payload = await response.json();
                const patched = payload && typeof payload === "object"
                    ? { ...payload, target: bridgeTarget, ...(selectorDispatch ? { dispatch: selectorDispatch } : {}) }
                    : { ok: response.ok, operation: "read", target: bridgeTarget, value: payload, ...(selectorDispatch ? { dispatch: selectorDispatch } : {}) };
                return res.status(response.status).json(patched);
            }
            const text = await response.text();
            return res.status(response.status).send(text);
        }
        catch (error) {
            return res.status(500).json({
                ok: false,
                operation: "read",
                target: bridgeTarget,
                error: "BRIDGE_FETCH_FAILED",
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    };
}
