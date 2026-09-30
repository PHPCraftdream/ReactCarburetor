import {Carburetor, ISubscribeOptions, ResourceCache, TSubscriber} from "@/Carburetor";
import {getTestData, ITestData, readsOf} from "./fixtures";

describe('Carburetor member overrides', () => {
    test('a subclass preEmit() method runs before notification', () => {
        class DerivedCarburetor extends Carburetor<ITestData & {total: number}> {
            public push = (n: number) => {
                this.update((draft) => {
                    draft.a += n;
                });
            };

            protected preEmit(): void {
                this.draft.total = this.data.a + this.data.b;
            }
        }

        const store = new DerivedCarburetor({...getTestData(), total: 0});
        let notifiedTotal: number | undefined;

        store.subscribe(() => {
            notifiedTotal = store.getData().total;
        }, {id: 'listener', reads: readsOf('total')});

        store.push(5);

        expect(store.getData().total).toEqual(5);
        expect(notifiedTotal).toEqual(5);
    });

    test('a subclass subscribe() method override runs and super.subscribe still works', () => {
        class LoggingCarburetor extends Carburetor<ITestData> {
            public log: string[] = [];

            public subscribe(callback: TSubscriber, options?: ISubscribeOptions): string {
                this.log.push('subscribe');

                return super.subscribe(callback, options);
            }

            public setA = (a: number) => {
                this.draft.a = a;
                this.emitUpdate();
            };
        }

        const store = new LoggingCarburetor(getTestData());
        let calls = 0;

        store.subscribe(() => calls++, {id: 'listener', reads: readsOf('a')});

        expect(store.log).toEqual(['subscribe']);

        store.setA(1);
        expect(calls).toEqual(1);
    });

    test('a ResourceCache subclass preEmit() method override runs on every emit', async () => {
        class LoggingCache extends ResourceCache<string, string> {
            public preEmitCalls: number = 0;

            protected preEmit(): void {
                this.preEmitCalls++;
            }
        }

        const cache = new LoggingCache((_args: string, _signal: AbortSignal) => Promise.resolve('value'));

        void cache.load('key');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(cache.preEmitCalls).toBeGreaterThan(0);
        expect(cache.getEntry('key').data).toEqual('value');
    });

    test('a subclass preEmit field-syntax override still works', () => {
        class FieldOverrideCarburetor extends Carburetor<{n: number; doubled: number}> {
            public setN = (n: number) => {
                this.update((draft) => {
                    draft.n = n;
                });
            };

            protected preEmit = (): void => {
                this.draft.doubled = this.data.n * 2;
            };
        }

        const store = new FieldOverrideCarburetor({n: 0, doubled: 0});

        store.setN(3);

        expect(store.getData().doubled).toEqual(6);
    });
});
