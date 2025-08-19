import "react-native-url-polyfill";
import "react-native-get-random-values";
import "fast-text-encoding";

(() => {
  const g = typeof globalThis !== "undefined" ? globalThis : global;

  if (typeof g.btoa === "undefined") {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    g.btoa = function (input = "") {
      let str = String(input);
      let output = "";
      for (let block = 0, charCode, i = 0, map = chars;
           str.charAt(i | 0) || ((map = "="), i % 1);
           output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))) {
        charCode = str.charCodeAt((i += 3 / 4));
        if (charCode > 0xff) throw new Error("btoa: input fuori range Latin1.");
        block = (block << 8) | charCode;
      }
      return output;
    };
  }

  if (typeof g.atob === "undefined") {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    g.atob = function (input = "") {
      let str = String(input).replace(/=+$/, "");
      let output = "";
      if (str.length % 4 === 1) throw new Error("atob: base64 non valida.");
      for (let bc = 0, bs = 0, buffer, i = 0;
           (buffer = str.charAt(i++));
           ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
             ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
             : 0) {
        buffer = chars.indexOf(buffer);
      }
      return output;
    };
  }
})();
