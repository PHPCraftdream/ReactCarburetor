// #region raw-writes
import {Carburetor, IDict} from 'react-carburetor';

interface IUser {name: string}

class UserStore extends Carburetor<IDict<IUser>> {
    /** Replaces an entry's object wholesale through a raw reference from the server. */
    public replaceRaw(id: string, user: IUser): void {
        this.draft[id] = {name: 'written through draft'};
        // A write made outside draft does not record a path; publish it deliberately.
        // carburetor-disable-next-line carburetor/no-external-data-mutation -- raw write, published by markAllChanged()
        this.getData()[id].name = user.name;
        this.markAllChanged();
        this.emitUpdate();
    }
}

const store = new UserStore({u1: {name: 'ada'}});
store.replaceRaw('u1', {name: 'grace'});
console.log(store.getData().u1.name); // 'grace'
// #endregion raw-writes
