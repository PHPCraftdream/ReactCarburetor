// The props gate (shouldComponentUpdate) skips a child whose props are shallow-equal, so a
// parent that mutates an object in place and re-renders does not reach the child. A child that
// replaces the gate with `return true` follows every parent render.
import * as React from 'react';
import {render} from '@testing-library/react';
import {act} from 'react';
import {AntiHookComponent} from '@/Carburetor';

interface IPanelProps {
    shape: {strokes: number};
}

let gatedRenders = 0;
let openRenders = 0;

class GatedPanel extends AntiHookComponent<IPanelProps> {
    public render() {
        gatedRenders++;
        return <span data-testid="gated">{this.props.shape.strokes}</span>;
    }
}

class OpenPanel extends AntiHookComponent<IPanelProps> {
    public shouldComponentUpdate(): boolean {
        return true;
    }

    public render() {
        openRenders++;
        return <span data-testid="open">{this.props.shape.strokes}</span>;
    }
}

class Board extends React.Component {
    private readonly shape = {strokes: 0};

    public draw(): void {
        this.shape.strokes++;
        this.forceUpdate();
    }

    public render() {
        return <div><GatedPanel shape={this.shape}/><OpenPanel shape={this.shape}/></div>;
    }
}

describe('props gate on AntiHookComponent', () => {
    test('an in-place mutation reaches only the child that replaces the gate', () => {
        gatedRenders = 0;
        openRenders = 0;
        const board = React.createRef<Board>();
        const view = render(<Board ref={board}/>);
        try {
            act(() => { board.current!.draw(); });
            expect(view.getByTestId('open').textContent).toBe('1');
            expect(view.getByTestId('gated').textContent).toBe('0');
            expect(openRenders).toBe(2);
            expect(gatedRenders).toBe(1);
        } finally { view.unmount(); }
    });
});
