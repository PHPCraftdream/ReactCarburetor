import { IS_DEVELOPMENT } from "../Utils/DevelopmentFlag.mjs";
class Diagnostics {
    enabled = IS_DEVELOPMENT;
    isEnabled = ()=>this.enabled;
    setEnabled = (enabled)=>{
        this.enabled = enabled;
    };
    report = (message)=>{
        if (!this.enabled) return;
        console.error('Carburetor: ' + message);
    };
}
export { Diagnostics };
