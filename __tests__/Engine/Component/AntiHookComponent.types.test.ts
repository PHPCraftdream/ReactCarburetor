import {AntiHookComponent, Carburetor} from '@/Carburetor';
import {TReadonly} from '@/Carburetor/Models/Base';

/**
 * Compile-time contract tests for the `connect()`/`connectSelection()` consumer API.
 *
 * These assertions are checked by `tsc --noEmit -p tsconfig.types.json`, which `npm run
 * typecheck` runs as a fourth pass — the main tsconfigs exclude test files by name, so without
 * that dedicated config nothing would ever type-check this file. rstest also executes it, but
 * SWC strips the types without checking them, so tsc is the only real checker here. That is
 * what makes every `// @ts-expect-error` below a real regression detector: an unsatisfied
 * directive is itself TS2578, so if the guarded mistake stops being a compile error the run
 * fails instead of silently keeping a dead assertion.
 */

interface IProfileData {
    name: string;
    age: number;
    nickname?: string;
    tags: string[];
    address: {city: string; zip?: string};
}

class ProfileStore extends Carburetor<IProfileData> {
    public rename = (next: string): void => {
        this.draft.name = next;

        this.emitUpdate();
    };
}

const store = new ProfileStore({name: 'Ann', age: 30, tags: ['a'], address: {city: 'X'}});

class DirectStoreForm extends AntiHookComponent {
    private readonly view = this.connect(store);

    // Public on purpose: the compile-error block below reads the view through a method rather
    // than subscripting a private member off an instance, which TypeScript does not allow.
    public exposeView(): TReadonly<IProfileData> {
        return this.view;
    }

    // The probes pin inferred types by annotation, the way peek() pins a selection in
    // AntiHookComponent.test.tsx: if inference ever widened to `any` or lost readonly, one of
    // these returns would stop compiling.
    public pinsDirect(): TReadonly<IProfileData> {
        return this.view;
    }

    public readsLeaf(): string {
        return this.view.name;
    }

    public readsNested(): string {
        return this.view.address.city;
    }

    public readsArrayElement(): string {
        return this.view.tags[0];
    }

    public readsOptional(): string | undefined {
        return this.view.nickname;
    }

    public readsOptionalNested(): string | undefined {
        return this.view.address.zip;
    }
}

class ResolverForm extends AntiHookComponent {
    private readonly viaResolver = this.connect(() => store);

    public pinsResolver(): TReadonly<IProfileData> {
        return this.viaResolver;
    }
}

class SelectionForm extends AntiHookComponent {
    // The selector's `data` parameter is inferred as the deep-readonly store data with no
    // annotation anywhere; the snapshot pin below proves the inferred shape survived.
    private readonly title = this.connectSelection(store, (data) => ({
        name: data.name,
        upper: data.nickname?.toUpperCase() ?? ''
    }));

    public pinsSnapshot(): {name: string; upper: string} {
        return this.title();
    }
}

// Never instantiated: these declarations exist to fail compilation, and running their
// initializers would only prove connect() survives garbage at runtime, which it need not.
// The mention below reads as a use to the linter, keeping the class from being mistaken
// for dead code while it stays as uninstantiated as its initializers demand.
class InvalidConsumerAccess extends AntiHookComponent {
    // @ts-expect-error connect() reads a carburetor, not a bare object
    private readonly notAStore = this.connect({noData: true});

    // @ts-expect-error the resolver form must resolve to a carburetor as well
    private readonly notAStoreEither = this.connect(() => 42);

    // @ts-expect-error a selector may only read fields the store data actually has
    private readonly missing = this.connectSelection(store, (data) => data.nonexistent);
}

void InvalidConsumerAccess;

/**
 * Everything tsc must reject, in one block. The function is never called at import time —
 * its first three assertions are writes the facade throws on — and the runtime test below
 * exercises exactly that throw, so both halves of the read-only contract stay honest.
 */
const compileAssertions = (): void => {
    const view: TReadonly<IProfileData> = new DirectStoreForm({} as never).exposeView();

    // @ts-expect-error a leaf write is a compile error, not just a runtime throw
    view.name = 'Bob';

    // @ts-expect-error the readonly mapping is deep: nested values are read-only too
    view.address.city = 'Y';

    // @ts-expect-error arrays come back as ReadonlyArray, so push is not on the type
    view.tags.push('b');

    // @ts-expect-error inference is real, not `any`: a number cannot fill a string pin
    const notAny: string = view.age;

    // @ts-expect-error an optional property stays `string | undefined` through the mapping
    const required: string = view.nickname;

    // The two pins above are reads for tsc alone; this keeps them from reading like code
    // someone forgot to use.
    void notAny;
    void required;
};

describe('connect()/connectSelection() type contracts', () => {
    test('the connect() view contract holds at runtime alongside the compile-time assertions', () => {
        const component = new DirectStoreForm({} as never);
        const view = component.exposeView();

        expect(view.name).toEqual('Ann');
        expect(view.nickname).toBeUndefined();

        // The resolver form resolves outside a render attempt the same way, and the
        // selection's unannotated selector still produces its pinned snapshot shape.
        expect(new ResolverForm({} as never).pinsResolver().name).toEqual('Ann');
        expect(new SelectionForm({} as never).pinsSnapshot()).toEqual({name: 'Ann', upper: ''});

        // The facade rejects writes at runtime, and the @ts-expect-error block pins the same
        // contract at compile time. The write is spelled through a cast here, the way the
        // mutation-rejection tests in AntiHookComponent.test.tsx do, because the uncast form
        // is not even a legal statement once tsc is watching this file.
        expect(() => {
            (view as {name: string}).name = 'Bob';
        }).toThrow('read-only');

        // A rejected write must not have landed in the store.
        expect(store.getData().name).toEqual('Ann');

        // compileAssertions runs until its first write and stops on the facade's rejection:
        // the compile-only block and the runtime facade are guarding the same contract.
        expect(compileAssertions).toThrow('read-only');
    });
});
