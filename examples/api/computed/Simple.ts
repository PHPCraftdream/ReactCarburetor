import {Carburetor, bind, computed} from '@react-carburetor/core';

class CartCarburetor extends Carburetor<{items: string[]}> {
    @bind
    add(item: string): void {
        this.draft.items.push(item);
        this.emitUpdate();
    }
}

const cart = new CartCarburetor({items: ['apple']});

const itemCount = computed((read) => read(cart).items.length);

console.log(itemCount.get()); // 1
cart.add('pear');
console.log(itemCount.get()); // 2 — the body reran because `items` moved
