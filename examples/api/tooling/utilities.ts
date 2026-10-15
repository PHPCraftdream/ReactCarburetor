import {bind, shallowEqual} from 'react-carburetor';

class Input {value = 0; @bind increment(): void { this.value += 1; }}
const input = new Input();
input.increment();
const equal = shallowEqual({value: input.value}, {value: 1});
void equal;
