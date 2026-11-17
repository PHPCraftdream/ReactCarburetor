import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {AntiHookComponent, Carburetor, computed} from "@/Carburetor";

interface ISettings {theme: string; lang: string; size: number}

const setTheme = (draft: ISettings, theme: string): void => { draft.theme = theme; };
const setLang = (draft: ISettings, lang: string): void => { draft.lang = lang; };

class Settings extends Carburetor<ISettings> {
    public paint(theme: string): void { this.update(setTheme, theme); }
    public speak(lang: string): void { this.update(setLang, lang); }
}

const selectTheme = (data: ISettings): string => data.theme;

const newSettings = (): Settings => new Settings({theme: 'light', lang: 'en', size: 1});

describe('useStoreEffect', () => {
    test('runs after mount with the current value, then on each change, without a render reading it', () => {
        const settings = newSettings();
        const runs: Array<[string, string | undefined]> = [];
        let renders = 0;
        const applyTheme = (theme: string, previous: string | undefined): void => {
            runs.push([theme, previous]);
        };

        class App extends AntiHookComponent {
            protected useEffects(): void {
                this.useStoreEffect('theme', settings, selectTheme, applyTheme);
            }

            public render() {
                renders++;

                return <div/>;
            }
        }

        render(<App/>);
        act(() => { settings.paint('dark'); });
        act(() => { settings.speak('he'); });
        act(() => { settings.paint('sepia'); });

        expect(runs).toEqual([['light', undefined], ['dark', 'light'], ['sepia', 'dark']]);
        expect(renders).toBe(1);
    });

    test('a run\'s cleanup runs before the next run and on unmount, and unmount stops the watch', () => {
        const settings = newSettings();
        const log: string[] = [];
        const applyTheme = (theme: string): (() => void) => {
            log.push(`set ${theme}`);

            return () => { log.push(`unset ${theme}`); };
        };

        class App extends AntiHookComponent {
            protected useEffects(): void {
                this.useStoreEffect('theme', settings, selectTheme, applyTheme);
            }

            public render() {
                return <div/>;
            }
        }

        const view = render(<App/>);

        act(() => { settings.paint('dark'); });
        view.unmount();
        act(() => { settings.paint('sepia'); });

        expect(log).toEqual(['set light', 'unset light', 'set dark', 'unset dark']);
    });

    test('a computed over several stores is followed the same way', () => {
        const settings = newSettings();
        const other = newSettings();
        const label = computed(read => `${read(settings).theme}/${read(other).lang}`);
        const runs: string[] = [];
        const show = (value: string): void => { runs.push(value); };

        class App extends AntiHookComponent {
            protected useEffects(): void {
                this.useStoreEffect('label', label, show);
            }

            public render() {
                return <div/>;
            }
        }

        const view = render(<App/>);

        act(() => { other.speak('he'); });
        act(() => { settings.speak('fr'); });
        act(() => { settings.paint('dark'); });
        view.unmount();

        expect(runs).toEqual(['light/en', 'light/he', 'dark/he']);
    });

    test('in StrictMode one watch stays live after the replayed mount', () => {
        const settings = newSettings();
        const runs: string[] = [];
        const applyTheme = (theme: string): void => { runs.push(theme); };

        class App extends AntiHookComponent {
            protected useEffects(): void {
                this.useStoreEffect('theme', settings, selectTheme, applyTheme);
            }

            public render() {
                return <div/>;
            }
        }

        render(<React.StrictMode><App/></React.StrictMode>);
        runs.length = 0;
        act(() => { settings.paint('dark'); });

        expect(runs).toEqual(['dark']);
    });

    test('a new store in props cleans up the old run and follows the new store only', () => {
        const first = newSettings();
        const second = new Settings({theme: 'dark', lang: 'en', size: 1});
        const log: string[] = [];
        const applyTheme = (theme: string): (() => void) => {
            log.push(`set ${theme}`);

            return () => { log.push(`unset ${theme}`); };
        };

        class App extends AntiHookComponent<{settings: Settings}> {
            protected useEffects(): void {
                this.useStoreEffect('theme', this.props.settings, selectTheme, applyTheme);
            }

            public render() {
                return <div/>;
            }
        }

        const view = render(<App settings={first}/>);

        view.rerender(<App settings={second}/>);
        act(() => { first.paint('sepia'); });
        act(() => { second.paint('blue'); });
        view.unmount();

        expect(log).toEqual(['set light', 'unset light', 'set dark', 'unset dark', 'set blue', 'unset blue']);
    });

    test('a server render runs no store effect', () => {
        const settings = newSettings();
        const runs: string[] = [];
        const applyTheme = (theme: string): void => { runs.push(theme); };

        class App extends AntiHookComponent {
            protected useEffects(): void {
                this.useStoreEffect('theme', settings, selectTheme, applyTheme);
            }

            public render() {
                return <div>page</div>;
            }
        }

        expect(renderToString(<App/>)).toContain('page');
        act(() => { settings.paint('dark'); });
        expect(runs).toEqual([]);
    });

    test('re-renders with the same arguments keep one watch and one run', () => {
        const settings = newSettings();
        const runs: string[] = [];
        const applyTheme = (theme: string): void => { runs.push(theme); };

        class App extends AntiHookComponent<{tick: number}> {
            protected useEffects(): void {
                this.useStoreEffect('theme', settings, selectTheme, applyTheme);
            }

            public render() {
                return <div>{this.props.tick}</div>;
            }
        }

        const view = render(<App tick={0}/>);

        view.rerender(<App tick={1}/>);
        view.rerender(<App tick={2}/>);
        act(() => { settings.paint('dark'); });
        view.unmount();

        expect(runs).toEqual(['light', 'dark']);
    });
});
