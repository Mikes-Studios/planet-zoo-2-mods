// What the Education bar says, from the park's report (pz2qol.education.lua):
// { need, spare, species: [{ id, placed, missing: [{ i, name }], locked }] }.
// need is the game's fully-educated count (its Species tab's x/5): a species
// with that many topics placed is covered, its other topics don't matter.
// names: { species(id), topic(locString) } -> the game's words.

export function educationRows(report, names) {
    const need = report && report.need > 0 ? report.need : null;
    const rows = (report && Array.isArray(report.species) ? report.species : []).map(s => {
        const missing = (s.missing || []).map(t => names.topic(t.name));
        const done = need != null ? s.placed >= need : missing.length === 0;
        const parts = [need != null
            ? `${names.species(s.id)}: ${need} topics needed, ${s.placed} placed`
            : `${names.species(s.id)}: ${s.placed} topic${s.placed === 1 ? '' : 's'} placed`];
        if (!done && missing.length) parts.push(`not placed: ${missing.join(', ')}`);
        if (!done && s.locked) parts.push(`${s.locked} more after research`);
        return { id: s.id, done, text: parts.join(' · ') };
    });
    return rows.sort((a, b) => a.done - b.done || a.text.localeCompare(b.text));
}

export function missingCount(report) {
    return educationRows(report, { species: String, topic: String }).filter(r => !r.done).length;
}

export function fillSummary(result) {
    const set = result && Array.isArray(result.assigned) ? result.assigned.length : 0;
    const left = missingCount(result && result.report);
    if (set === 0 && left === 0) return 'Every species has the topics it needs placed.';
    if (set === 0) return 'No prop could take a missing topic: place another board or speaker for each species still short.';
    const done = `Set ${set} prop${set === 1 ? '' : 's'} to a missing topic.`;
    return left ? `${done} Place more boards or speakers for the species still short.` : done;
}
