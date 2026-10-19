/** Check the flags a native definition would leave behind, including new-key defaults.
 *
 * @param descriptor - the requested definition.
 * @param existing - the current own property, if present.
 */
export const isOpaqueDescriptor = (descriptor: PropertyDescriptor, existing?: PropertyDescriptor): boolean =>
    'get' in descriptor || 'set' in descriptor
    || (descriptor.configurable ?? existing?.configurable) !== true
    || (descriptor.writable ?? existing?.writable) !== true
    || (descriptor.enumerable ?? existing?.enumerable) !== true;
