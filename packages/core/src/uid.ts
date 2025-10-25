export function nanoid(size = 12) {
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
let id = "";
crypto.getRandomValues(new Uint8Array(size)).forEach(n => { id += alphabet[n % alphabet.length]; });
return id;
}
