import {Carburetor} from '@/Carburetor';

/** Compile-time readonly getter and ordinary-name subclass contract. */
class Contract extends Carburetor<{n: number}> {
    public uid = 'domain';
    public version = 7;
    public scheduler = 'domain';
    public writes = 'domain';
    public commitState = 'domain';
    /** The documented getter cannot be assigned or redeclared as a field. */
    public invalidReplacement(): void {
        // @ts-expect-error data is a getter without a setter
        this.data = {n: 1};
    }
    /** Reads remain available to subclasses. */
    public current(): number { return this.data.n; }
}

class InvalidDataField extends Carburetor<{n: number}> {
    // @ts-expect-error the documented accessor is the exception to ordinary-name freedom
    public data = {n: 1};
}
void Contract;
void InvalidDataField;
