import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopPageTimers } from './fakepage.js';
import { loadPages } from './pageloader.js';

loadPages();
stopPageTimers();
const { gameAbove } = await import('/js/mods/pz2qol/stepaside.js');

// a node of a tiny tree: parentElement, contains, a box
function node(className, parent = null) {
    const n = { className, parentElement: parent, kids: [] };
    if (parent) parent.kids.push(n);
    // Gameface's Node.contains says no for a screen's own rows
    n.contains = () => false;
    n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
    return n;
}

test('a game window over a toolbar is found without its name; the toolbar\'s own screen is not', () => {
    const page = node('Page');
    const screen = node('ManagementAnimals_root', page);
    const row = node('ListRow', screen);
    const bar = node('PZ2QoL_bar zoo');
    const popup = node('SomeGameWindow_root', page);
    let under = [bar, row, screen, page];
    document.body = node('body');
    document.elementsFromPoint = () => under;
    assert.equal(gameAbove(bar, screen), null, 'only its screen and the page under it');
    under = [bar, popup, row, screen, page];
    assert.equal(gameAbove(bar, screen), popup);
    assert.equal(gameAbove(bar, null), null, 'a widget on no screen is left to the named covers');
    const copy = node('ManagementAnimals_root', page);
    under = [bar, node('ListRow', copy), copy, page];
    assert.equal(gameAbove(bar, screen), null, 'another copy of its own screen is no cover');
    delete document.elementsFromPoint;
});
