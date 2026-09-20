import { CarburetorContext } from "./CarburetorContext.mjs";
import * as __rspack_external_react from "react";
class CarburetorProvider extends __rspack_external_react.Component {
    render() {
        return /*#__PURE__*/ __rspack_external_react.createElement(CarburetorContext.Provider, {
            value: this.props.scope
        }, this.props.children);
    }
}
export { CarburetorProvider };
