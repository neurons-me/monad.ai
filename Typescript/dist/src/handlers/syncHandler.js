import { appendSemanticMemory, listHostMemoryHistory, listSemanticMemoriesByNamespace, } from "../claim/memoryStore.js";
export const commitHandler = async (req, res) => {
    try {
        const body = (req.body ?? {});
        const rawEvents = Array.isArray(body.events)
            ? body.events
            : body.memory && typeof body.memory === "object"
                ? [{
                        namespace: body.namespace,
                        ...body.memory,
                        data: Object.prototype.hasOwnProperty.call(body.memory, "data")
                            ? body.memory.data
                            : body.memory.value,
                    }]
                : [];
        if (!rawEvents.length)
            return res.status(400).json({ error: "No events provided" });
        const results = [];
        for (const event of rawEvents) {
            try {
                const memory = appendSemanticMemory(event);
                results.push({ ok: true, memory });
            }
            catch (err) {
                results.push({ ok: false, error: String(err) });
            }
        }
        const first = results[0] && results[0];
        return res.status(201).json({
            ok: results.every((entry) => Boolean(entry.ok)),
            hash: first?.memory?.hash || null,
            results,
        });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
};
export const syncEventsHandler = async (req, res) => {
    try {
        const namespace = String(req.query.namespace || "").trim().toLowerCase();
        const since = Number(req.query.since || 0);
        if (!namespace)
            return res.status(400).json({ error: "Missing namespace" });
        const username = String(req.query.username || "");
        const fingerprint = String(req.query.fingerprint || "");
        const limit = Number(req.query.limit || 2000);
        const events = (username && fingerprint
            ? listHostMemoryHistory(namespace, username, fingerprint, limit)
            : listSemanticMemoriesByNamespace(namespace, { limit })).filter((e) => Number(e?.timestamp ?? 0) > since);
        return res.json({ events, memories: events });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
};
