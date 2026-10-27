// Test stand-in for the game's DataStore: rows the test puts in, by context,
// else what the test's reader (setTestReader) says.
const rows = new Map();
const keyOf = context => context.join('/');
const source = { read: null };

export function setTestRow(context, values) {
    rows.set(keyOf(context), Object.assign({}, rows.get(keyOf(context)), values));
}

// read(context, property): a fake game that works the values out itself (tests/listerpage.js)
export function setTestReader(read) {
    source.read = read;
}

export function getValue(context, property) {
    const row = rows.get(keyOf(context));
    if (row) return row[property];
    return source.read ? source.read(context, property) : undefined;
}

// like the game's own DataStoreJSImpl: a context that is gone throws here, not in getValue
export function getValues(context, properties) {
    if (!rows.has(keyOf(context))) throw new TypeError(`no data for ${keyOf(context)}`);
    const out = {};
    for (const property of properties) out[property] = getValue(context, property);
    return out;
}

export function setValue(context, property, value) {
    setTestRow(context, { [property]: value });
}
