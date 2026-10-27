// Test stand-in for the game's DataStoreCollection: the rows are what the
// test sets in _source, else what the test's lister (setTestChildren) gives
// for the bound context.
const source = { children: null };

export function setTestChildren(children) {
    source.children = children;
}

export class DataStoreCollection {
    constructor(context) {
        this._rows = null;
        this._onChange = { dispatch() {} };
        if (context) this.bindToContext(context);
    }

    get _source() {
        if (this._rows) return this._rows;
        return source.children && this._context ? source.children(this._context) : [];
    }

    set _source(rows) {
        this._rows = rows;
    }

    get source() {
        return this._source;
    }

    bindToContext(context) {
        this._context = context;
    }
}
