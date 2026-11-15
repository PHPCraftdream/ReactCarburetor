import {Carburetor, computed, transaction} from '@/Engine';

interface IProgress {done: number; total: number; label: string}
interface ITheme {color: string; verbose: boolean}

const setDone = (draft: IProgress, done: number): void => { draft.done = done; };
const setLabel = (draft: IProgress, label: string): void => { draft.label = label; };
const setColor = (draft: ITheme, color: string): void => { draft.color = color; };
const setVerbose = (draft: ITheme, verbose: boolean): void => { draft.verbose = verbose; };

class Progress extends Carburetor<IProgress> {
    public advance(done: number): void { this.update(setDone, done); }
    public rename(label: string): void { this.update(setLabel, label); }
}

class Theme extends Carburetor<ITheme> {
    public paint(color: string): void { this.update(setColor, color); }
    public detail(verbose: boolean): void { this.update(setVerbose, verbose); }
}

const stores = (): {progress: Progress; theme: Theme} => ({
    progress: new Progress({done: 0, total: 10, label: 'build'}),
    theme: new Theme({color: 'green', verbose: false}),
});

/** The README's claim: the engine entry alone is enough to drive a renderer that is not React. */
describe('a renderer built on the engine entry, without React', () => {
    test('repaints only when a field the frame read was written, and only when the frame changed', () => {
        const {progress} = stores();
        let bodies = 0;
        const frame = computed<string>((read) => {
            bodies++;
            const {done, total} = read(progress);

            return `[${'#'.repeat(done)}${'.'.repeat(total - done)}] ${done}/${total}`;
        });
        const painted: string[] = [];
        const subscription = frame.subscribe(() => { painted.push(frame.get()); });

        progress.advance(3);
        progress.rename('deploy');
        progress.advance(3);

        expect(painted).toEqual(['[###.......] 3/10']);
        expect(bodies).toBe(2);

        frame.unsubscribe(subscription);
        progress.advance(5);

        expect(painted).toHaveLength(1);
    });

    test('one frame over two stores repaints once for a transaction that writes both', () => {
        const {progress, theme} = stores();
        const frame = computed<string>(read => `${read(theme).color}:${read(progress).done}`);
        const painted: string[] = [];
        const subscription = frame.subscribe(() => { painted.push(frame.get()); });

        transaction(() => {
            progress.advance(1);
            theme.paint('red');
        });
        progress.advance(2);
        theme.detail(true);

        expect(painted).toEqual(['red:1', 'red:2']);
        frame.unsubscribe(subscription);
    });

    test('the frame follows its own branches: a field it stopped reading no longer repaints it', () => {
        const {progress, theme} = stores();
        const frame = computed<string>(read => read(theme).verbose
            ? `${read(progress).label}: ${read(progress).done}`
            : `${read(progress).done}`);
        const painted: string[] = [];
        const subscription = frame.subscribe(() => { painted.push(frame.get()); });

        progress.rename('a');
        theme.detail(true);
        progress.rename('b');
        theme.detail(false);
        progress.rename('c');
        progress.advance(4);

        expect(painted).toEqual(['a: 0', 'b: 0', '0', '4']);
        frame.unsubscribe(subscription);
    });

    test('watch hands one store\'s selection to a callback until its disposer runs', () => {
        const {progress} = stores();
        const seen: Array<[number, number]> = [];
        const stop = progress.watch(data => data.done, (next, previous) => { seen.push([previous, next]); });

        progress.advance(6);
        progress.rename('x');
        stop();
        progress.advance(7);

        expect(seen).toEqual([[0, 6]]);
    });

    test('the low-level contract an adapter can build on: read(record) and subscribe(callback, {reads})', () => {
        const {progress} = stores();
        const reads = new Set<string>();
        const view = progress.read((path) => { reads.add(path); });

        void view.done;

        let wakes = 0;
        const subscription = progress.subscribe(() => { wakes++; }, {reads});

        progress.advance(1);
        progress.rename('x');

        expect([...reads]).toEqual(['done']);
        expect(wakes).toBe(1);

        progress.unsubscribe(subscription);
        progress.advance(2);

        expect(wakes).toBe(1);
    });
});
