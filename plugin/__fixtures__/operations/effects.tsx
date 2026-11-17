import {AntiHookComponent, Carburetor} from "@react-carburetor/core";
import {resource} from "./sources";

/**
 * Fixture for the end-to-end host check: every rule in the effects group must fire exactly once
 * here. This file is linted by a test, not by `npm run lint`.
 */
export class Row extends AntiHookComponent<{url: string; interval: number}> {
    protected useEffects(): void {
        // no-async-effect
        this.useEffect('load', async () => {
            await resource.load();
        }, []);

        // require-effect-deps
        this.useEffect('connect', () => connect(this.props.url), []);

        this.useEffect('timer', () => startTimer(this.props.interval), [this.props.interval]);

        // no-duplicate-effect-name
        this.useEffect('timer', () => stopTimer(), []);
    }

    public render() {
        return <span>{this.props.url}</span>;
    }
}

const saveDraft = (): void => undefined;

class DraftSaver extends AntiHookComponent<{draft: {getData(): {text: string}}}> {
    protected useEffects(): void {
        // no-store-read-in-effect-deps
        this.useEffect('save', saveDraft, [this.props.draft.getData().text]);
    }

    public render() {
        return <span/>;
    }
}

void DraftSaver;

const selectText = (data: {text: string}): string => data.text;

class StoreEffects extends AntiHookComponent<{draft: Carburetor<{text: string}>}> {
    protected useEffects(): void {
        // no-inline-store-effect
        this.useStoreEffect('storeSave', this.props.draft, selectText, this.save.bind(this));

        // prefer-store-effect
        this.useEffect('storeWatch', () => this.props.draft.watch(selectText, saveDraft), [this.props.draft]);
    }

    public render() {
        return <span/>;
    }

    private save(): void {
        saveDraft();
    }
}

void StoreEffects;
