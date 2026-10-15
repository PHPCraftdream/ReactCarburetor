// #region forget
import {ResourceCache} from 'react-carburetor';

interface Draft {
    body: string;
}

declare function fetchDraft(id: string): Promise<Draft>;

const draftCache = new ResourceCache<Draft, string>((id: string) => fetchDraft(id));

export function dropDraft(id: string): void {
    draftCache.forget(id);
}

export function dropAllDrafts(): void {
    draftCache.forgetAll();
}
// #endregion forget
void dropAllDrafts;
