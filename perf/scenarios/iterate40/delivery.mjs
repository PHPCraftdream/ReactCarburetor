import {emit, load, setupReact} from '../../harness/lib.mjs';
const {Carburetor, AntiHookComponent, computed} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
class Store extends Carburetor {
    /**
     * Publishes a draft mutation.
     *
     * @param fn - Draft mutation.
     */
    change(fn) { this.update(fn); }
}
const run = route => {
    const store = new Store({ids: ['a', 'b'], other: 0});
    let renders = 0;
    const source = computed(read => read(store).ids.map(id => id).join('|'));
    const render = view => { renders++; return React.createElement('output', null, view.ids.map(id => id).join('|') + ':' + view.ids.length); };
    class Owner extends AntiHookComponent {
        /** Renders the tracked store view. */
        render() { return render(this.useCarburetor(store)); }
    }
    const Hook = () => {
        const text = useCarburetorValue(store, view => view.ids.map(id => id).join('|') + ':' + view.ids.length);
        renders++;
        return React.createElement('output', null, text);
    };
    flushSync(() => root.render(React.createElement(route === 'class' ? Owner : Hook)));
    const initial = renders;
    let correct = container.textContent === 'a|b:2';
    flushSync(() => store.change(d => { d.other++; }));
    correct &&= renders === initial;
    const texts = [];
    for (const change of [d => { d.ids[1] = 'B'; }, d => { d.ids.push('c'); }, d => { d.ids.length = 1; }]) {
        flushSync(() => store.change(change));
        texts.push(container.textContent);
    }
    correct &&= JSON.stringify(texts) === JSON.stringify(['a|B:2', 'a|B|c:3', 'a:1']);
    correct &&= source.get() === 'a' && renders - initial === 3;
    flushSync(() => root.render(null));
    return {changes: renders - initial, correct};
};
const owner = run('class'), hook = run('hook');
root.unmount();
emit({classChanges: owner.changes, hookChanges: hook.changes, correct: owner.correct && hook.correct});
