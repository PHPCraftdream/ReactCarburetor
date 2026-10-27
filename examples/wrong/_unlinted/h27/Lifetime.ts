import {ResourceCache} from '@react-carburetor/core';

declare function loadDraft(id: string): Promise<string>;

// #region doc
export const draftCache = new ResourceCache(loadDraft, {ttl: Infinity});
// #endregion doc
