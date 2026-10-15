import {Carburetor, computed, shallowEqual} from 'react-carburetor';

class CartCarburetor extends Carburetor<{items: string[]}> {}

const cart = new CartCarburetor({items: ['apple']});

const items = computed((read) => [...read(cart).items], {equals: shallowEqual});

const before = items.get();
cart.setData({items: ['apple']});           // new array, same content
console.log(items.get() === before);        // true — the cached result was kept
