import {useMemo} from "react";
import {useCarburetorValue} from "@react-carburetor/core/interop";
import {Carburetor} from "@react-carburetor/core";

type TState = {count: number; label: string};
const selectState = (value: TState): TState => value;

export function FunctionComponentCorpus({prefix, store}: {prefix: string; store: Carburetor<TState>}) {
    const state = useCarburetorValue(store, selectState);
    const onActivate = () => console.log(prefix, state.count);
    const local = () => state.count;
    const memoized = useMemo(() => () => state.count, [state.count]);
    const selected = useCarburetorValue(store, value => value.label + prefix);
    return <Child onActivate={() => console.log(prefix)} source={onActivate} renderCount={local} memoized={memoized} selected={selected} />;
}

function Child(props: {onActivate(): void; source(): void; renderCount(): number; memoized(): number; selected: string}) {
    return <button onClick={props.onActivate}>{props.selected}</button>;
}

export function StoreMemoCorpus({store}: {store: Carburetor<TState>}) {
    const count = useCarburetorValue(store, value => value.count);
    const derived = useMemo(() => count + 1, [count]);
    return <span>{derived}</span>;
}
