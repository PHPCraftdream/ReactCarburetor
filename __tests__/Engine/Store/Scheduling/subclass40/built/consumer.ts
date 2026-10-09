import {Carburetor, AntiHookComponent, ResourceCache, ResourceCarburetor} from '../../../../../../dist/esm/Carburetor/index.mjs';

class Store extends Carburetor<{n: number}> {
    public version = 7;
    public uid = 'domain';
    public scheduler = 'domain';
    public writes = 'domain';
    public commitState = 'domain';
    public change(): void { this.update(draft => { draft.n++; }); }
    protected preEmit(changed: ReadonlySet<string>): void { void changed.size; void this.data.n; }
    public invalid(): void {
        // @ts-expect-error the documented readonly root getter has no setter
        this.data = {n: 2};
    }
}
class InvalidRoot extends Carburetor<{n: number}> {
    // @ts-expect-error data is the documented accessor exception to ordinary field names
    public data = {n: 1};
}
class Cache extends ResourceCache<string, string> { public ttl = 'domain'; public loader = 'domain'; }
class Slot extends ResourceCarburetor<string, string> { public runtime = 'domain'; public operationVersion = 'domain'; }
class Owner extends AntiHookComponent {
    public uid = 'domain';
    public tracked = 'domain';
    public track = 'domain';
    public render(): null { return null; }
}
void Store;
void InvalidRoot;
void Cache;
void Slot;
void Owner;
