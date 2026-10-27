import {AntiHookComponent, Carburetor, ResourceCarburetor, ResourceCache, bind, computed} from '@react-carburetor/core';

interface Model {count: number}
class CounterStore extends Carburetor<Model> {
    @bind
    increment(): void { this.draft.count += 1; this.emitUpdate(); }
}
const counter = new CounterStore({count: 0});
const doubled = computed(read => read(counter).count * 2);
const cache = new ResourceCache<number, [string]>(async key => key.length);
const loadProfile = async (): Promise<{name: string}> => ({name: 'Ada'});
class ProfileResource extends ResourceCarburetor<{name: string}> {
    constructor() { super(loadProfile); }
}
const profile = new ProfileResource();
class Dashboard extends AntiHookComponent {
    render() { return <output>{this.useComputed(doubled)}</output>; }
}
void [cache, profile, Dashboard];
