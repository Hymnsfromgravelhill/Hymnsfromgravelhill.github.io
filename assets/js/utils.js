export const $ = (sel, el=document)=> el.querySelector(sel);
export const html = (strings, ...values) => strings.map((s,i)=> s + (values[i] ?? "") ).join("");
export const escapeHTML = (s='') => s.toString()
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#039;');

export const normalize = (s='') => s.toString()
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase();

// Decode common HTML entities used in hymnal TXT files.
let _decoder = null;
export const decodeEntities = (s='') => {
  if (!_decoder) _decoder = document.createElement('textarea');
  _decoder.innerHTML = s;
  return _decoder.value;
};
