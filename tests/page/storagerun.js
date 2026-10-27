// A fake game for the storage runs (runPlacement, runTradeArrivals): a
// virtual clock, facts per animal, and a count of what the run asked.
export function fakeGame({ facts, move = () => ({ ok: true }), stopOnMove = false }) {
    const game = { clock: 0, stopping: false, factsCalls: 0, factsAfterStop: 0, moves: [] };
    game.deps = {
        now: () => game.clock,
        facts: async id => {
            game.factsCalls++;
            if (game.stopping) game.factsAfterStop++;
            game.clock += 16;
            return facts(id, game);
        },
        move: async (id, hab) => {
            game.moves.push(hab === undefined ? id : `${id}>${hab}`);
            game.clock += 16;
            if (stopOnMove) game.stopping = true;
            return move(id, game);
        },
        // as storagesend.js sleepUnlessStopped: at once while stopping
        sleep: async ms => {
            if (!game.stopping) game.clock += ms;
        },
        paceMs: () => 1500,
        online: true,
        isStopped: () => game.stopping,
    };
    return game;
}
