/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load} from '../../../../harness/lib.mjs';

const {AntiHookComponent} = await load();
// V8 intrinsic syntax is parsed only by the flagged scenario child.
// oxlint-disable-next-line typescript/no-implied-eval
const hasFastProperties = new Function('value', 'return %HasFastProperties(value)');
const plain = {value: 7};
const dictionary = {value: 7, discarded: 0};
delete dictionary.discarded;
class Reader extends AntiHookComponent {
    render() {
        return this.props.value;
    }
}
const first = new Reader({value: 1});
const second = new Reader({value: 2});
const firstFast = hasFastProperties(first);
const secondFast = hasFastProperties(second);
const plainFast = hasFastProperties(plain);
const dictionaryFast = hasFastProperties(dictionary);
const done = first instanceof AntiHookComponent && second instanceof AntiHookComponent
    && first !== second && first.render() === 1 && second.render() === 2
    && plain.value === 7 && dictionary.value === 7 && !('discarded' in dictionary);
emit({firstFast, secondFast, plainFast, dictionaryFast, done});
