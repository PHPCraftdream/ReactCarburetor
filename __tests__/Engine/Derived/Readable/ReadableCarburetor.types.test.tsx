import * as React from 'react';
import {AntiHookComponent, Carburetor, computed, IReadableCarburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {ReadableAdapter} from './ReadableAdapter';

interface IData {
    count: number;
    label: string;
}

interface IProps {
    source: IReadableCarburetor<IData>;
}

class ReadableClassConsumer extends AntiHookComponent<IProps> {
    private readonly connected = this.connect(() => this.props.source);
    private readonly selected = this.connectSelection(
        () => this.props.source,
        (data) => ({label: data.label, count: data.count})
    );

    public render(): React.ReactElement {
        const tracked = this.useCarburetor(this.props.source);
        const connectedLabel: string = this.connected.label;
        const selectedCount: number = this.selected().count;
        const trackedCount: number = tracked.count;

        return <output>{`${connectedLabel}:${selectedCount}:${trackedCount}`}</output>;
    }
}

const ReadableHookConsumer = ({source}: IProps): React.ReactElement => {
    const hookCount: number = useCarburetorValue(source, (data) => data.count);
    return <output>{hookCount}</output>;
};

const assertPublicTypes = (source: IReadableCarburetor<IData>): void => {
    const computedLabel: string = computed((read) => read(source).label).get();
    const rawData: IData = source.getData();
    const trackedLabel: string = source.read(() => {}).label;

    // @ts-expect-error read-only sources do not expose mutation
    source.setData({count: 2, label: 'changed'});
    // @ts-expect-error read-only sources do not expose restore tooling
    source.restore({count: 2, label: 'changed'});
    // @ts-expect-error read-only sources do not expose snapshots
    source.snapshot();
    // @ts-expect-error read-only sources do not expose serialization tooling
    source.toJSON();
    // @ts-expect-error read-only sources do not expose hydration tooling
    source.fromJSON({count: 2, label: 'changed'});

    void ReadableHookConsumer;
    void computedLabel;
    void rawData;
    void trackedLabel;
};

void ReadableClassConsumer;
void assertPublicTypes;

describe('IReadableCarburetor public type contract', () => {
    test('exports the read-only capability and leaves getData raw', () => {
        const source = new ReadableAdapter<IData>({count: 1, label: 'before'});
        const raw: IData = source.getData();
        raw.count = 2;

        expect(source.getData().count).toEqual(2);
        expect(source.read(() => {}).label).toEqual('before');

        const legacy = new Carburetor<IData>({count: 3, label: 'native'});
        const readable: IReadableCarburetor<IData> = legacy;
        expect(readable.getData().label).toEqual('native');
    });
});
