import {Carburetor, computed} from '@react-carburetor/core';

class CartCarburetor extends Carburetor<{items: string[]}> {}

const cart = new CartCarburetor({items: ['apple', 'pear']});

const items = computed((read) => read(cart).items);
const count = computed((read) => read(items).length);
const label = computed((read) => `${read(count)} item(s)`);

console.log(label.get()); // '2 item(s)'
cart.setData({items: ['apple', 'pear', 'plum']});
console.log(label.get()); // '3 item(s)'
