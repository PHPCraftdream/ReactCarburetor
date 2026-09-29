import { READS_TRANSFER } from "./ReadsTransferBrand.mjs";
const transferReads = (reads, id)=>({
        id,
        reads,
        [READS_TRANSFER]: reads
    });
export { transferReads };
