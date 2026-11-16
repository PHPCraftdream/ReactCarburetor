import {AppComponent} from './AppComponent';
import {settingsToken} from './settings';

// AppComponent is the project's own base, imported from another file and not listed in
// componentBases: the linter cannot tell Screen is a component, so no rule checks it.
export class Screen extends AppComponent {
    public render() {
        const {theme} = this.useCarburetor(this.resolve(settingsToken));
        return <main data-theme={theme}/>;
    }
}
