// Type-only checks: storeEffect and useStoreEffect infer the effect's value from the selector or
// the computed. Runtime behavior is in StoreEffect.test.ts and the component suites.
import {AntiHookComponent, Carburetor, IComputed, TDisposer, computed, storeEffect} from '@/Carburetor';

interface IDraft {text: string; size: number}

const draft = new Carburetor<IDraft>({text: '', size: 0});
const selectText = (data: IDraft): string => data.text;
const length: IComputed<number> = computed((read) => read(draft).text.length);

// The selection's type reaches the effect and its previous value.
const stopText: TDisposer = storeEffect(draft, selectText, (text, previous) => {
    const now: string = text;
    const before: string | undefined = previous;
    void now;
    void before;
});

// A computed's type reaches the effect.
const stopLength: TDisposer = storeEffect(length, (value) => {
    const now: number = value;
    void now;
});

// @ts-expect-error the effect receives a string, not a number
storeEffect(draft, selectText, (text: number) => { void text; });

class Editor extends AntiHookComponent<{draft: Carburetor<IDraft>}> {
    protected useEffects(): void {
        this.useStoreEffect('text', this.props.draft, selectText, this.showText);
        // @ts-expect-error the effect receives a string, not a number
        this.useStoreEffect('wrong', this.props.draft, selectText, this.showSize);
    }

    public render(): null {
        return null;
    }

    private showText(text: string): void {
        void text;
    }

    private showSize(size: number): void {
        void size;
    }
}

void [stopText, stopLength, Editor];
