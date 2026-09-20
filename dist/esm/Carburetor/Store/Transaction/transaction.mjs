import { updateBatch } from "./UpdateBatchInstance.mjs";
const transaction = (body)=>{
    updateBatch.begin();
    try {
        return body();
    } finally{
        updateBatch.end();
    }
};
export { transaction };
