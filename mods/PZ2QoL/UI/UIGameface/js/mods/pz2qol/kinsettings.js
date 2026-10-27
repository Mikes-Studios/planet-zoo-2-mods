// Every Kin setting, once: its default (kin.js keeps the player's changes
// from these) and where the Kin planner's Settings show it (section, label,
// tip, the choices of a pick-one setting, the setting it needs on). The
// popover is drawn from this table, in its order: a new setting is one
// entry here. Something the mod does by itself that it did not do before
// starts off. Pure (node tests). A setting with no section has no switch.
import { DEFAULT_CLOSE_KINSHIP } from './kincore.js';
import { BOXED_AFTER_CHOICES } from './kinboxedcore.js';
import { NAME_GROUPS, nameGroupSetting } from './kinnamelist.js';


export const KIN_SETTINGS = Object.freeze([
    // badges, filters and panels
    { key: 'enabled', default: true },
    {
        key: 'autoOnAssign', default: false, section: 'Auto mode', label: 'Habitat set aside turns Auto on',
        tip: "Setting a habitat aside for a species turns that species' Auto mode on, so its breeding runs by itself from then on (Franchise too). A species you turned Auto mode off for stays off. Off: you turn Auto mode on per species on the Species board.",
    },
    {
        key: 'autoEarlySale', default: false, section: 'Auto mode', label: 'Breeders to storage before elderly',
        tip: "Auto mode sends a breeder to the trade centre with sell advice four years before it turns elderly, so there is a year to sell it before the server refuses every trade (three years short of elderly). Only in species that turn elderly at 40 or later, where those years are a tenth of a life at most. You sell it; Auto mode never sells. Off: breeders breed to the end and live out their lives in their habitat.",
    },
    {
        key: 'autoHouseWaiting', default: false, section: 'Auto mode', label: 'Bring waiting animals into a habitat',
        tip: "A pregnant female or an animal too old to trade waiting at the trade centre goes to a habitat: a pregnancy only goes on there, and the market takes neither. Off: they wait at the trade centre until you move them. Young ones always go back, since they only grow up in a habitat.",
    },
    {
        key: 'autoContraception', default: false, section: 'Auto mode', label: 'Contraception near a relative',
        tip: "A female who lives beside an adult relative of the other sex, or one about to grow up, goes on contraception until they are apart, and comes off it again then. Off: Auto mode only moves them apart.",
    },
    {
        key: 'uniqueNames', default: false, section: 'Names', label: 'Change juvenile names automatically',
        tip: "Every animal born in the zoo gets a name no other animal in the zoo or Animal Storage has, from the groups ticked below, picked at random but every name once before any comes round again, in place of the game's short list per species. Animals already named keep their names.",
    },
    ...NAME_GROUPS.map(g => ({
        key: nameGroupSetting(g.key), default: true, section: 'Names', label: g.label, needs: 'uniqueNames',
        tip: `Names from ${g.label.toLowerCase()} (${g.female.length} female, ${g.male.length} male).`,
    })),
    {
        key: 'gameSpeciesNames', default: true, section: 'Names', label: "Species names in the game's language",
        tip: "On: species names as the game shows them, in your game language. Off: the game's internal species names (e.g. Warthog Common), the same in every language.",
    },
    {
        key: 'releaseBoxed', default: true, section: 'Transport boxes', label: 'Let out stuck aquarium animals',
        tip: "The game sometimes boxes aquarium animals and never lets them out. On: the mod unboxes them after 30 s, one at a time, as the Unbox button does (Franchise too). Off: the game's own behaviour.",
    },
    {
        key: 'overdueBox', default: false, section: 'Transport boxes', label: 'Box Animal on an overdue mother',
        tip: "A mother still pregnant at twice her species' pregnancy gets Box Animal and is unboxed in place, once per pregnancy: the game lets a stalled birth go that way. Quietly, with no notice.",
    },
    {
        key: 'quarantineSick', default: true, section: 'Trade centre', label: 'Quarantine sick animals first',
        tip: "When the mod sends an infected or injured animal to the trade centre (a plan, Thin out, the Breeding programme), it goes to a quarantine first: the market won't take a sick animal, and the quarantine gets it treated. When it passes, a notice offers to send it on.",
    },
    {
        key: 'alerts', default: true, section: 'Alerts', label: 'New inbreeding risks',
        tip: 'A message when a related pair becomes able to breed (an animal grows up, moves in, or stops contraception)',
    },
    {
        key: 'alertKin', default: false, section: 'Alerts', label: 'Close kin too', needs: 'alerts',
        tip: 'Also alert for close relatives the game does not warn about (cousins, grandparents...)',
    },
    {
        key: 'alertLife', default: false, section: 'Alerts', label: 'Animals growing up',
        tip: 'A note when a young animal will grow up into a problem: group too big, pushed out of its group, or an inbreeding risk. Nothing when it is fine.',
    },
    {
        key: 'toastLevel', default: 'action', section: 'Alerts', label: 'Pop up for',
        choices: [
            { value: 'action', label: 'Needs you', tip: 'Only notices that need you to act pop up; the rest go to the notice log' },
            { value: 'heads', label: 'Heads-up too', tip: 'Heads-ups pop up as well' },
        ],
    },
    {
        key: 'errorBanner', default: true, section: 'Alerts', label: "The mod's errors on screen",
        tip: 'A banner when something in the mod goes wrong (a server error, a refused request, a script error), with Details. Off: nothing pops up; debug builds still write them to dbg/trace.log.',
    },
    {
        key: 'boxedAlert', default: true, section: 'Alerts', label: 'Boxed with nowhere to go',
        tip: 'A Needs-you alert when an animal waits in its transport box with no destination (the game only warns after a long time)',
    },
    {
        key: 'boxedAfterS', default: 10, section: 'Alerts', needs: 'boxedAlert',
        choices: BOXED_AFTER_CHOICES.map(sec => ({ value: sec, label: sec < 60 ? `${sec} s` : `${sec / 60} min`, tip: `Alert after ${sec} seconds in the box` })),
    },
    {
        key: 'boxedIncludeTrade', default: false, section: 'Alerts', label: 'Trade centre too', needs: 'boxedAlert',
        tip: 'Also alert for animals waiting boxed at the trade centre (off: they are expected to wait there)',
    },
    {
        key: 'elderlyAlert', default: false, section: 'Alerts', label: 'Warn four years before elderly',
        tip: "A Needs-you alert when an animal is four game years from turning elderly: in its last three years the market won't take it, once elderly the game won't rehome it, and in species infertile when elderly it can't be sold or released either.",
    },
    {
        key: 'storedHomeAlert', default: true, section: 'Alerts', label: 'Animals to bring out of storage',
        tip: "A Needs-you alert, with Bring from storage, for animals of a species in this zoo that Auto mode manages waiting in Animal Storage where they can't stay: young ones (nothing grows up there) and ones too old to trade (within three years of elderly the server refuses every trade, and nothing ages there). One per species and kind each time the zoo loads.",
    },
    {
        key: 'showCovered', default: true, section: 'Show', label: 'Covered pairs',
        tip: 'Related pairs kept apart by contraception or infertility',
    },
    {
        key: 'bondHolds', default: true, section: 'Show', label: 'Pair bonds count as protection',
        tip: 'A related pair the game will not let breed because one of them is bonded to another mate (monogamy) shows as Bonded elsewhere, not as a risk. It becomes a risk again when the bond ends.',
    },
    {
        key: 'closeKinship', default: DEFAULT_CLOSE_KINSHIP, section: 'Close kin from',
        note: 'Kinship at or above this counts as close kin. 1/16 is first cousins.',
        choices: [
            { value: 1 / 8, label: '1/8', tip: 'Only half-siblings, grandparents, full aunts and uncles and closer' },
            { value: 1 / 16, label: '1/16', tip: 'Also first cousins, great-grandparents, half aunts and uncles (default)' },
            { value: 1 / 32, label: '1/32', tip: 'Also half cousins and other more distant relatives' },
        ],
    },
].map(s => Object.freeze(s)));

export const DEFAULT_KIN_SETTINGS = Object.freeze(Object.fromEntries(KIN_SETTINGS.map(s => [s.key, s.default])));


// Is `value` this choice? (the close-kin line is a fraction)
export function isChoice(value, choice) {
    return typeof choice === 'number' ? Math.abs(Number(value) - choice) < 1e-9 : value === choice;
}
