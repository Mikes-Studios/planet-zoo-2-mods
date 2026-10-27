// The launcher dock's buttons by their label (hudlauncher.js roundButton's
// hover tip), so a button added to the dock moves none of the others.
export function dockButton(page, label) {
    return page.locator('.PZ2QoL_dockBtn', { has: page.locator('.PZ2QoL_dockTip', { hasText: label }) });
}
