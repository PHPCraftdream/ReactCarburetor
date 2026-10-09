/* oxlint-disable carburetor-internal/require-tsdoc */
import {emit, load, setupReact} from '../../harness/lib.mjs';
const {Carburetor, AntiHookComponent} = await load();
const {React, flushSync, root, container} = await setupReact();
class Users extends Carburetor {
    rename() { this.update(draft => { draft.name = 'Grace'; draft.initials = 'Gr'; }); }
}
const users = new Users({name: 'Ada', initials: 'Ad'});
let nameRenders = 0;
let avatarRenders = 0;
class Name extends AntiHookComponent {
    uid = 'u1';
    render() { nameRenders++; return React.createElement('b', null, this.useCarburetor(users).name); }
}
class Avatar extends AntiHookComponent {
    uid = 'u1';
    render() { avatarRenders++; return React.createElement('i', null, this.useCarburetor(users).initials); }
}
class Control extends AntiHookComponent {
    render() { return React.createElement('output', null, this.useCarburetor(users).name); }
}
class Empty extends AntiHookComponent { render() { return null; } }
const allowed = new Set(['props', 'context', 'refs', 'updater', 'state', 'render',
    '_reactInternals', '_reactInternalInstance']);
const ownNames = Object.getOwnPropertyNames(new Empty({})).filter(name => !allowed.has(name)).length;
flushSync(() => root.render(React.createElement('div', null,
    React.createElement(Name), React.createElement(Avatar), React.createElement(Control))));
const before = container.textContent;
flushSync(() => users.rename());
const after = container.textContent;
const pair = after.slice(0, -'Grace'.length);
const control = container.querySelector('output').textContent;
flushSync(() => root.unmount());
emit({ownNames, before, pair, control, nameRenders, avatarRenders,
    done: pair === 'GraceGr' && control === 'Grace' && ownNames === 0});
