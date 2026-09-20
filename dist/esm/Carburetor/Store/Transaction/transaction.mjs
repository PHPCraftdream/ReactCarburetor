import { diagnostics } from "../Diagnostics/DiagnosticsInstance.mjs";
import { updateBatch } from "./UpdateBatchInstance.mjs";
const isThenable = (value)=>{
    if ('object' != typeof value || null === value) return false;
    return 'function' == typeof value.then;
};
const transaction = (body)=>{
    updateBatch.begin();
    try {
        const result = body();
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV && isThenable(result)) diagnostics.report("transaction() was given an async body. The batch closes when the body returns, so only the writes before its first await are batched. Wrap the synchronous write block in transaction() instead.");
        return result;
    } finally{
        updateBatch.end();
    }
};
export { transaction };
