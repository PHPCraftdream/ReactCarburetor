import {AntiHookComponent, Carburetor} from 'react-carburetor';

class Seen extends Carburetor<{seen: number}> {
    public markSeen(): void {
        this.draft.seen += 1;
        this.emitUpdate();
    }
}

const todoCarburetor = new Seen({seen: 0});

class Reader extends AntiHookComponent {
    public render() {
        const {seen} = this.useCarburetor(todoCarburetor);

        return <span>{seen}</span>;
    }
}

void Reader;

export class WrongWrite extends AntiHookComponent {
    // #region doc
    public render() {
        todoCarburetor.markSeen();       // writes and emits

        return <div/>;
    }
    // #endregion doc
}
