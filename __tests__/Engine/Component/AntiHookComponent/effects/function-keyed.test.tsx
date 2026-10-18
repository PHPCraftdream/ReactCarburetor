import * as React from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from "@/Carburetor";
import {act} from '../support';

interface IProps {
    interval: number;
}

const log: string[] = [];

beforeEach(() => {
    log.length = 0;
});

// Module-level effect functions: stable references, usable as their own keys.
const tick = (): (() => void) => {
    log.push('setup');

    return () => {
        log.push('cleanup');
    };
};

describe('<AntiHookComponent /> function-keyed effects', () => {
    test('a stable effect function keys its own effect', () => {
        interface ICfgProps {
            cfg: {interval: number};
        }

        class Ticker extends AntiHookComponent<ICfgProps> {
            protected useEffects(): void {
                this.useEffect(tick, [this.props.cfg.interval]);
            }

            render() {
                return <div/>;
            }
        }

        const ref = React.createRef<Ticker>();
        const {rerender, unmount} = render(<Ticker ref={ref} cfg={{interval: 1}}/>);

        expect(log).toEqual(['setup']);

        // Same deps: a forced pass over the props gate re-runs useEffects,
        // but the effect is neither re-run nor cleaned up.
        act(() => {
            ref.current!.forceUpdate();
        });

        expect(log).toEqual(['setup']);

        // Changed deps: the first run's cleanup runs before the second setup.
        rerender(<Ticker ref={ref} cfg={{interval: 2}}/>);

        expect(log).toEqual(['setup', 'cleanup', 'setup']);

        unmount();

        expect(log).toEqual(['setup', 'cleanup', 'setup', 'cleanup']);
    });

    test('two different effect functions do not collide', () => {
        let pulseSetups = 0;
        let pulseCleanups = 0;

        const pulse = (): (() => void) => {
            pulseSetups++;

            return () => {
                pulseCleanups++;
            };
        };

        class Duo extends AntiHookComponent<IProps> {
            protected useEffects(): void {
                this.useEffect(tick, [this.props.interval]);
                this.useEffect(pulse, [this.props.interval]);
            }

            render() {
                return <div/>;
            }
        }

        const {unmount} = render(<Duo interval={1}/>);

        expect(pulseSetups).toEqual(1);

        unmount();

        expect(log).toEqual(['setup', 'cleanup']);
        expect(pulseCleanups).toEqual(1);
    });
});
