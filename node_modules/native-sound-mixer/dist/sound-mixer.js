"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceType = exports.AudioSessionState = void 0;
var os = __importStar(require("os"));
var sMixerModule = (function () {
    var getModule = function (platform, arch) {
        if (arch === void 0) { arch = undefined; }
        var archString = arch ? "_".concat(arch) : "";
        var path = "".concat(__dirname, "/addons/").concat(platform, "-sound-mixer").concat(archString, ".node");
        /* eslint-disable */
        var res = require(path);
        /* eslint-enable */
        return res;
    };
    var platform = os.platform();
    var arch = os.arch();
    if (platform === "win32") {
        if (arch === "x32" || arch === "x64" || arch === "ia32") {
            return getModule("win");
        }
    }
    else if (platform == "linux") {
        if (arch === "x32" || arch === "x64" || arch === "ia32")
            return getModule("linux");
    }
    throw new Error("could not get the binary file");
})();
/**
 *  An enum giving the state of an {@link AudioSession}
 *  @enum
 */
var AudioSessionState;
(function (AudioSessionState) {
    AudioSessionState[AudioSessionState["INACTIVE"] = 0] = "INACTIVE";
    AudioSessionState[AudioSessionState["ACTIVE"] = 1] = "ACTIVE";
    AudioSessionState[AudioSessionState["EXPIRED"] = 2] = "EXPIRED";
})(AudioSessionState = exports.AudioSessionState || (exports.AudioSessionState = {}));
/**
 *  An enum giving the type of {@link Device}, it can be either `input` or
 *  `output`.
 *  @enum
 */
var DeviceType;
(function (DeviceType) {
    /**
     *  Input mode.
     */
    DeviceType[DeviceType["CAPTURE"] = 1] = "CAPTURE";
    /**
     *  Output mode.
     */
    DeviceType[DeviceType["RENDER"] = 0] = "RENDER";
})(DeviceType = exports.DeviceType || (exports.DeviceType = {}));
/**
 *  The actual {@link SoundMixer} object.
 */
var soundMixer = sMixerModule.SoundMixer;
exports.default = soundMixer;
//# sourceMappingURL=sound-mixer.js.map