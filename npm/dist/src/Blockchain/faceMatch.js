"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchFaceTemplate = matchFaceTemplate;
exports.matchFaceTemplateFromStore = matchFaceTemplateFromStore;
/**
 * Compute dot product of two vectors.
 * Returns 0 if lengths differ.
 */
function dot(a, b) {
    if (a.length !== b.length)
        return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}
/**
 * Compute Euclidean norm of a vector.
 */
function norm(a) {
    let sum = 0;
    for (const v of a) {
        sum += v * v;
    }
    return Math.sqrt(sum);
}
/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if lengths differ or zero norm.
 */
function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    const normA = norm(a);
    const normB = norm(b);
    if (normA === 0 || normB === 0)
        return 0;
    return dot(a, b) / (normA * normB);
}
/**
 * Optional: Euclidean distance between two vectors.
 */
function euclideanDistance(a, b) {
    if (a.length !== b.length)
        return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}
/**
 * Match a probe face template against stored faces.
 * @param probe - face template vector to match
 * @param stored - array of stored faces
 * @param opts - optional parameters: threshold (default 0.92), topK (ignored), version filter
 * @returns FaceMatchResult with best match info
 */
function matchFaceTemplate(probe, stored, opts) {
    const threshold = opts?.threshold ?? 0.92;
    const versionFilter = opts?.version;
    // Filter stored faces by version if specified and face has version
    const candidates = stored.filter(f => {
        if (versionFilter && f.version !== undefined) {
            return f.version === versionFilter;
        }
        return true;
    });
    // Filter candidates with same dimensionality as probe
    const filtered = candidates.filter(f => f.template.length === probe.length);
    if (filtered.length === 0) {
        return {
            match: false,
            threshold,
            candidates: 0,
        };
    }
    let bestScore = -Infinity;
    let bestFace;
    for (const face of filtered) {
        const score = cosineSimilarity(probe, face.template);
        if (score > bestScore) {
            bestScore = score;
            bestFace = face;
        }
    }
    const match = bestScore >= threshold;
    return {
        match,
        best: bestFace
            ? {
                id: bestFace.id,
                identityHash: bestFace.identityHash,
                score: bestScore,
            }
            : undefined,
        threshold,
        candidates: filtered.length,
    };
}
/**
 * Async helper to match face template using a provided listFaces() function.
 * @param probe - face template vector to match
 * @param deps - dependency injection with listFaces() returning Promise<StoredFace[]>
 * @param opts - optional parameters
 * @returns Promise resolving to FaceMatchResult
 */
async function matchFaceTemplateFromStore(probe, deps, opts) {
    const stored = await deps.listFaces();
    return matchFaceTemplate(probe, stored, opts);
}
/**
 * Preset thresholds notes:
 * - 0.92: typical threshold for a good balance between false positives and negatives
 * - 0.95+: stricter, fewer false positives, more false negatives
 * - 0.85-0.90: looser, more matches but higher false positive rate
 */
