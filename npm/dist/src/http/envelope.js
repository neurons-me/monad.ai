"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEnvelope = createEnvelope;
exports.createErrorEnvelope = createErrorEnvelope;
function createEnvelope(target, body = {}) {
    return {
        ok: true,
        operation: target.operation,
        target,
        ...body,
    };
}
function createErrorEnvelope(target, body = {}) {
    return {
        ok: false,
        operation: target.operation,
        target,
        ...body,
    };
}
