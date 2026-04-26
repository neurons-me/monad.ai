"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveNamespace = void 0;
exports.getNamespaceBranch = getNamespaceBranch;
const manager_js_1 = require("./manager.js");
const namespace_js_1 = require("../http/namespace.js");
Object.defineProperty(exports, "resolveNamespace", { enumerable: true, get: function () { return namespace_js_1.resolveNamespace; } });
function getNamespaceBranch(req) {
    const kernel = (0, manager_js_1.getKernel)();
    const namespace = (0, namespace_js_1.resolveNamespace)(req);
    if (namespace === "localhost" || namespace === "127.0.0.1" || namespace === "unknown") {
        return kernel;
    }
    return kernel["@"](namespace);
}
