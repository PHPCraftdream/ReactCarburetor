"use strict";
var __webpack_require__ = {};
(()=>{
    __webpack_require__.d = (exports1, getters, values)=>{
        var define = (defs, kind)=>{
            for(var key in defs)if (__webpack_require__.o(defs, key) && !__webpack_require__.o(exports1, key)) Object.defineProperty(exports1, key, {
                enumerable: true,
                [kind]: defs[key]
            });
        };
        define(getters, "get");
        define(values, "value");
    };
})();
(()=>{
    __webpack_require__.o = (obj, prop)=>Object.prototype.hasOwnProperty.call(obj, prop);
})();
(()=>{
    __webpack_require__.r = (exports1)=>{
        if ("u" > typeof Symbol && Symbol.toStringTag) Object.defineProperty(exports1, Symbol.toStringTag, {
            value: 'Module'
        });
        Object.defineProperty(exports1, '__esModule', {
            value: true
        });
    };
})();
var __webpack_exports__ = {};
__webpack_require__.r(__webpack_exports__);
const WILDCARD_PATH = '*';
const PATH_SEPARATOR = '.';
const joinPath = (basePath, key)=>basePath ? basePath + PATH_SEPARATOR + key : key;
const pathsTouch = (readPath, writePath)=>readPath === writePath || readPath.startsWith(writePath + PATH_SEPARATOR) || writePath.startsWith(readPath + PATH_SEPARATOR);
const pathsIntersect = (reads, writes)=>{
    if (reads.has(WILDCARD_PATH) || writes.has(WILDCARD_PATH)) return true;
    for (const writePath of writes)for (const readPath of reads)if (pathsTouch(readPath, writePath)) return true;
    return false;
};
__webpack_require__.d(__webpack_exports__, {}, {
    WILDCARD_PATH: WILDCARD_PATH,
    joinPath: joinPath,
    pathsIntersect: pathsIntersect
});
exports.WILDCARD_PATH = __webpack_exports__.WILDCARD_PATH;
exports.joinPath = __webpack_exports__.joinPath;
exports.pathsIntersect = __webpack_exports__.pathsIntersect;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "WILDCARD_PATH",
    "joinPath",
    "pathsIntersect"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
