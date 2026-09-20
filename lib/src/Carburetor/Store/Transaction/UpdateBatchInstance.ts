import {UpdateBatch} from "./UpdateBatch";

/** The batch every carburetor reports to, so one transaction can span several stores. */
export const updateBatch = new UpdateBatch();
