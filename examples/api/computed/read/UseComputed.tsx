// #region doc
import {AntiHookComponent, Carburetor, bind, computed} from 'react-carburetor';

class CartCarburetor extends Carburetor<{items: string[]}> {
    @bind
    add(item: string): void {
        this.draft.items.push(item);
        this.emitUpdate();
    }
}

const cart = new CartCarburetor({items: []});
const itemCount = computed((read) => read(cart).items.length);

class CartControls extends AntiHookComponent {
    @bind
    private addOne(): void {
        cart.add('plum');
    }

    public render() {
        const count = this.useComputed(itemCount);

        return (
            <span data-testid="badge">
                {count} item(s)
                <button onClick={this.addOne}>add</button>
            </span>
        );
    }
}
// #endregion doc

void CartControls;
