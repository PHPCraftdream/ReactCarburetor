import {Carburetor, Computed} from '@react-carburetor/core';
import type {IComputed, IComputedOptions, TComputedReader, TComputeBody} from '@react-carburetor/core';

class CartCarburetor extends Carburetor<{items: string[]}> {}

const cart = new CartCarburetor({items: []});

const body: TComputeBody<string[]> = (read: TComputedReader) => [...read(cart).items];
const options: IComputedOptions<string[]> = {};
const snapshot: IComputed<string[]> = new Computed(body, options);

console.log(snapshot.get());
