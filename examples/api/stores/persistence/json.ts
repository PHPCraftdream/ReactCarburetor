// #region json
import {Carburetor, IInspectable} from 'react-carburetor';

const store = new Carburetor({value: 1});

const wire: IInspectable = store; // the tooling surface: JSON in and out, no data type

const saved: unknown = wire.toJSON();
console.log(JSON.stringify(saved)); // '{"value":1}'

wire.fromJSON(JSON.parse('{"value":42}'));
console.log(store.getData().value); // 42
// #endregion json
