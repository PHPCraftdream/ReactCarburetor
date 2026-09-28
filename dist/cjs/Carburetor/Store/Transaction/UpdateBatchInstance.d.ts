import { UpdateBatch } from "./UpdateBatch.js";
/**
 * The batch every carburetor reports to, so one transaction can span several stores. Shared
 * across every copy of the library in this process — see sharedSingleton — so a transaction
 * batches a store from another copy too, instead of that store notifying immediately.
 */
export declare const updateBatch: UpdateBatch;
