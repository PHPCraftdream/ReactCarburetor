const ownEnumerableKeys = (value)=>Reflect.ownKeys(value).filter((key)=>Object.prototype.propertyIsEnumerable.call(value, key));
export { ownEnumerableKeys };
