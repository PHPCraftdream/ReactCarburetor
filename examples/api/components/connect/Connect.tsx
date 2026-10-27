// #region doc
import {AntiHookComponent, Carburetor} from '@react-carburetor/core';

interface IGreetingData {
    name: string;
}

const greeting = new Carburetor<IGreetingData>({name: 'Ada'});

class Greeting extends AntiHookComponent {
    private readonly data = this.connect(greeting);

    public render() {
        return <span>Hello, {this.data.name}</span>;
    }
}
// #endregion doc

void Greeting;
