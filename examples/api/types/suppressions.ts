// #region doc
import {AntiHookComponent} from 'react-carburetor';

class Counter extends AntiHookComponent {
    value = 0;

    // Intentional anti-pattern for demonstrating a narrow suppression.
    // carburetor-disable-next-line carburetor/require-method-for-closure
    increment = () => { this.value += 1; };
}
// #endregion doc

void Counter;
