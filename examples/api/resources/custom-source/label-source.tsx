// #region label-source
import {
    AntiHookComponent,
    Carburetor,
    EResourceStatus,
    IDict,
    IResourceResolution,
    IResourceSource,
    IResourceView,
} from '@react-carburetor/core';
import {type JSX} from 'react';

interface Label {
    id: string;
    text: string;
}

declare function fetchLabel(id: string): Promise<Label>;

interface ILabelEntry {
    status: EResourceStatus;
    value: Label | undefined;
}

interface ILabelSourceData {
    entries: IDict<ILabelEntry>;
}

export class LabelSource extends Carburetor<ILabelSourceData> implements IResourceSource<Label, [string]> {
    public constructor() {
        super({entries: {}});
    }

    public resolve(id: string): IResourceResolution<Label> {
        const entry = this.data.entries[id];
        // Derived flags must match status: exactly one is true.
        const status = entry?.status ?? EResourceStatus.Idle;
        const view: IResourceView<Label> = {
            status,
            isIdle: status === EResourceStatus.Idle,
            isPending: status === EResourceStatus.Pending,
            isSuccess: status === EResourceStatus.Success,
            isError: status === EResourceStatus.Error,
            data: entry?.value,
            error: undefined,
            updatedAt: undefined,
            refreshing: false,
            invalidated: false,
            failed: false,
            stale: entry === undefined,
        };
        return {key: id, path: `entries.${id}`, view};
    }

    public load(id: string): Promise<void> {
        this.draft.entries[id] = {status: EResourceStatus.Pending, value: undefined};
        this.emitUpdate();
        const settle = (status: EResourceStatus, value: Label | undefined): void => {
            this.draft.entries[id] = {status, value};
            this.emitUpdate();
        };
        return fetchLabel(id).then(
            (label: Label): void => settle(EResourceStatus.Success, label),
            (): void => settle(EResourceStatus.Error, undefined),
        );
    }
}

const labelSource = new LabelSource();

export class LabelChip extends AntiHookComponent<{labelId: string}> {
    render(): JSX.Element {
        const view = this.useResource(labelSource, this.props.labelId);
        if (view.isSuccess && view.data !== undefined) {
            return <span className="chip">{view.data.text}</span>;
        }
        return <span className="chip">{view.status}</span>;
    }
}
// #endregion label-source
void LabelChip;
