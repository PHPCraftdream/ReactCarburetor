/* oxlint-disable carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';
const {Carburetor, computed} = await load();
class DocumentStore extends Carburetor {
    version = 0;
    save(title) {
        this.update(draft => { draft.title = title; });
        this.version = 7;
    }
}
class Profile extends Carburetor {
    uid = 'profile';
    rename(name) { this.update(draft => { draft.name = name; }); }
}
const document = new DocumentStore({title: 'a'});
const upper = computed(read => read(document).title.toUpperCase());
const titles = [upper.get()];
let directDeliveries = 0;
const directId = document.subscribe(() => { directDeliveries++; });
for (const title of ['b', 'c', 'd']) {
    document.save(title);
    titles.push(upper.get());
}
const me = new Profile({name: 'me'});
const friend = new Profile({name: 'friend'});
const pair = computed(read => `${read(me).name} & ${read(friend).name}`);
const delivered = [];
const id = pair.subscribe(() => delivered.push(pair.get()));
const initialPair = pair.get();
friend.rename('friend2');
const finalPair = pair.get();
pair.unsubscribe(id);
document.unsubscribe(directId);
emit({
    titles: titles.join(','), version: document.getVersion(), directDeliveries,
    initialPair, finalPair, deliveries: delivered.length, delivered: delivered.join(','),
    domainVersion: document.version, domainUIDsEqual: me.uid === friend.uid,
    done: document.getData().title === 'd' && friend.getData().name === 'friend2',
});
