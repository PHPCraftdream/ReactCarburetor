import React, {useState as state, use} from 'react';

export function Counter() {
    const [value] = state(0);
    return <p>{value}</p>;
}

export const Memo = React.memo(() => {
    React.useRef(null);
    return <p/>;
});

export function Reader({promise}) {
    return <p>{use(promise)}</p>;
}

export function Shadow({state}) {
    return <p>{state(0)}</p>;
}

export class Plain extends React.Component {
    render() { return <p/>; }
}
