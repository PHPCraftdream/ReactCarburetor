import {Carburetor, computed} from '@react-carburetor/core/engine';

interface IProgress {done: number; total: number; label: string}

const setDone = (draft: IProgress, done: number): void => {
    draft.done = done;
};

const setLabel = (draft: IProgress, label: string): void => {
    draft.label = label;
};

class ProgressStore extends Carburetor<IProgress> {
    public advance(done: number): void {
        this.update(setDone, done);
    }

    public rename(label: string): void {
        this.update(setLabel, label);
    }
}

const progress = new ProgressStore({done: 0, total: 10, label: 'build'});

// #region frame
// The frame is derived state: its body runs again only when a field it read was written.
const frame = computed<string>((read) => {
    const {done, total} = read(progress);

    return `[${'#'.repeat(done)}${'.'.repeat(total - done)}] ${done}/${total}`;
});

/** Paints the current frame; any renderer goes here: a terminal, a canvas, a native view. */
const paint = (): void => {
    console.log(frame.get());
};

const subscription = frame.subscribe(paint);

progress.advance(3);        // repaints: the frame read `done`
progress.rename('deploy');  // does not: the frame never read `label`

frame.unsubscribe(subscription);
// #endregion frame

// #region watch
/** Receives detached values, the new one and the one before it. */
const logDone = (next: number, previous: number): void => {
    console.log(`done: ${previous} -> ${next}`);
};

const selectDone = (data: IProgress): number => data.done;

// One store, one selection; the returned function stops watching.
const stopWatching = progress.watch(selectDone, logDone);

stopWatching();
// #endregion watch
